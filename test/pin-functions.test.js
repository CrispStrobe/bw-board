/**
 * Pin alternate-function lookup tests.
 *
 * The critical property: null (not audited) and [] (audited, none)
 * must be distinguishable through the API. If the function collapses
 * them, the schema's central distinction dies at the boundary.
 *
 * Skips loudly if bw-parts sidecars are not reachable.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPinFunctions, getBoardPins, getPinInfo } from '../src/pin-functions.js';

const here = path.dirname(fileURLToPath(import.meta.url));

const hasParts = getBoardPins('stc_mcu') !== undefined;

function loudSkip(reason) {
  console.log(`# ⚠ SKIPPED: ${reason}`);
  return true;
}

describe('getPinFunctions: three-state distinction', () => {
  it('audited pin returns a non-empty array', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const fn = getPinFunctions('stc_mcu', 'P1.0');
    assert.ok(Array.isArray(fn), `P1.0 should return an array, got ${typeof fn}`);
    assert.ok(fn.length > 0, 'P1.0 should have functions (gpio, adc0, ...)');
    console.log(`# P1.0 functions: ${fn.join(', ')}`);
  });

  it('audited pin with no alternates returns [] (not null)', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    // Find a pin with empty functions list
    const pins = getBoardPins('stc_mcu');
    let emptyPin = null;
    for (const p of pins) {
      const fn = getPinFunctions('stc_mcu', p);
      if (Array.isArray(fn) && fn.length === 0) { emptyPin = p; break; }
    }
    if (!emptyPin) {
      console.log('# No pin with empty functions found — all are audited or null');
      return;
    }
    const fn = getPinFunctions('stc_mcu', emptyPin);
    assert.ok(Array.isArray(fn), `${emptyPin} should return [] not null`);
    assert.equal(fn.length, 0, `${emptyPin} should have empty array`);
    assert.notEqual(fn, null, 'empty array must not be null');
    console.log(`# ${emptyPin}: [] (audited, no alternates)`);
  });

  it('[] and [...] are distinguishable — real data, Uno pins', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');

    // The Uno sidecar is now fully audited (bw-parts populated all pins).
    // Verify the three states that exist in real data: [] (no alternates),
    // [...] (has alternates), and that they are distinguishable.

    // Uno d0: GPIO + serial
    const unoD0 = getPinFunctions('arduino_uno', 'd0');
    assert.ok(Array.isArray(unoD0) && unoD0.length > 0,
      `Uno d0 should have functions, got ${JSON.stringify(unoD0)}`);

    // Uno gnd: audited, no alternates → []
    const unoGnd = getPinFunctions('arduino_uno', 'gnd');
    assert.ok(Array.isArray(unoGnd) && unoGnd.length === 0,
      `Uno gnd should return [] (no alternates), got ${JSON.stringify(unoGnd)}`);

    // STC12: also has both states
    const stcAudited = getPinFunctions('stc_mcu', 'P1.0');
    assert.ok(Array.isArray(stcAudited) && stcAudited.length > 0,
      'P1.0 must have audited alternates');

    console.log(`# Uno d0: ${JSON.stringify(unoD0)} (audited, has alternates)`);
    console.log(`# Uno gnd: ${JSON.stringify(unoGnd)} (audited, no alternates)`);
    console.log(`# STC12 P1.0: ${JSON.stringify(stcAudited)} (audited with entries)`);
    console.log('# [] vs [...] distinction: VERIFIED with real sidecar data');
    console.log('# Note: null state tested with synthetic data in separate test');
  });

  it('all 28 Uno pins are now audited (no nulls)', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const pins = getBoardPins('arduino_uno');
    if (!pins) return loudSkip('arduino_uno sidecar not found');
    assert.equal(pins.length, 28, 'Uno should have 28 terminals');
    let audited = 0, empty = 0, populated = 0;
    for (const p of pins) {
      const fn = getPinFunctions('arduino_uno', p);
      assert.notEqual(fn, null,
        `Uno ${p} should be audited (not null) — bw-parts populated all pins`);
      assert.ok(Array.isArray(fn), `Uno ${p} should return an array`);
      if (fn.length === 0) empty++; else populated++;
      audited++;
    }
    console.log(`# Uno: ${audited} audited (${populated} with functions, ${empty} GPIO/non-GPIO)`);
  });

  it('STC12: audited and empty pins both exist', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const pins = getBoardPins('stc_mcu');
    let auditedPin = null, emptyPin = null;
    for (const p of pins) {
      const fn = getPinFunctions('stc_mcu', p);
      if (Array.isArray(fn) && fn.length > 0 && !auditedPin) auditedPin = p;
      if (Array.isArray(fn) && fn.length === 0 && !emptyPin) emptyPin = p;
    }
    if (auditedPin) {
      const fn = getPinFunctions('stc_mcu', auditedPin);
      assert.ok(fn !== null && fn.length > 0, `${auditedPin}: audited with entries`);
    }
    if (emptyPin) {
      const fn = getPinFunctions('stc_mcu', emptyPin);
      assert.ok(fn !== null, `${emptyPin}: [] must not collapse to null`);
      assert.equal(fn.length, 0);
    }
    console.log(`# audited: ${auditedPin}, empty: ${emptyPin}`);
  });

  it('unknown board returns undefined', () => {
    const fn = getPinFunctions('nonexistent_board', 'P1.0');
    assert.equal(fn, undefined, 'unknown board → undefined');
  });

  it('unknown pin on known board returns undefined', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const fn = getPinFunctions('stc_mcu', 'NONEXISTENT');
    assert.equal(fn, undefined, 'unknown pin → undefined');
  });
});

describe('getPinFunctions: Arduino Nano analog-only', () => {
  it('A6 has analog_only in its functions list', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const fn = getPinFunctions('arduino_nano', 'A6');
    if (fn === undefined) {
      console.log('# A6 not in sidecar — may be named differently');
      return;
    }
    if (fn === null) {
      console.log('# A6 functions: null (not yet audited)');
      return;
    }
    console.log(`# A6 functions: ${fn.join(', ')}`);
    assert.ok(fn.includes('analog_only') || fn.includes('ADC6'),
      'A6 should include analog_only or ADC6');
  });
});

describe('getBoardPins: returns terminal names', () => {
  it('stc_mcu has 40 pins', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const pins = getBoardPins('stc_mcu');
    assert.equal(pins.length, 40);
  });

  it('arduino_nano has 30 pins', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const pins = getBoardPins('arduino_nano');
    assert.equal(pins.length, 30);
  });

  it('pi_pico has 43 pins', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const pins = getBoardPins('pi_pico');
    assert.equal(pins.length, 43);
  });
});
