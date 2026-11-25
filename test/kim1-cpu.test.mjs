// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {NMOS6502, NMOS6502_OPCODES} from '../src/nmos6502.js';

function machine(bytes, pc = 0x200) {
  const ram = new Uint8Array(65536), writes = [];
  ram.set(bytes, pc);
  const cpu = new NMOS6502({read: a => ram[a], write: (a, v) => {ram[a] = v; writes.push([a, v]);}});
  cpu.pc = pc;
  return {ram, cpu, writes};
}

test('only 151 documented NMOS instructions are accepted', () => {
  assert.equal(NMOS6502_OPCODES.length, 151); assert.equal(new Set(NMOS6502_OPCODES).size, 151);
  for (const op of [0x80, 0x64, 0x1a, 0x7c, 0xcb, 0xdb, 0xff]) {
    const {cpu} = machine([op]); assert.throws(() => cpu.step(), /Unsupported NMOS/); assert.equal(cpu.pc, 0x200);
  }
});

test('NMOS decimal ADC/SBC flags and cycles differ from CMOS', () => {
  const {cpu} = machine([0x69, 0x50, 0xe9, 0x01]);
  cpu.a = 0x50; cpu.p = 0x28;
  assert.equal(cpu.step(), 2); assert.equal(cpu.a, 0); assert.equal(cpu.p & 0xc3, 0xc1);
  cpu.a = 0; cpu.p = 0x29;
  assert.equal(cpu.step(), 2); assert.equal(cpu.a, 0x99); assert.equal(cpu.p & 0xc3, 0x80);
});

test('NMOS indirect JMP wraps within the pointer page', () => {
  const {cpu, ram} = machine([0x6c, 0xff, 0x12]);
  ram[0x12ff] = 0x34; ram[0x1200] = 0x56; ram[0x1300] = 0x99;
  assert.equal(cpu.step(), 5); assert.equal(cpu.pc, 0x5634);
});

test('indexed shifts always take seven cycles and write old then new data', () => {
  for (const base of [0x1000, 0x10ff]) {
    const {cpu, ram, writes} = machine([0x1e, base & 255, base >>> 8]);
    cpu.x = 1; ram[base + 1] = 0x81;
    assert.equal(cpu.step(), 7); assert.deepEqual(writes, [[base + 1, 0x81], [base + 1, 2]]);
    assert.equal(cpu.p & 1, 1);
  }
});

test('JSR operand overlapping its own stack writes observes NMOS access ordering', () => {
  // Regression: JSR's last operand can be overwritten before it is read.
  const {cpu} = machine([0x20, 0x55, 0x13], 0x17b);
  cpu.s = 0x7d;
  assert.equal(cpu.step(), 6); assert.equal(cpu.pc, 0x155); assert.equal(cpu.s, 0x7b);
});

test('subroutine return, BRK/RTI stack state and hardware IRQ preserve decimal mode', () => {
  const {cpu, ram} = machine([0x20, 0x10, 0x02, 0x00, 0xea]);
  ram[0x210] = 0x60; ram[0xfffe] = 0; ram[0xffff] = 3; ram[0x300] = 0x40;
  cpu.p = 0x28;
  assert.equal(cpu.step(), 6); assert.equal(cpu.pc, 0x210);
  assert.equal(cpu.step(), 6); assert.equal(cpu.pc, 0x203);
  assert.equal(cpu.step(), 7); assert.equal(cpu.pc, 0x300); assert.equal(cpu.p & 8, 8);
  assert.equal(ram[0x1fb] & 0x30, 0x30);
  assert.equal(cpu.step(), 6); assert.equal(cpu.pc, 0x205); assert.equal(cpu.s, 0xfd);
  assert.equal(cpu.irq(), true); assert.equal(cpu.p & 8, 8); assert.equal(ram[0x1fb] & 0x10, 0);
});

test('zero-page pointer wrap and page-crossing read cycle are distinct', () => {
  const {cpu, ram} = machine([0xb1, 0xff]);
  ram[0xff] = 0xff; ram[0] = 0x10; ram[0x100] = 0x99; ram[0x1100] = 0x42; cpu.y = 1;
  assert.equal(cpu.step(), 6); assert.equal(cpu.a, 0x42);
});
