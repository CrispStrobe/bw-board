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
