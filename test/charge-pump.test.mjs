// Charge pumps against hand math — the transient-solver stress test.
//
// Switched-capacitor circuits exercise the exact interplay the German
// canon's "Spannung verdoppeln / negative Spannung" lessons depend on:
// a square source, series capacitors, and diodes that clamp and steer
// charge. The roadmap's condition (stc ROADMAP, cluster 6b) is that the
// engine's answer match the pencil-and-paper answer BEFORE any of this
// ships as a lesson.
//
// The oracles are self-calibrating: the diode's effective forward drop
// is MEASURED from the same engine first (a diode is Vf + rd·I here,
// piecewise-linear), then the classic formulas predict the pump outputs:
//   Villard doubler,  ±Vpk square:  Vout ≈ +(2·Vpk − 2·Vf)
//   Diode inverter,  0..+Vpk pulse: Vout ≈ −(Vpk − 2·Vf)
// A solver that mis-integrates the cap hand-off or lets a clamp leak
// will miss these by volts, not millivolts.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const US = 1_000n; // ns per µs

function measureDiodeDrop() {
  // 5 V through 4.7 k into a diode: the drop at ~0.9 mA, the same order
  // as the pumps' average charging current.
  const parts = [
    { id: 'vs', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'r1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'd1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'n_s', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
    { id: 'n_d', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'd1', terminal: 'anode' }] },
    { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'd1', terminal: 'cathode' }, { part: 'g1', terminal: 'gnd' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  b.advanceTo(1000n * US);
  return b.nodeVoltage('n_d');
}

/** Run a pump board for `cycles` of a 1 kHz clock, return V(out). */
function runPump(parts, nets, cycles) {
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  const stepNs = 5n * US;            // 5 µs → 200 samples per 1 kHz cycle
  const steps = BigInt(cycles) * 200n;
  let t = b.timeNs;
  for (let k = 0n; k < steps; k++) {
    t += stepNs;
    b.advanceTo(t);
  }
  return b.nodeVoltage('n_out');
}

describe('charge pumps vs hand math (the cluster-6b gate)', () => {
  const vf = measureDiodeDrop();

  it('the calibration diode drops like silicon', () => {
    assert.ok(vf > 0.4 && vf < 1.0, `measured Vf=${vf} — not a silicon diode`);
  });

  it('Villard doubler: a ±5 V square pumps to 2·Vpk − 2·Vf', () => {
    const parts = [
      { id: 'vs', kind: 'vsource', params: { wave: 'square', amplitude: 5, offset: 0, freq: 1000, volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'c1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'd1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] }, // clamp: gnd → A
      { id: 'd2', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] }, // steer: A → out
      { id: 'c2', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'rl', kind: 'resistor', params: { ohms: 1e6 }, terminals: ['a', 'b'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_clk', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'c1', terminal: 'a' }] },
      { id: 'n_a', terminals: [{ part: 'c1', terminal: 'b' }, { part: 'd1', terminal: 'cathode' }, { part: 'd2', terminal: 'anode' }] },
      { id: 'n_out', terminals: [{ part: 'd2', terminal: 'cathode' }, { part: 'c2', terminal: 'a' }, { part: 'rl', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'd1', terminal: 'anode' }, { part: 'c2', terminal: 'b' }, { part: 'rl', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const vout = runPump(parts, nets, 80);
    const predict = 2 * 5 - 2 * vf;
    assert.ok(Math.abs(vout - predict) < 0.4,
      `doubler: engine ${vout.toFixed(2)} V vs pencil ${predict.toFixed(2)} V (Vf=${vf.toFixed(2)})`);
    assert.ok(vout > 5.5, `a doubler must beat its own supply peak; got ${vout}`);
  });

  it('diode inverter: a 0..+5 V pulse pumps to −(Vpk − 2·Vf)', () => {
    const parts = [
      { id: 'vs', kind: 'vsource', params: { wave: 'pulse', amplitude: 5, offset: 0, freq: 1000, duty: 0.5, volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'c1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'd1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] }, // clamp: A → gnd
      { id: 'd2', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] }, // steer: out → A
      { id: 'c2', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'rl', kind: 'resistor', params: { ohms: 1e6 }, terminals: ['a', 'b'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_clk', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'c1', terminal: 'a' }] },
      { id: 'n_a', terminals: [{ part: 'c1', terminal: 'b' }, { part: 'd1', terminal: 'anode' }, { part: 'd2', terminal: 'cathode' }] },
      { id: 'n_out', terminals: [{ part: 'd2', terminal: 'anode' }, { part: 'c2', terminal: 'a' }, { part: 'rl', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'vs', terminal: 'neg' }, { part: 'd1', terminal: 'cathode' }, { part: 'c2', terminal: 'b' }, { part: 'rl', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const vout = runPump(parts, nets, 80);
    const predict = -(5 - 2 * vf);
    assert.ok(Math.abs(vout - predict) < 0.4,
      `inverter: engine ${vout.toFixed(2)} V vs pencil ${predict.toFixed(2)} V (Vf=${vf.toFixed(2)})`);
    assert.ok(vout < -1.5, `an inverter must actually go negative; got ${vout}`);
  });
});
