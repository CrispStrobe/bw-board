import assert from 'node:assert/strict';
import test from 'node:test';
import I80386 from '../src/experimental/i80386.js';

function descriptor(base, access = 0x9a) {
  return [
    0xff, 0xff, base, base >>> 8, base >>> 16, access, 0xcf, base >>> 24,
  ].map((value) => value & 0xff);
}

function fixture(cs, transition) {
  const memory = new Map();
  const cpu = new I80386({
    read: (address) => memory.get(address >>> 0) ?? 0,
    fetch: (address) => memory.get(address >>> 0) ?? 0,
    write: (address, value) => memory.set(address >>> 0, value & 0xff),
  });
  const put = (address, bytes) => bytes.forEach((value, index) => {
    memory.set((address + index) >>> 0, value);
  });
  cpu._loadSeg(1, cs);
  cpu.gdtr = { base: 0x200, limit: 0x1f };
  put(0x218, descriptor(0x100000));
  const enter = transition === 'mov-cr0' ? [0x0f, 0x22, 0xc0] : [0x0f, 0x01, 0xf0];
  put(cpu.pc, [...enter, 0x66, 0xea, 0x34, 0x03, 0x00, 0x00, 0x18, 0x00]);
  cpu.eax = 1;
  return { cpu, memory, put };
}

for (const transition of ['mov-cr0', 'lmsw']) {
  for (const lowBits of [1, 2, 3]) {
    test(`${transition} enters protected mode at CPL0 with retained real CS low bits ${lowBits}`, () => {
      const visibleCs = 0x2508 | lowBits;
      const { cpu } = fixture(visibleCs, transition);
      cpu.step();
      assert.equal(cpu.protectedMode, true);
      assert.equal(cpu.cs, visibleCs, 'the transition does not rewrite visible CS');
      assert.equal(cpu.currentPrivilegeLevel, 0, 'the architectural initial CPL is zero');
      assert.equal(cpu.segmentCaches[1].base, visibleCs << 4);

      cpu.step();
      assert.deepEqual([cpu.cs, cpu.eip, cpu.currentPrivilegeLevel], [0x18, 0x334, 0]);
      assert.equal(cpu.segmentCaches[1].base, 0x100000);
    });
  }
}

test('a faulted first protected CS load restores retained-real-CS privilege state', () => {
  const { cpu, memory, put } = fixture(0x250a, 'mov-cr0');
  cpu.step();
  memory.set(0x218 + 5, 0x92); // data descriptor makes the far jump fault
  assert.throws(
    () => cpu.step(),
    (error) => error?.vector === 13 && error.errorCode === 0x18,
  );
  assert.deepEqual([cpu.cs, cpu.eip, cpu.currentPrivilegeLevel], [0x250a, 3, 0]);

  put(0x218, descriptor(0x100000));
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.currentPrivilegeLevel], [0x18, 0x334, 0]);
});

test('direct protected-mode fixtures retain selector-derived CPL outside the transition window', () => {
  const cpu = new I80386();
  cpu.cr0 = 1;
  cpu.cs = 3;
  assert.equal(cpu.currentPrivilegeLevel, 3);
});
