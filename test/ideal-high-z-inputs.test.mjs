/**
 * Hand oracles for spec-updates/ideal-high-z-inputs.md.
 *
 * The 178 `ctx.conductance(t, null, g)` declarations never stamped anything —
 * stampTwoTerminal's air-leg guard returns on a falsy far net — so deleting
 * 176 of them must move NOTHING. That is easy to assert loosely and worth
 * asserting sharply: each case below pins the value the ideal input gives AND
 * names the different value the dead declaration would have produced had it
 * ever run. A test that only checked "about 5 V" would pass either way.
 *
 * This file also carries the oracle for the `src/mna.js` half of the change
 * (F5 — the legacy `shift_register` builtin), which is why it lands in the
 * same commit as that edit.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

const HC595 = ['data', 'clock', 'latch', 'oe',
  'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'];

// An ideal pin is not EXACTLY at the rail: GMIN (1e-12 S from every node to
// the reference) draws 5e-12 A, which is 5e-8 V across a 10 kOhm pull-up. That
// is the whole error budget, and it is four orders of magnitude below the
// loading the deleted declarations claimed — which is the point.
const RAIL_TOL = 1e-7;

/** 5 V through `ohms` into one high-Z pin of `part`, and nothing else. */
function pullUpInto(part, terminals, pin, ohms = 10000) {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: part, params: {}, terminals: [...terminals] },
    { id: 'RU', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RU', terminal: 'a' }] },
    { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    { id: 'n_pin', terminals: [{ part: 'RU', terminal: 'b' }, { part: 'U1', terminal: pin }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  return b.nodeVoltage('n_pin');
}

describe('ideal high-Z inputs (the conductance no-op class)', () => {
  before(() => registerAllDevices());

  it('F5: a 74HC595 builtin input pin is ideal, not loaded by 10 MΩ', () => {
    // The deleted builtin declared `stampTwoTerminal(A, dataNet, undefined,
    // 1e-7, …)` — 10 MΩ — for data, clock and latch. Had it ever stamped,
    // a 10 kΩ pull-up would read
    //     5 × 10e6/(10e6 + 10e3) = 4.995004995 V.
    // The ideal input reads the rail exactly.
    const wouldHaveBeen = 5 * 10e6 / (10e6 + 10e3);
    for (const pin of ['data', 'clock', 'latch']) {
      const v = pullUpInto('shift_register', HC595, pin);
      assert.ok(Math.abs(v - 5) < RAIL_TOL,
        `${pin} sits at the rail: ${v.toFixed(9)} V`);
      assert.ok(Math.abs(v - wouldHaveBeen) > 4e-3,
        `${pin} is NOT the 10 MΩ-loaded ${wouldHaveBeen.toFixed(9)} V`);
    }
  });

  it('F1: a registered logic input is ideal too — the two 74HC595 paths agree', () => {
    // tier3-parts.js's `74hc595` model declared the same loading at 1 MΩ,
    // which would have read 5 × 1e6/(1e6 + 10e3) = 4.950495050 V. The builtin
    // and the registered model now say the same thing, which they did not
    // claim to before even though they always computed the same.
    const v = pullUpInto('74hc595',
      ['qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'qh', 'gnd',
        'qh_s', 'srclr', 'srclk', 'rclk', 'oe', 'ser', 'qa', 'vcc'],
      'srclk');
    const wouldHaveBeen = 5 * 1e6 / (1e6 + 10e3);
    assert.ok(Math.abs(v - 5) < RAIL_TOL, `srclk sits at the rail: ${v.toFixed(9)} V`);
    assert.ok(Math.abs(v - wouldHaveBeen) > 4e-2,
      `srclk is NOT the 1 MΩ-loaded ${wouldHaveBeen.toFixed(9)} V`);
  });

  it('F3: an unwired pin reads 0 V through GMIN, which is what the deleted pull-downs were credited with', () => {
    // The `crystal` model asked for 1/R_OPEN = 1e-12 S "to keep each pin a
    // real node" — numerically GMIN, which solveMNA adds to every node
    // anyway. Both pins of an otherwise unconnected crystal solve to 0.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'X1', kind: 'crystal', params: {}, terminals: ['a', 'b'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      { id: 'n_a', terminals: [{ part: 'X1', terminal: 'a' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_b', terminals: [{ part: 'X1', terminal: 'b' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    assert.ok(Math.abs(b.nodeVoltage('n_a')) < RAIL_TOL, 'a solves, at 0 V');
    assert.ok(Math.abs(b.nodeVoltage('n_b')) < RAIL_TOL, 'the island pin solves too, at 0 V');
  });

  it('the 555 divider is NOT in this class: both its legs are real and it stamps', () => {
    // Reported as part of the no-op class and it never was. The internal
    // 5k/10k divider holds the control pin at 2/3 VCC — 3.3333 V on a 5 V
    // rail — which is only possible because the stamp runs.
    const T = ['vcc', 'gnd', 'trigger', 'threshold', 'control',
      'discharge', 'output', 'reset'];
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'timer_555', params: {}, terminals: [...T] },
    ];
    const nets = [
      { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
      { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
      { id: 'n_ctl', terminals: [{ part: 'U1', terminal: 'control' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    const v = b.nodeVoltage('n_ctl');
    assert.ok(Math.abs(v - 10 / 3) < 1e-6,
      `control sits at 2/3 VCC = 3.333333 V, got ${v.toFixed(6)}`);
  });
});
