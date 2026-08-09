// Stage 2: BoardImpl routes _solve()/advanceTo through MNA whenever the
// netlist contains parts the closed-form walker cannot represent.
// Before this, nodeVoltage() on any diode/transistor/op-amp/vsource circuit
// reported the walker's answer — computed as if those parts were absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const vcc = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const r = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

test('nodeVoltage sees a diode load (walker used to report 5 V)', () => {
  // 5 V → 1 kΩ → diode (Vf 0.7, rd 10) → GND.
  // i = (5 − 0.7)/1010 = 4.257 mA; anode node = 0.7 + 0.010·i·1000 = 0.7426 V.
  const b = new BoardImpl();
  b.setNetlist(
    [vcc, gnd, r('R1', 1000), { id: 'D1', kind: 'diode', params: { vf: 0.7 }, terminals: ['anode', 'cathode'] }],
    [
      { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'D1', terminal: 'cathode' }] },
    ]);
  const v = b.nodeVoltage('n1');
  const expected = 0.7 + 10 * ((5 - 0.7) / 1010); // 0.74257
  assert.ok(Math.abs(v - expected) < 1e-3, `n1 = ${v}, expected ${expected}`);
});

test('an NPN switch: collector voltage from one coherent solve', () => {
  // Base: MCU P1.0 push-pull HIGH (5 V behind 25 Ω) → 100 kΩ → base.
  // ib = (5 − 0.7)/(25 + 100k + 10) ≈ 42.98 µA; ic = 100·ib ≈ 4.298 mA.
  // Collector: 5 V − 1 kΩ·ic ≈ 0.702 V (active region — chosen to stay there).
  const b = new BoardImpl();
  b.setNetlist(
    [vcc, gnd, { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      r('RB', 100000), r('RC', 1000),
      { id: 'Q1', kind: 'npn', params: { beta: 100, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] }],
    [
      { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'RC', terminal: 'a' }] },
      { id: 'drive', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'RB', terminal: 'a' }] },
      { id: 'base', terminals: [{ part: 'RB', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
      { id: 'coll', terminals: [{ part: 'RC', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
    ]);
  b.setPin('P1.0', 'pushpull', true);
  const ib = (5 - 0.7) / (25 + 100000 + 10);
  const expected = 5 - 1000 * 100 * ib; // ≈ 0.702 V
  const v = b.nodeVoltage('coll');
  assert.ok(Math.abs(v - expected) < 0.05, `coll = ${v}, expected ≈ ${expected}`);
  // And driven LOW, the transistor is off: collector floats up to 5 V.
  b.setPin('P1.0', 'pushpull', false);
  assert.ok(Math.abs(b.nodeVoltage('coll') - 5) < 0.01, `off coll = ${b.nodeVoltage('coll')}`);
});

test('a function generator runs the board through advanceTo', () => {
  // Sine 1 kHz, amplitude 2, offset 2.5 across a 1 kΩ load.
  const b = new BoardImpl();
  b.setNetlist(
    [gnd, { id: 'FG', kind: 'vsource', params: { wave: 'sine', freq: 1000, amplitude: 2, offset: 2.5 }, terminals: ['pos', 'neg'] },
      r('RL', 1000)],
    [
      { id: 'sig', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'RL', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'FG', terminal: 'neg' }, { part: 'RL', terminal: 'b' }] },
    ]);
  b.advanceTo(250_000n);            // 250 µs = T/4 → peak
  assert.ok(Math.abs(b.nodeVoltage('sig') - 4.5) < 0.05, `T/4: ${b.nodeVoltage('sig')}`);
  b.advanceTo(750_000n);            // 3T/4 → trough
  assert.ok(Math.abs(b.nodeVoltage('sig') - 0.5) < 0.05, `3T/4: ${b.nodeVoltage('sig')}`);
});

test('RC charging beside a diode: transient MNA carries the cap forward', () => {
  // 5 V → 1 kΩ → n1 → cap 1 µF → GND, plus a diode from n1 to GND (Vf 0.7)
  // that clamps the node: the cap charges toward min(5 V target, clamp ≈ 0.74 V).
  // Walker's closed-form integrator cannot see the diode at all.
  const b = new BoardImpl();
  b.setNetlist(
    [vcc, gnd, r('R1', 1000),
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'D1', kind: 'diode', params: { vf: 0.7 }, terminals: ['anode', 'cathode'] }],
    [
      { id: 'vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }, { part: 'D1', terminal: 'anode' }] },
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }, { part: 'D1', terminal: 'cathode' }] },
    ]);
  // 10 ms ≫ τ: fully settled at the diode clamp, NOT at 5 V.
  b.advanceTo(10_000_000n);
  const vClamp = 0.7 + 10 * ((5 - 0.7) / 1010); // same loop as the diode test
  const v = b.getCapVoltage('C1');
  assert.ok(Math.abs(v - vClamp) < 0.02, `cap settled at ${v}, expected clamp ${vClamp}`);
  assert.ok(v < 1.0, 'the diode clamp held — without MNA routing this reads ~5 V');
});
