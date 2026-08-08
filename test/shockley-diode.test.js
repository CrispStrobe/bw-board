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

  it('Shockley has smooth transition where piecewise has a jump', () => {
    // Right at Vf: piecewise jumps from 1e-9 to 1/Rd
    const pw_below = diodeCompanion(1.99, 2.0, 10);
    const pw_above = diodeCompanion(2.01, 2.0, 10);
    const pwRatio = pw_above.gEq / pw_below.gEq;

    // Shockley: smooth exponential
    const sh_below = diodeCompanion(1.99, 2.0, 10, { shockley: true, n: 1.8 });
    const sh_above = diodeCompanion(2.01, 2.0, 10, { shockley: true, n: 1.8 });
    const shRatio = sh_above.gEq / sh_below.gEq;

    // Piecewise ratio should be enormous (1e8+), Shockley should be modest
    assert.ok(pwRatio > 1e6, `piecewise jump ratio: ${pwRatio}`);
    assert.ok(shRatio < 10, `Shockley smooth ratio: ${shRatio}`);
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
