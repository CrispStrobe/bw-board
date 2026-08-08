/**
 * Test: buzzer tone derived from pin toggle period.
 *
 * Circuit: MCU pin P1.5 (push-pull) → buzzer terminal a, GND → buzzer terminal b.
 *
 * The buzzer doesn't model acoustics — it just reports the toggle frequency
 * so the UI can drive a Web Audio oscillator.
 *
 * Hand-computed:
 *   Toggle every 500,000 ns (0.5 ms) → period = 1 ms → 1000 Hz
 *   Toggle every 1,000,000 ns (1 ms) → period = 2 ms → 500 Hz
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeBuzzerCircuit() {
  const parts = [
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'BUZZ1', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.5'] },
  ];
  const nets = [
    { id: 'net_pin_buzz', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ1', terminal: 'a' }] },
    { id: 'net_buzz_gnd', terminals: [{ part: 'BUZZ1', terminal: 'b' }, { part: 'GND', terminal: 'gnd' }] },
  ];
  return { parts, nets };
}

describe('buzzer tone', () => {
  it('no toggles → no tone', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzerCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.5', 'pushpull', false);
    board.advanceTo(1_000_000n);

    const tone = board.buzzerTone('BUZZ1');
    assert.equal(tone.on, false);
  });

  it('toggle every 500µs → 1000 Hz', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzerCircuit();
    board.setNetlist(parts, nets);

    // Toggle at 0, 500µs, 1000µs, 1500µs
    board.advanceTo(0n);
    board.setPin('P1.5', 'pushpull', false);
    board.advanceTo(500_000n);
    board.setPin('P1.5', 'pushpull', true);
    board.advanceTo(1_000_000n);
    board.setPin('P1.5', 'pushpull', false);
    board.advanceTo(1_500_000n);
    board.setPin('P1.5', 'pushpull', true);

    const tone = board.buzzerTone('BUZZ1');
    assert.equal(tone.on, true);
    assert.ok(Math.abs(tone.hz - 1000) < 10, `expected ~1000 Hz, got ${tone.hz}`);
  });

  it('toggle every 1ms → 500 Hz', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzerCircuit();
    board.setNetlist(parts, nets);

    board.advanceTo(0n);
    board.setPin('P1.5', 'pushpull', false);
    board.advanceTo(1_000_000n);
    board.setPin('P1.5', 'pushpull', true);
    board.advanceTo(2_000_000n);
    board.setPin('P1.5', 'pushpull', false);

    const tone = board.buzzerTone('BUZZ1');
    assert.equal(tone.on, true);
    assert.ok(Math.abs(tone.hz - 500) < 10, `expected ~500 Hz, got ${tone.hz}`);
  });
});
