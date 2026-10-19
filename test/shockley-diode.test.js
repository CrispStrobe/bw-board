/**
 * Shockley diode model tests: exponential I-V curve, smooth knee,
 * temperature sensitivity, and comparison with piecewise model.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Import the companion function directly for unit testing
import { diodeCompanion } from '../src/mna.js';

describe('Shockley model: companion linearization', () => {
  it('below Vf: very low conductance (off)', () => {
    const { gEq, iEq } = diodeCompanion(0.5, 2.0, 10, { shockley: true, n: 1.8 });
    assert.ok(gEq < 0.001, `gEq below Vf: ${gEq} should be very small`);
  });

  it('at Vf: moderate conductance', () => {
    const { gEq } = diodeCompanion(2.0, 2.0, 10, { shockley: true, n: 1.8 });
    assert.ok(gEq > 0.01, `gEq at Vf: ${gEq} should be moderate`);
  });

  it('above Vf: high conductance', () => {
    const { gEq } = diodeCompanion(2.5, 2.0, 10, { shockley: true, n: 1.8 });
    assert.ok(gEq > 0.1, `gEq above Vf: ${gEq} should be high`);
  });

  it('reverse bias: essentially zero', () => {
    const { gEq } = diodeCompanion(-5.0, 2.0, 10, { shockley: true, n: 1.8 });
    assert.ok(gEq < 1e-6, `reverse: gEq ${gEq} ≈ 0`);
  });

  it('conductance increases monotonically with voltage', () => {
    const voltages = [-1, 0, 0.5, 1.0, 1.5, 1.8, 2.0, 2.2, 2.5];
    let prevG = 0;
    for (const v of voltages) {
      const { gEq } = diodeCompanion(v, 2.0, 10, { shockley: true, n: 1.8 });
      assert.ok(gEq >= prevG - 1e-15, `monotonic: V=${v}, gEq=${gEq} ≥ ${prevG}`);
      prevG = gEq;
    }
  });

  it('does not produce NaN or Infinity', () => {
    for (const v of [-100, -10, -1, 0, 1, 2, 5, 10, 50]) {
      const { gEq, iEq } = diodeCompanion(v, 2.0, 10, { shockley: true, n: 1.8 });
      assert.ok(Number.isFinite(gEq), `V=${v}: gEq=${gEq} finite`);
      assert.ok(Number.isFinite(iEq), `V=${v}: iEq=${iEq} finite`);
    }
  });
});

describe('Shockley vs piecewise: comparison', () => {
  it('both agree on "definitely on" (V >> Vf)', () => {
    const pw = diodeCompanion(3.0, 2.0, 10);
    const sh = diodeCompanion(3.0, 2.0, 10, { shockley: true, n: 1.8 });

    // Both should have high conductance
    assert.ok(pw.gEq > 0.05, `piecewise on: gEq=${pw.gEq}`);
    assert.ok(sh.gEq > 0.05, `Shockley on: gEq=${sh.gEq}`);
  });

  it('both agree on "definitely off" (V << Vf)', () => {
    const pw = diodeCompanion(0.5, 2.0, 10);
    const sh = diodeCompanion(0.5, 2.0, 10, { shockley: true, n: 1.8 });

    // Both should have very low conductance
    assert.ok(pw.gEq < 0.001, `piecewise off: gEq=${pw.gEq}`);
    assert.ok(sh.gEq < 0.001, `Shockley off: gEq=${sh.gEq}`);
  });

  it('piecewise is C1 inside its ±25 mV knee band, a knee outside it', () => {
    // The PWL knee gained a C1 parabolic blend over vf ± 25 mV
    // (2026-08-23): the HARD corner plus an inductor was a Newton
    // oscillator — the flyback decay tail parked the junction exactly at
    // vf and the on/off branches alternated forever. INSIDE the band the
    // conductance now ramps smoothly; OUTSIDE it both branches are
    // bit-identical to the original lines, so the knee is still a knee.
    const inBelow = diodeCompanion(1.99, 2.0, 10);
    const inAbove = diodeCompanion(2.01, 2.0, 10);
    const inRatio = inAbove.gEq / inBelow.gEq;
    assert.ok(inRatio < 10, `inside the band the blend is gentle: ${inRatio}`);

    const outBelow = diodeCompanion(1.94, 2.0, 10);   // below vf − 25 mV
    const outAbove = diodeCompanion(2.06, 2.0, 10);   // above vf + 25 mV
    assert.equal(outBelow.gEq, 1e-9, 'off line untouched outside the band');
    assert.ok(Math.abs(outAbove.gEq - 1 / 10) < 1e-12, 'on line untouched outside the band');
    assert.ok(outAbove.gEq / outBelow.gEq > 1e6,
      `across the whole band the knee is still a knee: ${outAbove.gEq / outBelow.gEq}`);

    // Band-edge continuity of the CURRENT (the C1 property the fix is for):
    // i = gEq·v + iEq evaluated from each side of both edges agrees.
    // Tolerance 10 nA: the off branch carries the deliberate 1 nS leak
    // (≈2 nA at 2 V) that the parabola does not — physically negligible,
    // numerically visible.
    const iOf = (r, v) => r.gEq * v + r.iEq;
    const lo = 2.0 - 0.025, hi = 2.0 + 0.025;
    assert.ok(Math.abs(iOf(diodeCompanion(lo - 1e-9, 2, 10), lo) - iOf(diodeCompanion(lo + 1e-9, 2, 10), lo)) < 1e-8);
    assert.ok(Math.abs(iOf(diodeCompanion(hi - 1e-9, 2, 10), hi) - iOf(diodeCompanion(hi + 1e-9, 2, 10), hi)) < 1e-8);

    // Shockley: smooth everywhere, unchanged.
    const sh_below = diodeCompanion(1.99, 2.0, 10, { shockley: true, n: 1.8 });
    const sh_above = diodeCompanion(2.01, 2.0, 10, { shockley: true, n: 1.8 });
    assert.ok(sh_above.gEq / sh_below.gEq < 10, 'Shockley smooth');
  });
});

describe('Shockley: ideality factor effect', () => {
  it('higher n → softer knee', () => {
    const sharp = diodeCompanion(1.5, 2.0, 10, { shockley: true, n: 1.0 });
    const soft = diodeCompanion(1.5, 2.0, 10, { shockley: true, n: 2.5 });

    // Higher n → more current at same voltage below Vf (softer knee)
    // Both should be "off-ish" at 1.5V < Vf=2.0V, but n=2.5 leaks more
    assert.ok(soft.gEq >= sharp.gEq,
      `n=2.5 (${soft.gEq}) ≥ n=1.0 (${sharp.gEq}) at V=1.5`);
  });
});

describe('Shockley: custom Is parameter', () => {
  it('smaller Is → less leakage', () => {
    const big = diodeCompanion(0.5, 0.7, 10, { shockley: true, n: 1.0, is: 1e-12 });
    const small = diodeCompanion(0.5, 0.7, 10, { shockley: true, n: 1.0, is: 1e-15 });

    assert.ok(big.gEq > small.gEq,
      `bigger Is (${big.gEq}) > smaller Is (${small.gEq})`);
  });
});
