/**
 * The transient starts FROM the power-on operating point, junction charge
 * included.
 *
 * At power-on the DC operating point has Q2 on (its base fed from the
 * collector of Q1, which a discharged hold capacitor keeps off), so Q2's collector -- a counter's clock --
 * sits low. The transient then started with Q2's junction capacitances at
 * 0 V, i.e. with its base uncharged: for ~10 ns Q2 was off, the clock line
 * pulsed high and fell again, and a falling-edge counter counted once in the
 * first microsecond of a circuit in which nothing happened (sb3
 * lab-barrier-counter carried a 1 nF capacitor on its clock as a workaround).
 * A device's own capacitances (pF, charged within nanoseconds of power-on)
 * start at the power-on operating point; drawn capacitors keep the board's
 * power-on-at-rest rule.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const Q = (id) => ({ id, kind: 'npn', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] });

function bench() {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    R('RB1', 10e3), { id: 'CH', kind: 'capacitor', params: { farads: 220e-9 }, terminals: ['a', 'b'] }, Q('Q1'), R('RC1', 10e3), R('RB2', 10e3), Q('Q2'), R('RC2', 10e3),
    { id: 'CNT', kind: '74hc93', params: {}, terminals: ['clk_a', 'clk_b', 'r0_1', 'r0_2', 'qa', 'qb', 'qc', 'qd', 'vcc', 'gnd'] },
  ], [
    net('vcc', ['V', 'pos'], ['RC1', 'a'], ['RC2', 'a'], ['CNT', 'vcc']),
    net('b1', ['RB1', 'b'], ['Q1', 'base']),
    net('h', ['RB1', 'a'], ['CH', 'a']),
    net('c1', ['Q1', 'collector'], ['RC1', 'b'], ['RB2', 'a']),
    net('b2', ['RB2', 'b'], ['Q2', 'base']),
    net('clk', ['Q2', 'collector'], ['RC2', 'b'], ['CNT', 'clk_a']),
    net('qa', ['CNT', 'qa'], ['CNT', 'clk_b']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['CH', 'b'], ['Q1', 'emitter'], ['Q2', 'emitter'],
      ['CNT', 'gnd'], ['CNT', 'r0_1'], ['CNT', 'r0_2']),
  ]);
  b.setPower(true);
  return b;
}

describe('the transient starts from the power-on operating point', () => {
  it('a transistor on at power-on stays on: its collector clock never pulses, the counter stays at 0', () => {
    const b = bench();
    let hi = 0;
    for (let ns = 1; ns <= 2000; ns *= 2) {
      b.advanceTo(BigInt(ns));
      hi = Math.max(hi, b.nodeVoltage('clk'));
    }
    b.advanceTo(1_000_000n);
    assert.equal(b.transientAnalysisStatus().failure, null);
    assert.ok(b.nodeVoltage('clk') < 0.3, `Q2 on: clock low (${b.nodeVoltage('clk')} V)`);
    assert.ok(hi < 1.5, `clock stayed low from t = 0 (peak ${hi.toFixed(2)} V)`);
    assert.equal(b.getDeviceState('CNT').count, 0, 'nothing was counted');
  });
});
