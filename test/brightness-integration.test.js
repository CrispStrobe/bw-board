/**
 * LED brightness integration edge cases: window boundaries,
 * asymmetric PWM, frequency transitions, and multi-LED independence.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeActiveLowLED() {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ],
    nets: [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
    ],
  };
}

const STEADY_BRIGHTNESS = 0.1449; // (5-2)/(1000+10+25) / 0.020

describe('brightness: window boundary precision', () => {
  it('brightness appears after exactly one sample in the window', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    board.advanceTo(0n);
    board.setPin('P1.0', 'pushpull', false); // LED on
    board.advanceTo(1_000_000n); // 1 ms

    // Only 1ms in a 20ms window → brightness should be partial
    const b = board.ledBrightness('LED1');
    // The integrator sees the LED on for the full 1ms window (since
    // the initial sample establishes current = 2.9mA from t=0)
    assert.ok(b > 0.1, `brightness ${b} should reflect steady current`);
  });

  it('brightness decays to zero exactly at window boundary', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    // LED on for 1ms, then off
    board.advanceTo(0n);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);
    board.setPin('P1.0', 'pushpull', true);

    // Right after turning off: window includes on-time
    board.advanceTo(2_000_000n);
    const b1 = board.ledBrightness('LED1');
    assert.ok(b1 > 0, `shortly after off: ${b1} should still show some brightness`);

    // After 20ms past the off point: window is entirely in off region
    board.advanceTo(22_000_000n);
    const b2 = board.ledBrightness('LED1');
    assert.ok(b2 < 0.01, `20ms after off: ${b2} should be ~0`);
  });
});

describe('brightness: asymmetric duty cycles', () => {
  const duties = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

  for (const duty of duties) {
    it(`${(duty * 100).toFixed(0)}% duty → ${(duty * STEADY_BRIGHTNESS * 100).toFixed(1)}% brightness`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeActiveLowLED();
      board.setNetlist(parts, nets);

      const periodNs = 1_000_000n; // 1ms
      const onNs = BigInt(Math.round(1_000_000 * duty));

      // Run 30 cycles to fill the window
      for (let i = 0; i < 30; i++) {
        const t = BigInt(i) * periodNs;
        board.advanceTo(t);
        board.setPin('P1.0', 'pushpull', false); // on
        board.advanceTo(t + onNs);
        board.setPin('P1.0', 'pushpull', true); // off
      }
      board.advanceTo(30n * periodNs);

      const b = board.ledBrightness('LED1');
      const expected = duty * STEADY_BRIGHTNESS;
      assert.ok(Math.abs(b - expected) < 0.02,
        `${(duty * 100).toFixed(0)}% duty: brightness ${b.toFixed(4)} ≈ ${expected.toFixed(4)}`);
    });
  }
});

describe('brightness: frequency transition', () => {
  it('switching from 1kHz to 500Hz changes brightness proportionally', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    // Phase 1: 1kHz, 50% duty for 25ms
    for (let i = 0; i < 25; i++) {
      const t = BigInt(i) * 1_000_000n;
      board.advanceTo(t);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(t + 500_000n);
      board.setPin('P1.0', 'pushpull', true);
    }
    board.advanceTo(25_000_000n);
    const b1kHz = board.ledBrightness('LED1');

    // Phase 2: same total time, but 500Hz 50% duty for 25ms
    for (let i = 0; i < 13; i++) { // ~13 cycles of 2ms = 26ms
      const t = 25_000_000n + BigInt(i) * 2_000_000n;
      board.advanceTo(t);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(t + 1_000_000n);
      board.setPin('P1.0', 'pushpull', true);
    }
    board.advanceTo(51_000_000n);
    const b500Hz = board.ledBrightness('LED1');

    // Both should be ~50% brightness (frequency doesn't matter, duty does)
    assert.ok(Math.abs(b1kHz - b500Hz) < 0.02,
      `1kHz (${b1kHz.toFixed(4)}) ≈ 500Hz (${b500Hz.toFixed(4)}) at same duty`);
  });
});

describe('brightness: LED at current limit', () => {
  it('brightness clamps at 1.0 for very low series resistance', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] }, // very low
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);

    // I = (5-2)/(10+10+25) = 3/45 = 66.7 mA → brightness = 66.7/20 = 3.33 → clamped to 1.0
    const b = board.ledBrightness('LED1');
    assert.equal(b, 1.0, `brightness should clamp at 1.0, got ${b}`);
  });
});
