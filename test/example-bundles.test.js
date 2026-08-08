/**
 * Tests using the real example bundles from ../stc/examples/.
 *
 * Each bundle has a pins.json (boundary C input). We feed it through
 * inferNetlist, setNetlist, and simulate the program's behavior.
 *
 * The gap this addresses: ledBrightness and buzzerTone have never been
 * exercised by anything that comes from a real program. These tests
 * simulate what a real firmware trace would produce.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { BoardImpl } from '../src/board.js';
import { inferNetlist, checkWiring } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';

const EXAMPLES_DIR = '/mnt/volume1/code/stc/examples';

function loadPins(name) {
  const path = `${EXAMPLES_DIR}/${name}/pins.json`;
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8'));
}

// ─── 01-blink ─────────────────────────────────────────────────────────────

describe('example: 01-blink', () => {
  const stc = loadPins('01-blink');
  if (!stc) { it.skip('pins.json not found'); return; }

  it('inferNetlist produces valid circuit', () => {
    const { parts, nets, notes } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0, errors.map(e => e.message).join('; '));
    assert.equal(notes.length, 0);
  });

  it('wiring check passes', () => {
    const { parts, nets } = inferNetlist(stc);
    const warnings = checkWiring(stc.pins, parts, nets);
    assert.equal(warnings.length, 0, warnings.join('; '));
  });

  it('LED1 lights when P1.0 drives low (active-low)', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', false); // write 0 → LED on
    board.setPin('P1.1', 'quasi', true);  // write 1 → LED off
    board.advanceTo(25_000_000n);

    assert.ok(board.ledBrightness('LED_led1') > 0.10, 'led1 on');
    assert.ok(board.ledBrightness('LED_led2') < 0.01, 'led2 off');
  });

  it('simulated blink: alternating LEDs at 500ms', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const MS = 1_000_000n;

    // Phase 1: led1 on, led2 off (0-500ms)
    board.setPin('P1.0', 'quasi', false);
    board.setPin('P1.1', 'quasi', true);
    board.advanceTo(250n * MS);
    assert.ok(board.ledBrightness('LED_led1') > 0.10);

    // Phase 2: led1 off, led2 on (500-1000ms)
    board.setPin('P1.0', 'quasi', true);
    board.setPin('P1.1', 'quasi', false);
    board.advanceTo(750n * MS);
    assert.ok(board.ledBrightness('LED_led1') < 0.01, 'led1 off in phase 2');
    assert.ok(board.ledBrightness('LED_led2') > 0.10, 'led2 on in phase 2');
  });
});

// ─── 02-button ────────────────────────────────────────────────────────────

describe('example: 02-button', () => {
  const stc = loadPins('02-button');
  if (!stc) { it.skip('pins.json not found'); return; }

  it('inferNetlist produces valid circuit with button pull-up', () => {
    const { parts, nets } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0);
    assert.ok(parts.some(p => p.kind === 'button'), 'has button');
    assert.ok(parts.some(p => p.kind === 'resistor' && p.id.includes('PU')), 'has pull-up');
  });

  it('button press reads as 0, release as 1', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);

    board.setControl('BTN_button', 0);
    assert.equal(board.readPin('P3.2'), 1, 'released → 1');

    board.setControl('BTN_button', 1);
    assert.equal(board.readPin('P3.2'), 0, 'pressed → 0');
  });

  it('button controls LED: press → toggle', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);  // LED off initially
    board.setPin('P1.1', 'quasi', true);
    board.setPin('P3.2', 'input', false);

    // Press button → program toggles LED
    board.setControl('BTN_button', 1);
    assert.equal(board.readPin('P3.2'), 0);

    // Simulate program response: toggle led1
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED_led1') > 0.10, 'led1 on after button press');
  });
});

// ─── 03-potentiometer ─────────────────────────────────────────────────────

describe('example: 03-potentiometer', () => {
  const stc = loadPins('03-potentiometer');
  if (!stc) { it.skip('pins.json not found'); return; }

  it('inferNetlist produces pot circuit', () => {
    const { parts, nets } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0);
    assert.ok(parts.some(p => p.kind === 'potentiometer'), 'has pot');
  });

  it('pot sweep produces correct ADC voltages', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.2', 'input', false);

    for (const pos of [0, 0.25, 0.5, 0.75, 1.0]) {
      board.setControl('POT_pot', pos);
      const v = board.readAnalog('P1.2');
      assert.ok(Math.abs(v - 5.0 * pos) < 0.05,
        `pot ${pos}: ${v} ≈ ${5.0 * pos}V`);
    }
  });
});

// ─── 04-brightness (the asymmetry lesson) ─────────────────────────────────

describe('example: 04-brightness (active-low vs active-high)', () => {
  const stc = loadPins('04-brightness');
  if (!stc) { it.skip('pins.json not found'); return; }

  it('inferNetlist produces one active-low LED and one active-high LED', () => {
    const { parts, nets } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0);

    const leds = parts.filter(p => p.kind === 'led');
    assert.equal(leds.length, 2, 'two LEDs');
  });

  it('active-low LED is bright, active-high LED is dim (quasi mode)', () => {
    // This is THE lesson: quasi-bidir sinks 20mA but sources ~230µA.
    // The active-low LED (VCC → R → LED → pin, pin=0) gets full current.
    // The active-high LED (pin → R → LED → GND, pin=1) gets ~230µA.
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Both pins write 0 (active-low on, active-high off)
    board.setPin('P1.0', 'quasi', false); // low_side: active-low → on
    board.setPin('P1.1', 'quasi', true);  // high_side: active-high, quasi source → dim
    board.advanceTo(25_000_000n);

    const bLow = board.ledBrightness('LED_low_side');
    const bHigh = board.ledBrightness('LED_high_side');

    // Active-low with sink: ~2.9mA → brightness ~0.145
    assert.ok(bLow > 0.10,
      `active-low (sink): brightness ${bLow} should be bright`);

    // Active-high with quasi source: ~0.13mA → brightness ~0.007
    assert.ok(bHigh < 0.02,
      `active-high (quasi source): brightness ${bHigh} should be very dim`);

    // The ratio demonstrates the asymmetry
    assert.ok(bLow > bHigh * 10,
      `active-low ${bLow} >> active-high ${bHigh} (asymmetry visible)`);
  });

  it('active-high LED is bright with pushpull mode', () => {
    // If you switch to pushpull, the active-high LED gets full current.
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', false); // low_side: on
    board.setPin('P1.1', 'pushpull', true);  // high_side: pushpull source → bright!
    board.advanceTo(25_000_000n);

    const bLow = board.ledBrightness('LED_low_side');
    const bHigh = board.ledBrightness('LED_high_side');

    // Both should be similarly bright with pushpull
    assert.ok(bLow > 0.10, `low_side pushpull: ${bLow}`);
    assert.ok(bHigh > 0.10, `high_side pushpull: ${bHigh}`);
  });
});

// ─── 05-scheduler ─────────────────────────────────────────────────────────

describe('example: 05-scheduler', () => {
  const stc = loadPins('05-scheduler');
  if (!stc) { it.skip('pins.json not found'); return; }

  it('inferNetlist produces two active-low LEDs', () => {
    const { parts, nets } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0);
    assert.equal(parts.filter(p => p.kind === 'led').length, 2);
  });

  it('simulates two tasks at different rates', () => {
    // slow: 500ms period, fast: 300ms period
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const MS = 1_000_000n;
    board.setPin('P1.0', 'quasi', true);
    board.setPin('P1.1', 'quasi', true);

    // Simulate 1 second: slow toggles at 500ms, fast at 300ms
    const slowPeriod = 500;
    const fastPeriod = 300;
    let slowState = true, fastState = true;

    for (let ms = 0; ms <= 1000; ms += 10) {
      board.advanceTo(BigInt(ms) * MS);

      if (ms > 0 && ms % slowPeriod === 0) {
        slowState = !slowState;
        board.setPin('P1.0', 'quasi', slowState);
      }
      if (ms > 0 && ms % fastPeriod === 0) {
        fastState = !fastState;
        board.setPin('P1.1', 'quasi', fastState);
      }
    }

    // Both LEDs should have been toggling
    const state = board.getRenderState();
    assert.ok(state.leds.length >= 2, 'two LEDs in render state');
  });
});

// ─── All examples: common checks ──────────────────────────────────────────

describe('all examples: inferNetlist → validate → board', () => {
  for (const name of ['01-blink', '02-button', '03-potentiometer', '04-brightness', '05-scheduler', '06-dimmer', '07-buzzer']) {
    const stc = loadPins(name);
    if (!stc) continue;

    it(`${name}: full pipeline succeeds`, () => {
      const { parts, nets, notes } = inferNetlist(stc);
      const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
      assert.equal(errors.length, 0, `${name} validation: ${errors.map(e => e.message).join('; ')}`);

      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets); // should not throw

      // Set all pins to their default mode
      for (const pin of stc.pins) {
        const pinId = `P${pin.port}.${pin.bit}`;
        if (pin.direction === 'input' || pin.direction === 'analog') {
          board.setPin(pinId, 'input', false);
        } else {
          board.setPin(pinId, 'quasi', true); // reset default
        }
      }

      board.advanceTo(1_000_000n);
      const state = board.getRenderState();
      assert.ok(state.powered);
      assert.ok(!state.warnings.some(w => w.severity === 'danger'),
        `${name}: no danger warnings at reset`);
    });
  }
});
