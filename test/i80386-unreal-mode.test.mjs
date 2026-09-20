import test from 'node:test';
import assert from 'node:assert/strict';

import I80386 from '../src/experimental/i80386.js';

function fixture(bytes) {
  const memory = new Map(bytes.map((value, index) => [index, value]));
  const cpu = new I80386({
    fetch: address => memory.get(address) ?? 0,
    read: address => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
  return {cpu, memory};
}

function descriptor(base, limit, access, flags = 0xc0) {
  return [limit & 0xff, limit >>> 8 & 0xff, base & 0xff, base >>> 8 & 0xff,
    base >>> 16 & 0xff, access, flags | limit >>> 16 & 0x0f, base >>> 24 & 0xff];
}

test('real-mode data-segment reload preserves protected hidden limits for high-address copies', () => {
  const {cpu, memory} = fixture([
    0x8e, 0xd8,             // MOV DS,AX after PE was cleared
    0x8e, 0xc0,             // MOV ES,AX
    0x67, 0x66, 0xf3, 0xa5, // REP MOVSD with 32-bit address and operand sizes
  ]);
  cpu.ax = 0;
  cpu.esi = 0x10000;
  cpu.edi = 0x20000;
  cpu.ecx = 1;
  for (const id of [0, 3]) cpu.segmentCaches[id] = {
    ...cpu.segmentCaches[id],
    base: 0x12340000,
    limit: 0xffffffff,
    default32: true,
    present: true,
    writable: true,
  };
  [0x78, 0x56, 0x34, 0x12].forEach((value, index) => memory.set(0x10000 + index, value));

  cpu.step();
  cpu.step();
  assert.deepEqual(
    [cpu.segmentCaches[3].base, cpu.segmentCaches[3].limit,
      cpu.segmentCaches[0].base, cpu.segmentCaches[0].limit],
    [0, 0xffffffff, 0, 0xffffffff],
  );
  cpu.step();
  assert.deepEqual([0, 1, 2, 3].map(index => memory.get(0x20000 + index)),
    [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual([cpu.esi, cpu.edi, cpu.ecx, cpu.eip], [0x10004, 0x20004, 0, 8]);
});

test('VM86 segment reload restores a 64KiB real-style cache', () => {
  const {cpu} = fixture([0x8e, 0xd8]);
  cpu.cr0 = 1;
  cpu.eflags = 0x20002;
  cpu.ax = 0x1234;
  cpu.segmentCaches[3] = {
    ...cpu.segmentCaches[3],
    base: 0,
    limit: 0xffffffff,
    default32: true,
  };
  cpu.step();
  assert.deepEqual(cpu.segmentCaches[3], {
    base: 0x12340,
    limit: 0xffff,
    default32: false,
    present: true,
    code: false,
    writable: true,
  });
});

test('guest protected loads survive guest PE clear and real reload', () => {
  const {cpu, memory} = fixture([
    0xb8, 0x10, 0x00,       // MOV AX,10h
    0x8e, 0xd8,             // MOV DS,AX (4GiB descriptor)
    0x8e, 0xc0,             // MOV ES,AX
    0x0f, 0x20, 0xc0,       // MOV EAX,CR0
    0x24, 0xfe,             // AND AL,FEh
    0x0f, 0x22, 0xc0,       // MOV CR0,EAX
    0x31, 0xc0,             // XOR AX,AX
    0x8e, 0xd8,             // MOV DS,AX in real mode
    0x8e, 0xc0,             // MOV ES,AX
    0x67, 0x66, 0xf3, 0xa5, // REP MOVSD above 64KiB
  ]);
  descriptor(0, 0xfffff, 0x92).forEach((value, index) => memory.set(0x110 + index, value));
  cpu.gdtr = {base: 0x100, limit: 0x17};
  cpu.cr0 = 1;
  cpu.cs = 8;
  cpu.segmentCaches[1] = {...cpu.segmentCaches[1], selector: 8, base: 0,
    limit: 0xffffffff, default32: false, present: true, code: true, readable: true};
  cpu.esi = 0x10000;
  cpu.edi = 0x20000;
  cpu.ecx = 1;
  [0xef, 0xbe, 0xad, 0xde].forEach((value, index) => memory.set(0x10000 + index, value));
  for (let count = 0; count < 10; count++) cpu.step();
  assert.equal(cpu.protectedMode, false);
  assert.deepEqual([cpu.ds, cpu.es, cpu.segmentCaches[3].limit, cpu.segmentCaches[0].limit],
    [0, 0, 0xffffffff, 0xffffffff]);
  assert.deepEqual([0, 1, 2, 3].map(index => memory.get(0x20000 + index)),
    [0xef, 0xbe, 0xad, 0xde]);
});
