import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, { I80386Fault } from '../src/experimental/i80386.js';

function fixture(bytes) {
  const memory = new Map(bytes.map((value, address) => [address, value]));
  const effects = [];
  const cpu = new I80386({
    fetch(address) {
      effects.push(['fetch', address]);
      return memory.get(address) ?? 0;
    },
    read(address) {
      effects.push(['read', address]);
      return memory.get(address) ?? 0;
    },
    write(address, value) {
      effects.push(['write', address, value & 255]);
      memory.set(address, value & 255);
    },
  });
  return { cpu, memory, effects };
}

function put(memory, address, bytes) {
  bytes.forEach((value, index) => memory.set(address + index, value & 255));
}

function descriptor(base, access) {
  return [0xff, 0xff, base, base >>> 8, base >>> 16, access, 0x00, base >>> 24];
}

function protected16(bytes, access = 0x92) {
  const f = fixture(bytes);
  const { cpu, memory } = f;
  cpu.cr0 = 1;
  cpu.cs = 8;
  cpu.ss = 0x10;
  cpu.gdtr = { base: 0x300, limit: 0x0f };
  cpu.segmentCaches[2] = { ...cpu.segmentCaches[2], base: 0x1000 };
  cpu.es = 0x7777;
  cpu.segmentCaches[0] = { ...cpu.segmentCaches[0], base: 0x77770, limit: 0x1234 };
  put(memory, 0x308, descriptor(0x2200, access));
  return f;
}

test('protected16 8E ES,[BP+1] reads source before descriptor, then marks Accessed and commits cache', () => {
  const { cpu, memory, effects } = protected16([0x8e, 0x46, 0x01, 0x26, 0xa0, 0x00, 0x00]);
  cpu.bp = 0x20;
  put(memory, 0x1021, [0x08, 0x00]);
  cpu.step();
  assert.deepEqual(effects, [
    ['fetch', 0], ['fetch', 1], ['fetch', 2],
    ['read', 0x1021], ['read', 0x1022],
    ...Array.from({ length: 8 }, (_, i) => ['read', 0x308 + i]),
    ['write', 0x30d, 0x93],
  ]);
  assert.equal(cpu.eip, 3);
  assert.equal(cpu.es, 8);
  assert.equal(cpu.segmentCaches[0].base, 0x2200);
  assert.equal(cpu.segmentCaches[0].limit, 0xffff);
  assert.equal(cpu.segmentCaches[0].access, 0x93);
  assert.equal(memory.get(0x30d), 0x93);
  assert.deepEqual([cpu._interruptShadow, cpu._nmiShadow, cpu._debugShadow], [0, 0, 0]);
  memory.set(0x2200, 0xa5);
  memory.set(0x3300, 0x5a);
  put(memory, 0x30a, [0x00, 0x33]); // Edit GDT base after the load.
  cpu.step();
  assert.equal(cpu.al, 0xa5);
  assert.deepEqual(effects.slice(-5), [
    ['fetch', 3], ['fetch', 4], ['fetch', 5], ['fetch', 6], ['read', 0x2200],
  ]);
});

test('protected16 invalid ES selector faults after source RAM read without changing visible segment state', () => {
  const { cpu, memory, effects } = protected16([0x8e, 0x46, 0x01], 0x12);
  cpu.bp = 0x20;
  put(memory, 0x1021, [0x08, 0x00]);
  const oldCache = cpu.segmentCaches[0];
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(),
    error => error instanceof I80386Fault && error.vector === 11 && error.errorCode === 8);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.equal(cpu.segmentCaches[0], oldCache);
  assert.deepEqual(effects, [
    ['fetch', 0], ['fetch', 1], ['fetch', 2],
    ['read', 0x1021], ['read', 0x1022],
    ...Array.from({ length: 8 }, (_, i) => ['read', 0x308 + i]),
  ]);
  assert.equal(memory.get(0x30d), 0x12);
});

test('protected16 out-of-table ES selector faults before descriptor traffic or cache commit', () => {
  const { cpu, memory, effects } = protected16([0x8e, 0x46, 0x01]);
  cpu.bp = 0x20;
  cpu.gdtr.limit = 7;
  put(memory, 0x1021, [0x08, 0x00]);
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(),
    error => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 8);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.deepEqual(effects, [
    ['fetch', 0], ['fetch', 1], ['fetch', 2],
    ['read', 0x1021], ['read', 0x1022],
  ]);
});

test('VM86 8E ES,DX replaces stale cache and the next ES read uses the new base', () => {
  const { cpu, memory, effects } = fixture([0x8e, 0xc2, 0x26, 0xa0, 0x00, 0x00]);
  cpu.cr0 = 1;
  cpu.eflags = 0x20002;
  cpu.dx = 0x3456;
  cpu.es = 0x7777;
  cpu.segmentCaches[0] = { ...cpu.segmentCaches[0], base: 0x77770, limit: 0x1ffff, default32: true };
  memory.set(0x34560, 0xa5);
  cpu.step();
  assert.equal(cpu.es, 0x3456);
  assert.deepEqual(cpu.segmentCaches[0], {
    base: 0x34560, limit: 0xffff, default32: false, present: true,
    code: false, readable: true, writable: true,
  });
  assert.deepEqual(effects, [['fetch', 0], ['fetch', 1]]);
  cpu.step();
  assert.equal(cpu.al, 0xa5);
  assert.deepEqual(effects.slice(2), [
    ['fetch', 2], ['fetch', 3], ['fetch', 4], ['fetch', 5], ['read', 0x34560],
  ]);
});

test('VM86 memory 8E ES,[BP+1] reads two ordered stack bytes without descriptor traffic', () => {
  const { cpu, memory, effects } = fixture([0x8e, 0x46, 0x01]);
  cpu.cr0 = 1;
  cpu.eflags = 0x20002;
  cpu.bp = 0x20;
  cpu.ss = 0x1111;
  cpu.segmentCaches[2] = cpu._virtualSegmentCache(2, cpu.ss);
  put(memory, 0x11131, [0x34, 0x12]);
  cpu.step();
  assert.equal(cpu.es, 0x1234);
  assert.equal(cpu.segmentCaches[0].base, 0x12340);
  assert.deepEqual(effects, [
    ['fetch', 0], ['fetch', 1], ['fetch', 2],
    ['read', 0x11131], ['read', 0x11132],
  ]);
});
