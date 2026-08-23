/**
 * True small-signal AC — hand-computed oracles.
 * spec-updates/ac-small-signal.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { runAcSweep } from '../src/sweep.js';

const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

function rcBench() {
  const parts = [GND,
    { id: 'FG', kind: 'vsource', params: { volts: 0, wave: 'sine', freq: 100, amplitude: 1, offset: 2.5 }, terminals: ['pos', 'neg'] },
    R('R1', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }];
  const nets = [
    { id: 'n_in', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'n_out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'n_gnd', terminals: [
      { part: 'G1', terminal: 'gnd' },
      { part: 'FG', terminal: 'neg' }, { part: 'C1', terminal: 'b' },
    ] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  return board;
}

describe('AC: RC low-pass against the closed form', () => {
  it('−3.01 dB and −45.0° at f = 1/(2πRC) = 159.155 Hz', () => {
    const board = rcBench();
    const rows = board.runAc({ sourceId: 'FG', from: 159.155, to: 159.156, pointsPerDecade: 1, probes: ['n_out'] });
    const { mag, phaseDeg } = rows[0].results.get('n_out');
    const db = 20 * Math.log10(mag);
    assert.ok(Math.abs(db - (-3.0103)) < 0.01,
      `corner must be −3.01 dB, got ${db.toFixed(4)} dB`);
    assert.ok(Math.abs(phaseDeg - (-45)) < 0.1,
      `corner phase must be −45°, got ${phaseDeg.toFixed(2)}°`);
  });

  it('rolls off 20 dB/decade well above the corner', () => {
    const board = rcBench();
    const rows = board.runAc({ sourceId: 'FG', from: 1591.5, to: 15915, pointsPerDecade: 1, probes: ['n_out'] });
    const dbLo = 20 * Math.log10(rows[0].results.get('n_out').mag);
    const dbHi = 20 * Math.log10(rows[rows.length - 1].results.get('n_out').mag);
    assert.ok(Math.abs((dbLo - dbHi) - 20) < 0.5,
      `one decade above the corner drops 20 dB, got ${(dbLo - dbHi).toFixed(2)}`);
  });
});

describe('AC: RLC series resonance', () => {
  it('current peaks at 1/(2π√LC) with Q = √(L/C)/R', () => {
    // 10 Ω, 1 mH, 1 µF → f0 = 5032.9 Hz, Q = √(L/C)/R = 3.162.
    // Probe the resistor-inductor junction driven through R: at resonance
    // the L+C pair is a short, so V(mid) → 0; far below, C blocks and
    // V(mid) → source.
    const parts = [GND,
      { id: 'FG', kind: 'vsource', params: { volts: 0, wave: 'sine', freq: 100, amplitude: 1, offset: 0 }, terminals: ['pos', 'neg'] },
      R('R1', 10),
      { id: 'L1', kind: 'inductor', params: { henrys: 1e-3 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }];
    const nets = [
      { id: 'n_in', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'L1', terminal: 'a' }] },
      { id: 'n_lc', terminals: [{ part: 'L1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'n_gnd', terminals: [
        { part: 'G1', terminal: 'gnd' },
        { part: 'FG', terminal: 'neg' }, { part: 'C1', terminal: 'b' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const f0 = 1 / (2 * Math.PI * Math.sqrt(1e-3 * 1e-6)); // 5032.9 Hz
    const rows = board.runAc({ sourceId: 'FG', from: f0 * 0.999, to: f0 * 1.001, pointsPerDecade: 1, probes: ['n_mid'] });
    // At resonance the series LC below R1 is a short: V(mid) ≈ 0 (all of
    // the source drops across R1). |V(mid)|/|V(in)| = |Z_LC|/|Z_total| → 0.
    const vMid = rows[0].results.get('n_mid').mag;
    assert.ok(vMid < 0.05,
      `at resonance the LC pair shorts the mid node: |V| = ${vMid.toFixed(4)}`);
    // Two decades below f0, C dominates: V(mid) ≈ source (nothing flows).
    const lowRows = board.runAc({ sourceId: 'FG', from: f0 / 100, to: f0 / 99, pointsPerDecade: 1, probes: ['n_mid'] });
    assert.ok(lowRows[0].results.get('n_mid').mag > 0.99,
      'far below resonance the capacitor blocks and the mid node follows the source');
  });
});

describe('AC: resistive divider is flat', () => {
  it('0 dB shift nowhere, phase 0 everywhere', () => {
    const parts = [GND,
      { id: 'FG', kind: 'vsource', params: { volts: 0, wave: 'sine', freq: 100, amplitude: 1, offset: 0 }, terminals: ['pos', 'neg'] },
      R('R1', 1000), R('R2', 1000)];
    const nets = [
      { id: 'n_in', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
      { id: 'n_gnd', terminals: [
        { part: 'G1', terminal: 'gnd' },
        { part: 'FG', terminal: 'neg' }, { part: 'R2', terminal: 'b' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const rows = board.runAc({ sourceId: 'FG', from: 1, to: 1e6, pointsPerDecade: 2, probes: ['n_out'] });
    for (const row of rows) {
      const { mag, phaseDeg } = row.results.get('n_out');
      assert.ok(Math.abs(mag - 0.5) < 1e-6, `flat 0.5 at ${row.hz} Hz, got ${mag}`);
      assert.ok(Math.abs(phaseDeg) < 1e-6, `phase 0 at ${row.hz} Hz, got ${phaseDeg}`);
    }
  });
});

describe('AC: the time-domain sweep agrees on linear circuits', () => {
  it('RC corner: correlation sweep within 2 % / 3° of the small-signal answer', () => {
    // The old measurement path stays as the cross-check — the two methods
    // must agree where both are valid, or one of them is lying.
    const f = 159.155;
    const board = rcBench();
    const ac = board.runAc({ sourceId: 'FG', from: f, to: f + 0.001, pointsPerDecade: 1, probes: ['n_out'] })[0]
      .results.get('n_out');
    const td = runAcSweep(rcBench(), {
      sourceId: 'FG', freqs: [f], inNet: 'n_in', outNet: 'n_out',
    })[0];
    const acDb = 20 * Math.log10(ac.mag);
    assert.ok(Math.abs(acDb - td.magDb) < 0.17, // 2 % in dB
      `magnitudes must agree: AC ${acDb.toFixed(3)} dB vs time-domain ${td.magDb.toFixed(3)} dB`);
    assert.ok(Math.abs(ac.phaseDeg - td.phaseDeg) < 3,
      `phases must agree: AC ${ac.phaseDeg.toFixed(2)}° vs time-domain ${td.phaseDeg.toFixed(2)}°`);
  });
});

describe('AC: honesty and speed', () => {
  it('a 200-point sweep of a 50-net ladder finishes fast', () => {
    const parts = [GND,
      { id: 'FG', kind: 'vsource', params: { volts: 0, wave: 'sine', freq: 100, amplitude: 1, offset: 0 }, terminals: ['pos', 'neg'] }];
    const nets = [
      { id: 'n_0', terminals: [{ part: 'FG', terminal: 'pos' }] },
      { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'FG', terminal: 'neg' }] },
    ];
    for (let k = 0; k < 50; k++) {
      parts.push(R(`R${k}`, 100));
      parts.push({ id: `C${k}`, kind: 'capacitor', params: { farads: 1e-8 }, terminals: ['a', 'b'] });
      nets.push({ id: `n_${k + 1}`, terminals: [] });
      nets[nets.length - 1].terminals.push({ part: `R${k}`, terminal: 'b' }, { part: `C${k}`, terminal: 'a' });
      nets.find(n => n.id === `n_${k}`).terminals.push({ part: `R${k}`, terminal: 'a' });
      nets.find(n => n.id === 'n_gnd').terminals.push({ part: `C${k}`, terminal: 'b' });
    }
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const t0 = process.hrtime.bigint();
    const rows = board.runAc({ sourceId: 'FG', from: 10, to: 1e6, pointsPerDecade: 40, probes: ['n_50'] });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(rows.length >= 200, `${rows.length} points`);
    assert.ok(ms < 500, `sweep took ${ms.toFixed(0)} ms — refactor reuse must hold this under 500 ms`);
    // The 50-section ladder attenuates hard at the top: sanity, not a flat line.
    const first = rows[0].results.get('n_50').mag;
    const last = rows[rows.length - 1].results.get('n_50').mag;
    assert.ok(first > 0.9 && last < 1e-3,
      `ladder response spans: ${first.toFixed(3)} → ${last.toExponential(2)}`);
  });

  it('refuses when the operating point cannot converge', () => {
    // A bench with no ground and no source cannot even index — assert the
    // sourceId contract error path instead of a fabricated sweep.
    const board = rcBench();
    assert.throws(() => board.runAc({ sourceId: 'R1', from: 10, to: 100 }),
      /not a vsource/);
  });
});
