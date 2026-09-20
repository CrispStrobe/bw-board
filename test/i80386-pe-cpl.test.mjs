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

test('pre-jump protected instructions use CPL0 while real DS and SS caches remain usable', () => {
  const { cpu, put } = fixture(0x250b, 'mov-cr0');
  put(0x210, descriptor(0x120000, 0x92));
  put(cpu.pc + 3, [
    0xb8, 0x10, 0x00, // MOV AX,10
    0x8e, 0xd8,       // MOV DS,AX
    0x8e, 0xd0,       // MOV SS,AX
    0x0f, 0x22, 0xdb, // MOV CR3,EBX: privileged at CPL0
  ]);
  cpu.ebx = 0x12345000;
  for (let count = 0; count < 5; count++) cpu.step();
  assert.deepEqual(
    [cpu.cs, cpu.currentPrivilegeLevel, cpu.ds, cpu.ss, cpu.cr3],
    [0x250b, 0, 0x10, 0x10, 0x12345000],
  );
  assert.deepEqual(
    [cpu.segmentCaches[3].base, cpu.segmentCaches[2].base],
    [0x120000, 0x120000],
  );
});

test('a conforming first protected CS load ends the retained-real-CS transition', () => {
  const { cpu, put } = fixture(0x250b, 'mov-cr0');
  put(0x218, descriptor(0x100000, 0x9e));
  put(cpu.pc + 3, [0x66, 0xea, 0x34, 0x03, 0x00, 0x00, 0x1b, 0x00]);
  cpu.step();
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu.currentPrivilegeLevel], [0x18, 0x334, 0]);
  assert.equal(cpu._retainedRealCs, false);
});

test('interrupt and IRET protected CS loads end the retained-real-CS transition', () => {
  const interrupt = fixture(0x250b, 'mov-cr0');
  interrupt.cpu.idtr = { base: 0x400, limit: 0x7ff };
  interrupt.cpu._loadSeg(2, 0x1000);
  interrupt.cpu.sp = 0x100;
  const gate = [0x00, 0x01, 0x18, 0x00, 0, 0x8e, 0, 0];
  interrupt.put(0x400 + 0x20 * 8, gate);
  interrupt.put(interrupt.cpu.pc + 3, [0xcd, 0x20]);
  interrupt.cpu.step();
  interrupt.cpu.step();
  assert.deepEqual(
    [interrupt.cpu.cs, interrupt.cpu.eip, interrupt.cpu.currentPrivilegeLevel],
    [0x18, 0x100, 0],
  );
  assert.equal(interrupt.cpu._retainedRealCs, false);

  const returning = fixture(0x250b, 'mov-cr0');
  returning.cpu._loadSeg(2, 0x1000);
  returning.cpu.sp = 0x100;
  returning.cpu.step();
  returning.put(returning.cpu.pc, [0x66, 0xcf]);
  returning.put(0x10100, [
    0x34, 0x03, 0x00, 0x00,
    0x18, 0x00, 0x00, 0x00,
    0x02, 0x00, 0x00, 0x00,
  ]);
  returning.cpu.step();
  assert.deepEqual(
    [returning.cpu.cs, returning.cpu.eip, returning.cpu.currentPrivilegeLevel],
    [0x18, 0x334, 0],
  );
  assert.equal(returning.cpu._retainedRealCs, false);
});

test('mode exit and reentry create a fresh CPL0 transition until CS reload', () => {
  const memory = new Map();
  const cpu = new I80386({
    read: (address) => memory.get(address) ?? 0,
    fetch: (address) => memory.get(address) ?? 0,
    write: (address, value) => memory.set(address, value & 0xff),
  });
  const put = (address, bytes) => bytes.forEach((value, index) => memory.set(address + index, value));
  cpu.cr0 = 1;
  cpu.cs = 8;
  cpu.segmentCaches[1] = {
    base: 0, limit: 0xffff, default32: true, present: true,
    code: true, readable: true, writable: false,
  };
  cpu.gdtr = { base: 0x200, limit: 0x1f };
  put(0x218, descriptor(0x100000));
  put(0, [
    0x0f, 0x22, 0xc0,
    0x0f, 0x22, 0xc0,
    0xea, 0x34, 0x03, 0x00, 0x00, 0x18, 0x00,
  ]);
  cpu.eax = 0;
  cpu.step();
  assert.equal(cpu.protectedMode, false);
  cpu.eax = 1;
  cpu.step();
  assert.deepEqual([cpu.protectedMode, cpu.currentPrivilegeLevel, cpu._retainedRealCs], [true, 0, true]);
  cpu.step();
  assert.deepEqual([cpu.cs, cpu.eip, cpu._retainedRealCs], [0x18, 0x334, false]);
});
