/**
 * 07-buzzer: the first example that produces a tone.
 *
 * direction:"tone" → buzzer between pin and GND.
 * Timer 1 toggles the GPIO; buzzerTone measures the toggle period.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardImpl } from '../src/board.js';
import { inferNetlist, checkWiring } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PINS_PATH = path.resolve(here, '../../stc/examples/07-buzzer/pins.json');

function loadBuzzer() {
  if (!existsSync(PINS_PATH)) return null;
  return JSON.parse(readFileSync(PINS_PATH, 'utf-8'));
}

describe('example: 07-buzzer', () => {
  const stc = loadBuzzer();
  if (!stc) { it.skip('07-buzzer not found'); return; }

  it('inferNetlist: direction "tone" creates buzzer, not LED', () => {
    const { parts, nets, notes } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0, errors.map(e => e.message).join('; '));

    // Should have a buzzer for the tone pin
    const buzzers = parts.filter(p => p.kind === 'buzzer');
    assert.equal(buzzers.length, 1, 'one buzzer');
    assert.equal(buzzers[0].id, 'BUZZ_buzzer');

    // Should NOT have an LED for the tone pin
    const leds = parts.filter(p => p.kind === 'led');
    assert.equal(leds.length, 0, 'no LED for tone pin');

    // Should have button with pull-up
    assert.ok(parts.some(p => p.kind === 'button'), 'has button');
  });

  it('wiring check passes', () => {
    const { parts, nets } = inferNetlist(stc);
    const warnings = checkWiring(stc.pins, parts, nets);
    assert.equal(warnings.length, 0, warnings.join('; '));
  });

  it('buzzerTone detects A4 (440 Hz)', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);

    // Simulate Timer 1 toggling P3.5 at 440 Hz (A4)
    // Half period = 1/(2×440) = 1.136ms
    const halfPeriodNs = 1_136_364n; // 1/880 seconds in ns

    for (let i = 0; i < 40; i++) {
      board.advanceTo(BigInt(i) * halfPeriodNs);
      board.setPin('P3.5', 'pushpull', i % 2 === 0);
    }

    const tone = board.buzzerTone('BUZZ_buzzer');
    assert.ok(tone.on, 'buzzer should be on');
    assert.ok(Math.abs(tone.hz - 440) < 20,
      `frequency ${tone.hz} ≈ 440 Hz (A4)`);
  });

  it('button press triggers tone, release silences it', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);
    board.setPin('P3.5', 'pushpull', false);

    // Button not pressed → no toggle → no tone
    board.setControl('BTN_button', 0);
    assert.equal(board.readPin('P3.2'), 1, 'button released');
    let tone = board.buzzerTone('BUZZ_buzzer');
    assert.equal(tone.on, false, 'no tone when button released');

    // Button pressed → program starts toggling P3.5
    board.setControl('BTN_button', 1);
    assert.equal(board.readPin('P3.2'), 0, 'button pressed');

    // Simulate toggle at 440 Hz
    const halfPeriodNs = 1_136_364n;
    for (let i = 0; i < 20; i++) {
      board.advanceTo(BigInt(i) * halfPeriodNs);
      board.setPin('P3.5', 'pushpull', i % 2 === 0);
    }

    tone = board.buzzerTone('BUZZ_buzzer');
    assert.ok(tone.on, 'tone when toggling');
    assert.ok(tone.hz > 400, `freq ${tone.hz} > 400 Hz`);

    // Stop toggling → tone goes stale after 100ms
    board.advanceTo(200_000_000n);
    tone = board.buzzerTone('BUZZ_buzzer');
    assert.equal(tone.on, false, 'tone stops after staleness');
  });

  it('different notes produce different frequencies', () => {
    const { parts, nets } = inferNetlist(stc);

    const notes = [
      { name: 'A4', hz: 440 },
      { name: 'C5', hz: 523 },
      { name: 'E5', hz: 659 },
      { name: 'A5', hz: 880 },
    ];

    for (const note of notes) {
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);
      board.setPin('P3.5', 'pushpull', false);

      const halfPeriodNs = BigInt(Math.round(1e9 / (2 * note.hz)));
      for (let i = 0; i < 20; i++) {
        board.advanceTo(BigInt(i) * halfPeriodNs);
        board.setPin('P3.5', 'pushpull', i % 2 === 0);
      }

      const tone = board.buzzerTone('BUZZ_buzzer');
      assert.ok(tone.on, `${note.name} on`);
      assert.ok(Math.abs(tone.hz - note.hz) < note.hz * 0.05,
        `${note.name}: ${tone.hz} ≈ ${note.hz} Hz`);
    }
  });
});
