// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createKim1Machine, controlKim1Machine as control, keyKim1Machine as key,
  stepKim1Machine, resetKim1Machine, parseKim1Program, formatKim1Program,
  peekKim1Byte as peek, readKim1Byte as read, writeKim1Byte as write,
  observeKim1Inputs, advanceKim1Cycles, KIM1_DEMOS
} from '../src/kim1-machine.js';

test('strict addressed hex load validates all bytes and aliases before committing', () => {
  const state = createKim1Machine('0200: a9 2a ; load\n0202: 85 10 # store');
  assert.equal(state.programSource, '0200: A9 2A 85 10');
  const before = state.programSource, ram = [...state.ram];
  for (const bad of ['0200: A9 Z0', '200: A9', '0200: A', '0200: AA\n2200: BB', '17FF: 00 01', '1700: 00', '0400: 00', '']) {
    assert.throws(() => control(state, 'loadProgram', bad));
    assert.equal(state.programSource, before); assert.deepEqual([...state.ram], ram);
  }
  assert.equal(formatKim1Program(parseKim1Program('2200: 01 02')), '0200: 01 02');
});

test('13-bit map aliases real RAM, separates both RRIOT RAMs, and refuses missing ROM', () => {
  const s = createKim1Machine();
  write(s, 0x2200, 0x45); assert.equal(read(s, 0x0200), 0x45);
  write(s, 0x1780, 0x12); write(s, 0x17c0, 0x34);
  assert.equal(read(s, 0x9780), 0x12); assert.equal(read(s, 0x77c0), 0x34);
  for (const a of [0x400, 0x1400, 0x1800, 0x1c00, 0xfffc]) assert.throws(() => read(s, a), /Unmapped|unavailable/);
  assert.throws(() => write(s, 0x1800, 0xaa), /not writable/);
  control(s, 'setPc', 0x1800); assert.equal(s.display, '1800--');
  control(s, 'step'); assert.match(s.error, /ROM.*unavailable/); assert.equal(s.running, false);
});

test('AD/DA rolling edits, +, saved PC, SST, GO and reset behave as independent monitor', () => {
  const s = createKim1Machine('0200: A9 2A 85 10 EA');
  for (const k of ['AD', '0', '3', '0', '0', 'DA', 'A', 'B']) key(s, k);
  assert.equal(s.display, '0300AB'); assert.equal(s.ram[0x300], 0xab);
  key(s, '+'); assert.equal(s.mode, 'data'); assert.equal(s.address, 0x301);
  for (const k of ['1', '2']) key(s, k);
  assert.equal(s.ram[0x301], 0x12); assert.match(s.programSource, /0300: AB 12/);
  key(s, 'PC'); assert.equal(s.address, 0x200);
  key(s, 'SST'); key(s, 'GO');
  assert.equal(s.cpu.a, 0x2a); assert.equal(s.pc, 0x202); assert.equal(s.running, false);
  assert.equal(s.display, '020285'); assert.equal(s.ram[0xf3], 0x2a);
  assert.equal(s.ram[0xef] | (s.ram[0xf0] << 8), 0x202);
  for (const k of ['AD', '0', '3', '0', '0', 'PC']) key(s, k);
  assert.equal(s.address, 0x202);
  control(s, 'step'); assert.equal(s.ram[0x10], 0x2a); assert.equal(s.pc, 0x204);
  resetKim1Machine(s);
  assert.equal(s.ram[0x300], 0xab); assert.equal(s.ram[0x10], 0x2a);
  assert.equal(s.cpu.a, 0); assert.equal(s.cpu.s, 0xfd); assert.equal(s.singleStep, false);
  assert.match(s.programSource, /0300: AB 12/);
});

