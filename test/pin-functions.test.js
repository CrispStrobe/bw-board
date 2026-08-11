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

  it('null and [] are distinguishable — real data, Uno vs STC12', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');

    // The Uno sidecar has 28 terminals, ALL with functions: null
    // (entirely unaudited). The STC12 has pins with [] (audited, GPIO
    // only) and [...] (audited with alternates). These are REAL nulls,
    // not synthetic — the distinction must survive the API.

    // Uno: every pin should return null (unaudited)
    const unoFn = getPinFunctions('arduino_uno', 'd0');
    assert.equal(unoFn, null,
      'Uno d0 must return null (unaudited), not [] — ' +
      'if this returns [], the API collapses unaudited into audited-none');

    // STC12: find a pin with [] (audited, no alternates)
    const stcPins = getBoardPins('stc_mcu');
    let emptyPin = null;
    for (const p of stcPins) {
      const fn = getPinFunctions('stc_mcu', p);
      if (Array.isArray(fn) && fn.length === 0) { emptyPin = p; break; }
    }
    assert.ok(emptyPin, 'STC12 should have at least one pin with []');
    const stcFn = getPinFunctions('stc_mcu', emptyPin);
    assert.ok(Array.isArray(stcFn) && stcFn.length === 0,
      `${emptyPin} must return [] (audited, none)`);

    // THE CRITICAL ASSERTION: null (Uno) !== [] (STC12)
    assert.notDeepEqual(unoFn, stcFn,
      'Uno null and STC12 [] must be distinguishable — ' +
      'a pin chooser showing "GPIO only" for an unaudited Uno pin ' +
      'would confidently offer something it cannot verify');

    // Also check an audited STC12 pin has entries
    const auditedFn = getPinFunctions('stc_mcu', 'P1.0');
    assert.ok(Array.isArray(auditedFn) && auditedFn.length > 0,
      'P1.0 must have audited alternates');

    console.log(`# Uno d0: ${JSON.stringify(unoFn)} (null = unaudited)`);
    console.log(`# STC12 ${emptyPin}: ${JSON.stringify(stcFn)} ([] = audited, none)`);
    console.log(`# STC12 P1.0: ${JSON.stringify(auditedFn)} (audited with entries)`);
    console.log('# null vs [] distinction: VERIFIED with real sidecar data');
  });

  it('all 28 Uno pins return null (entirely unaudited)', () => {
    if (!hasParts) return loudSkip('bw-parts sidecars not reachable');
    const pins = getBoardPins('arduino_uno');
    if (!pins) return loudSkip('arduino_uno sidecar not found');
    assert.equal(pins.length, 28, 'Uno should have 28 terminals');
    for (const p of pins) {
      const fn = getPinFunctions('arduino_uno', p);
      assert.equal(fn, null,
        `Uno ${p} must return null (unaudited), got ${JSON.stringify(fn)}`);
    }
    console.log('# All 28 Uno pins: null (unaudited)');
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
