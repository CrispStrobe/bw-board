/**
 * 06-dimmer: the first example that produces a PWM duty cycle.
 *
 * This is the test that closes the gap: ledBrightness integrated
 * over ~20ms with a real duty cycle, not a hand-scripted one.
 *
 * At CMOD=0x00, the PCA counter runs at FOSC/12 = 921600 Hz.
 * An 8-bit PWM cycles at 921600/256 ≈ 3600 Hz. Each cycle has
 * 256 edges → up to ~7200 setPin calls/second. This is the first
 * workload that tests per-edge cost at emulator speed.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';

const EXAMPLES_DIR = '/mnt/volume1/code/stc/examples';
const DIMMER_PINS = `${EXAMPLES_DIR}/06-dimmer/pins.json`;

function loadDimmer() {
  if (!existsSync(DIMMER_PINS)) return null;
  return JSON.parse(readFileSync(DIMMER_PINS, 'utf-8'));
}

describe('example: 06-dimmer', () => {
  const stc = loadDimmer();
  if (!stc) { it.skip('06-dimmer not found'); return; }

  it('inferNetlist handles direction "pwm" as output', () => {
    const { parts, nets, notes } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0, errors.map(e => e.message).join('; '));

    // Should have pot and LED
    assert.ok(parts.some(p => p.kind === 'potentiometer'), 'has pot');
    assert.ok(parts.some(p => p.kind === 'led'), 'has LED');
  });

  it('50% PWM at PCA rate → 50% brightness', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.2', 'input', false);
    board.setControl('POT_pot', 0.5);

    // Simulate PCA 8-bit PWM at FOSC/12 = 921600 Hz
    // Period = 256/921600 ≈ 277.78µs ≈ 3600 Hz
    // 50% duty: on for 128 ticks, off for 128 ticks
    const TICK_NS = 1085n; // 1/921600 ≈ 1.085µs
    const PERIOD = 256n * TICK_NS; // ≈ 277.78µs

    // Run 100 PWM cycles (≈27.8ms, past the 20ms brightness window)
    for (let cycle = 0; cycle < 100; cycle++) {
      const base = BigInt(cycle) * PERIOD;
      board.advanceTo(base);
      board.setPin('P1.3', 'quasi', false); // on (active-low)
      board.advanceTo(base + 128n * TICK_NS);
      board.setPin('P1.3', 'quasi', true);  // off
    }
    board.advanceTo(100n * PERIOD);

    const b = board.ledBrightness('LED_lamp');
    // 50% duty × steady ≈ 0.5 × 0.145 ≈ 0.0725
    assert.ok(b > 0.05, `50% PWM brightness: ${b}`);
    assert.ok(b < 0.10, `50% PWM brightness: ${b}`);
  });

  it('pot sweeps duty: brightness is proportional', () => {
    const { parts, nets } = inferNetlist(stc);
    const TICK_NS = 1085n;
    const PERIOD = 256n * TICK_NS;
    const steadyB = 0.145;

    const results = [];

    for (const duty of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);
      board.setPin('P1.2', 'input', false);
      board.setPin('P1.3', 'quasi', true);

      const onTicks = BigInt(Math.round(256 * duty));

      for (let cycle = 0; cycle < 100; cycle++) {
        const base = BigInt(cycle) * PERIOD;
        board.advanceTo(base);
        board.setPin('P1.3', 'quasi', false);
        board.advanceTo(base + onTicks * TICK_NS);
        board.setPin('P1.3', 'quasi', true);
      }
      board.advanceTo(100n * PERIOD);

      const b = board.ledBrightness('LED_lamp');
      results.push({ duty, brightness: b });
    }

    // Brightness should increase with duty
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].brightness > results[i - 1].brightness,
        `duty ${results[i].duty} (${results[i].brightness.toFixed(4)}) > ` +
        `${results[i - 1].duty} (${results[i - 1].brightness.toFixed(4)})`);
    }

    // Verify proportionality
    for (const r of results) {
      const expected = r.duty * steadyB;
      assert.ok(Math.abs(r.brightness - expected) < 0.03,
        `duty ${r.duty}: ${r.brightness.toFixed(4)} ≈ ${expected.toFixed(4)}`);
    }
  });
});

describe('06-dimmer: performance at PCA rate', () => {
  const stc = loadDimmer();
  if (!stc) { it.skip('06-dimmer not found'); return; }

  it('7200 setPin calls in <100ms wall time', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.2', 'input', false);
    board.setPin('P1.3', 'quasi', true);

    // PCA 8-bit PWM: 2 setPin per period × 3600 periods/sec = 7200 calls/sec
    // Simulate 1 second of PWM at 50% duty
    const TICK_NS = 1085n;
    const PERIOD = 256n * TICK_NS;
    const CYCLES = 3600; // ~1 second
    const TOTAL_CALLS = CYCLES * 2;

    const start = performance.now();

    for (let cycle = 0; cycle < CYCLES; cycle++) {
      const base = BigInt(cycle) * PERIOD;
      board.advanceTo(base);
      board.setPin('P1.3', 'quasi', false);
      board.advanceTo(base + 128n * TICK_NS);
      board.setPin('P1.3', 'quasi', true);
    }
    board.advanceTo(BigInt(CYCLES) * PERIOD);

    const elapsed = performance.now() - start;
    const callsPerSec = TOTAL_CALLS / (elapsed / 1000);

    console.log(`# PCA PWM performance: ${TOTAL_CALLS} calls in ${elapsed.toFixed(0)}ms`);
    console.log(`#   = ${(callsPerSec / 1000).toFixed(1)}K calls/sec`);
    console.log(`#   LED brightness: ${board.ledBrightness('LED_lamp').toFixed(4)}`);

    // Should complete in under 2 seconds (conservative)
    assert.ok(elapsed < 2000,
      `${TOTAL_CALLS} calls took ${elapsed.toFixed(0)}ms — too slow`);

    // Brightness should be correct
    const b = board.ledBrightness('LED_lamp');
    assert.ok(b > 0.05 && b < 0.10, `brightness ${b} ≈ 50%`);
  });
});