test('GO restores editable saved registers; BRK stops at the declared monitor boundary', () => {
  const s = createKim1Machine('0200: 85 10 00 EA');
  write(s, 0xf3, 0x67); control(s, 'run');
  stepKim1Machine(s, {singleStep: false}); assert.equal(s.ram[0x10], 0x67);
  const before = s.cpu.s;
  assert.equal(stepKim1Machine(s, {singleStep: false}), 7);
  assert.equal(s.running, false); assert.equal(s.pc, 0x204); assert.equal(s.cpu.s, before);
  assert.match(s.lastStop, /independent monitor/); assert.equal(s.ram[0xf3], 0x67);
  control(s, 'loadProgram', '0200: 80 00'); control(s, 'step');
  assert.match(s.error, /Unsupported NMOS/); assert.equal(s.pc, 0x200);
});

test('real NMOS programs configure DDR, count outputs and read independent port inputs', () => {
  const count = createKim1Machine(KIM1_DEMOS.counter.program);
  control(count, 'run');
  for (let i = 0; i < 10; i++) stepKim1Machine(count, {singleStep: false});
  assert.equal(count.ddrA, 255); assert.equal(count.portA, 3); assert.equal(count.error, null);
  const echo = createKim1Machine(KIM1_DEMOS.echo.program);
  observeKim1Inputs(echo, 0, 0x85); control(echo, 'run');
  for (let i = 0; i < 8; i++) stepKim1Machine(echo, {singleStep: false});
  assert.equal(echo.portA, 0x85); assert.equal(echo.ddrA, 255); assert.equal(echo.ddrB, 0);
  observeKim1Inputs(echo, 0, 0x02);
  for (let i = 0; i < 4; i++) stepKim1Machine(echo, {singleStep: false});
  assert.equal(echo.portA, 2); assert.equal(echo.error, null);
  write(echo, 0x1701, 0x0f); write(echo, 0x1700, 0x05); observeKim1Inputs(echo, 0xa0, 0);
  assert.equal(read(echo, 0x1700), 0xa5);
  write(echo, 0x1741, 0xff); write(echo, 0x1740, 0x77);
  assert.equal(read(echo, 0x1740), 0x77); assert.equal(read(echo, 0x1700), 0xa5);
});

test('6530 timers expire at N*divider+1, then decrement every cycle', () => {
  for (const [index, divider] of [1, 8, 64, 1024].entries()) {
    const s = createKim1Machine();
    write(s, 0x1704 + index, 2);
    advanceKim1Cycles(s, 2 * divider);
    assert.equal(peek(s, 0x1707), 0); assert.equal(peek(s, 0x1706), 0);
    advanceKim1Cycles(s, 1);
    assert.equal(peek(s, 0x1707), 128); assert.equal(peek(s, 0x1706), 255);
    advanceKim1Cycles(s, 3); assert.equal(peek(s, 0x1706), 252);
    assert.equal(read(s, 0x1707), 128, 'flag read does not acknowledge');
    assert.equal(read(s, 0x1706), 252); assert.equal(peek(s, 0x1707), 0);
  }
});

test('timer read aliases set IRQ mode, PB7 is low on enabled expiry, and IRQ is not automatic', () => {
  const s = createKim1Machine();
  observeKim1Inputs(s, 0, 0x80); write(s, 0x171d, 0);
  assert.equal(read(s, 0x1702), 0x80); advanceKim1Cycles(s, 1);
  assert.equal(read(s, 0x1702), 0); assert.equal(s.cpu.pc, 0x200);
  assert.equal(read(s, 0x170f), 128); assert.equal(read(s, 0x1702), 0);
  read(s, 0x170e); assert.equal(s.riots[0].timer.irqEnabled, true);
  assert.equal(read(s, 0x1702), 0x80); read(s, 0x1704);
  assert.equal(s.riots[0].timer.irqEnabled, false);
  write(s, 0x170b, 0x80); write(s, 0x170a, 0); write(s, 0x170d, 4);
  assert.equal(read(s, 0x1702), 0, 'enabling the timer cannot override a GPIO-low');
});

test('count acknowledgement preserves the continuously running prescaler phase', () => {
  const s = createKim1Machine();
  write(s, 0x1705, 0); advanceKim1Cycles(s, 4);
  assert.equal(read(s, 0x1706), 252);
  advanceKim1Cycles(s, 4); assert.equal(peek(s, 0x1706), 252);
  advanceKim1Cycles(s, 1); assert.equal(peek(s, 0x1706), 251);
});
