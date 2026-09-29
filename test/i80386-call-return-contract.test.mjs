import test from 'node:test';
import assert from 'node:assert/strict';
import I80386, { I80386Fault } from '../src/experimental/i80386.js';

function fixture(bytes, code32 = false) {
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
  cpu.cr0 = 1;
  cpu.cs = 8;
  cpu.ss = 0x10;
  cpu.segmentCaches[1] = {
    base: 0, limit: 0xffff, default32: code32, present: true,
    code: true, readable: true, writable: false,
  };
  cpu.segmentCaches[2] = {
    base: 0x2000, limit: 0xffff, default32: code32, present: true,
    code: false, readable: true, writable: true,
  };
  cpu.esp = code32 ? 0x300 : 0xabcd0100;
  cpu.eflags = 0x202;
  return { cpu, memory, effects };
}

function put(memory, address, bytes) {
  bytes.forEach((value, index) => memory.set(address + index, value & 255));
}

test('protected16 E8 then C3 writes and reads the return word in stack order', () => {
  const { cpu, memory, effects } = fixture([0xe8, 0x02, 0x00, 0x90, 0x90, 0xc3]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.esp, cpu.eflags], [5, 0xabcd00fe, 0x202]);
  assert.deepEqual(effects, [
    ['fetch', 0], ['fetch', 1], ['fetch', 2],
    ['write', 0x20fe, 3], ['write', 0x20ff, 0],
  ]);
  assert.deepEqual([memory.get(0x20fe), memory.get(0x20ff)], [3, 0]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.esp, cpu.eflags], [3, 0xabcd0100, 0x202]);
  assert.deepEqual(effects.slice(5), [
    ['fetch', 5], ['read', 0x20fe], ['read', 0x20ff],
  ]);
  assert.deepEqual([cpu.cs, cpu.ss], [8, 0x10]);
});

test('protected16 E8 validates destination before touching a valid stack', () => {
  const { cpu, effects } = fixture([0xe8, 0x02, 0x00]);
  cpu.segmentCaches[1].limit = 4;
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(),
    error => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.deepEqual(effects, [['fetch', 0], ['fetch', 1], ['fetch', 2]]);
});

test('protected16 C3 reads return word before target validation and rolls back on bad target', () => {
  const { cpu, memory, effects } = fixture([0xc3]);
  put(memory, 0x2100, [0x34, 0x12]);
  cpu.segmentCaches[1].limit = 0xff;
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(),
    error => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.deepEqual(effects, [['fetch', 0], ['read', 0x2100], ['read', 0x2101]]);
});

test('protected32 FF /2 SIB call reads SS source before writing four stack bytes; C3 returns', () => {
  // FF /2, mod=2 SIB: [EBP + ECX*4 + 0x20] = SS:0x128.
  const { cpu, memory, effects } = fixture([0xff, 0x94, 0x8d, 0x20, 0, 0, 0], true);
  cpu.ebp = 0x100;
  cpu.ecx = 2;
  put(memory, 0x2128, [0x40, 0, 0, 0]);
  memory.set(0x40, 0xc3);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.esp, cpu.eflags], [0x40, 0x2fc, 0x202]);
  assert.deepEqual(effects, [
    ...Array.from({ length: 7 }, (_, i) => ['fetch', i]),
    ...Array.from({ length: 4 }, (_, i) => ['read', 0x2128 + i]),
    ['write', 0x22fc, 7], ['write', 0x22fd, 0],
    ['write', 0x22fe, 0], ['write', 0x22ff, 0],
  ]);
  cpu.step();
  assert.deepEqual([cpu.eip, cpu.esp, cpu.eflags], [7, 0x300, 0x202]);
  assert.deepEqual(effects.slice(15), [
    ['fetch', 0x40],
    ...Array.from({ length: 4 }, (_, i) => ['read', 0x22fc + i]),
  ]);
});

test('protected32 FF /2 SIB rejects an out-of-range target after source read and before push', () => {
  const { cpu, memory, effects } = fixture([0xff, 0x94, 0x8d, 0x20, 0, 0, 0], true);
  cpu.ebp = 0x100;
  cpu.ecx = 2;
  cpu.segmentCaches[1].limit = 0x3f;
  put(memory, 0x2128, [0x40, 0, 0, 0]);
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(),
    error => error instanceof I80386Fault && error.vector === 13 && error.errorCode === 0);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.deepEqual(effects, [
    ...Array.from({ length: 7 }, (_, i) => ['fetch', i]),
    ...Array.from({ length: 4 }, (_, i) => ['read', 0x2128 + i]),
  ]);
});

test('protected32 FF /2 SIB source read precedes stack-limit fault with no stack write', () => {
  const { cpu, memory, effects } = fixture([0xff, 0x94, 0x8d, 0x20, 0, 0, 0], true);
  cpu.ebp = 0x100;
  cpu.ecx = 2;
  cpu.segmentCaches[2].limit = 0x2fb;
  put(memory, 0x2128, [0x40, 0, 0, 0]);
  const before = cpu._snapshotInstruction();
  assert.throws(() => cpu.step(),
    error => error instanceof I80386Fault && error.vector === 12 && error.errorCode === 0);
  assert.deepEqual(cpu._snapshotInstruction(), before);
  assert.deepEqual(effects, [
    ...Array.from({ length: 7 }, (_, i) => ['fetch', i]),
    ...Array.from({ length: 4 }, (_, i) => ['read', 0x2128 + i]),
  ]);
});
