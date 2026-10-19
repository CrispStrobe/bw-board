/**
 * Op-amp GBW + slew macromodel — hand oracles per
 * spec-updates/opamp-macromodel.md. Defaults: A0 1e5, GBW 1 MHz,
 * SR 0.5 V/µs, Cint 30 pF, Rout 100 Ω.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

function follower(macro = true) {
  const parts = [GND,
    { id: 'FG', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
    { id: 'U1', kind: 'opamp',
      params: macro ? { model: 'macro', railLow: -10, railHigh: 10 } : { railLow: -10, railHigh: 10 },
      terminals: ['inp', 'inn', 'out'] },
    R('RL', 10000)];
  const nets = [
    { id: 'n_in', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
    { id: 'n_out', terminals: [
      { part: 'U1', terminal: 'out' }, { part: 'U1', terminal: 'inn' },
      { part: 'RL', terminal: 'a' },
    ] },
    { id: 'n_gnd', terminals: [
      { part: 'G1', terminal: 'gnd' },
      { part: 'FG', terminal: 'neg' }, { part: 'RL', terminal: 'b' },
    ] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  return board;
}

describe('macromodel: DC and default-identity', () => {
  it('follower DC error ≈ 1/A0', () => {
    const b = follower(true);
    // The internal pole starts uncharged; the CLOSED loop settles with
    // τ = 1/(2π·GBW) ≈ 159 ns, so 10 µs is deep steady state.
    b.advanceTo(10_000n * 1000n);
    const v = b.nodeVoltage('n_out');
    // v = 2.5·A0/(1+A0) → error 25 µV. Rout adds nothing into 10 kΩ here
    // beyond the loop's own division.
    assert.ok(Math.abs(v - 2.5) < 1e-3, `follower holds 2.5 V, got ${v}`);
    assert.ok(Math.abs(v - 2.5) > 1e-8, 'and the error is FINITE (not the ideal row)');
  });

  it("without model:'macro' the ideal row answers, bit-identical", () => {
    const b = follower(false);
    const v = b.nodeVoltage('n_out');
    // Ideal 1e6 gain: error 2.5 µV — and no hidden parts in the solve.
    assert.ok(Math.abs(v - 2.5) < 1e-4);
    assert.ok(!b._solveParts.some(p => p.id.includes('_g1')), 'no expansion');
  });
});

describe('macromodel: frequency response (the point of E3.1)', () => {
  it('follower −3 dB at GBW; passband flat', () => {
    const b = follower(true);
    const rows = b.runAc({ sourceId: 'FG', from: 1e3, to: 4e6, pointsPerDecade: 40, probes: ['n_out'] });
    const at = (hz) => rows.reduce((best, r) =>
      Math.abs(r.hz - hz) < Math.abs(best.hz - hz) ? r : best);
    const dbAt = (hz) => 20 * Math.log10(at(hz).results.get('n_out').mag);
    assert.ok(Math.abs(dbAt(1e3)) < 0.01, `passband flat at 1 kHz: ${dbAt(1e3).toFixed(4)} dB`);
    const corner = dbAt(1e6);
    assert.ok(Math.abs(corner - (-3.01)) < 0.5,
      `−3 dB at GBW = 1 MHz (grid-limited), got ${corner.toFixed(3)} dB`);
    // A decade past GBW the follower rolls off ~20 dB/decade; the ideal
    // row would still read 0 dB out here — that contrast IS the feature.
  });

  it('inverting ×10: −3 dB near GBW/11', () => {
    const parts = [GND,
      { id: 'FG', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      R('RIN', 1000), R('RF', 10000),
      { id: 'U1', kind: 'opamp', params: { model: 'macro', railLow: -10, railHigh: 10 },
        terminals: ['inp', 'inn', 'out'] }];
    const nets = [
      { id: 'n_in', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'RIN', terminal: 'a' }] },
      { id: 'n_sum', terminals: [
        { part: 'RIN', terminal: 'b' }, { part: 'RF', terminal: 'a' },
        { part: 'U1', terminal: 'inn' },
      ] },
      { id: 'n_out', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'RF', terminal: 'b' }] },
      { id: 'n_gnd', terminals: [
        { part: 'G1', terminal: 'gnd' },
        { part: 'FG', terminal: 'neg' }, { part: 'U1', terminal: 'inp' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const rows = board.runAc({ sourceId: 'FG', from: 1e3, to: 1e6, pointsPerDecade: 60, probes: ['n_out'] });
    const dbs = rows.map(r => ({ hz: r.hz, db: 20 * Math.log10(r.results.get('n_out').mag) }));
    const passband = dbs[0].db;
    assert.ok(Math.abs(passband - 20) < 0.05, `×10 = 20 dB in the passband, got ${passband.toFixed(3)}`);
    // Find the −3 dB point: expected at GBW/11 = 90.9 kHz.
    const corner = dbs.find(d => d.db < passband - 3);
    assert.ok(corner && corner.hz > 60e3 && corner.hz < 130e3,
      `corner near 90.9 kHz, got ${corner ? (corner.hz / 1e3).toFixed(1) : 'none'} kHz`);
  });
});

describe('macromodel: slew', () => {
  it('a large step ramps at 0.5 V/µs, not instantly', () => {
    const b = follower(true);
    b.advanceTo(20_000n * 1000n); // settle at 2.5 V first
    // Step the source 2.5 → 6.5 V (4 V step) and watch the ramp.
    b.setControl('FG', 6.5);
    const t0 = 20_000n * 1000n;
    const samples = [];
    for (let us = 1; us <= 12; us++) {
      b.advanceTo(t0 + BigInt(us) * 1000n);
      samples.push(b.nodeVoltage('n_out'));
    }
    // Expected: ~0.5 V/µs from 2.5 → reaches 6.5 after ~8 µs.
    const at3us = samples[2];
    const at6us = samples[5];
    const slope = (at6us - at3us) / 3e-6; // V/s over the mid-ramp
    assert.ok(Math.abs(slope - 0.5e6) < 0.15e6,
      `mid-ramp slope must be ~0.5 V/µs, got ${(slope / 1e6).toFixed(3)} V/µs`);
    assert.ok(samples[0] < 3.6, `1 µs in, the output has moved ≤ ~0.5 V + step artifacts: ${samples[0]}`);
    assert.ok(samples[11] > 6.4, `settled by 12 µs: ${samples[11]}`);
  });
});
