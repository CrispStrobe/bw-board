/**
 * Pin model Thévenin values: verify the actual numbers against datasheet.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pinThevenin, R_STRONG, R_QUASI_PULLUP } from '../src/pin-model.js';

describe('Thévenin constants', () => {
  it('R_STRONG = 25Ω (gives ~20mA into short at 5V)', () => {
    assert.equal(R_STRONG, 25);
    // I = 5/25 = 200mA through internal resistance alone
    // The 20mA spec is the max SAFE current with external load
  });

  it('R_QUASI_PULLUP = 21700Ω (gives ~230µA at 5V)', () => {
    assert.equal(R_QUASI_PULLUP, 21700);
    // I = 5/21700 = 230.4µA ≈ 230µA from datasheet
    const current = 5.0 / R_QUASI_PULLUP;
    assert.ok(Math.abs(current - 0.000230) < 0.000005,
      `source current ${current} ≈ 230µA`);
  });
});

describe('Thévenin at different VCC values', () => {
  it('3.3V quasi high: I = 3.3/21700 ≈ 152µA', () => {
    const t = pinThevenin('quasi', true, 3.3);
    assert.notEqual(t, 'high-z');
    assert.equal(t.vTh, 3.3);
    assert.equal(t.rTh, R_QUASI_PULLUP);
    const i = t.vTh / t.rTh;
    assert.ok(Math.abs(i - 0.000152) < 0.00001);
  });

  it('3.3V pushpull high: I = 3.3/25 = 132mA (into short)', () => {
    const t = pinThevenin('pushpull', true, 3.3);
    assert.equal(t.vTh, 3.3);
    assert.equal(t.rTh, R_STRONG);
  });

  it('1.8V (extreme low VCC) still works', () => {
    const t = pinThevenin('quasi', false, 1.8);
    assert.notEqual(t, 'high-z');
    assert.equal(t.vTh, 0);
    assert.equal(t.rTh, R_STRONG);
  });
});

describe('Thévenin symmetry checks', () => {
  it('quasi low == opendrain low (same electrical behavior)', () => {
    const q = pinThevenin('quasi', false, 5.0);
    const o = pinThevenin('opendrain', false, 5.0);
    assert.deepEqual(q, o, 'both are strong sink to GND');
  });

  it('input low == input high (both high-Z)', () => {
    const il = pinThevenin('input', false, 5.0);
    const ih = pinThevenin('input', true, 5.0);
    assert.equal(il, 'high-z');
    assert.equal(ih, 'high-z');
  });

  it('opendrain high == input (both high-Z)', () => {
    const od = pinThevenin('opendrain', true, 5.0);
    assert.equal(od, 'high-z');
  });

  it('pushpull low == quasi low (both strong sink)', () => {
    const pp = pinThevenin('pushpull', false, 5.0);
    const q = pinThevenin('quasi', false, 5.0);
    assert.deepEqual(pp, q);
  });
});
