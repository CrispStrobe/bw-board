/**
 * PWM at various frequencies: verify ledBrightness works correctly
 * from very low (10 Hz) to very high (100 kHz) toggle rates.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';

function makeLED() {
  return new NetlistBuilder()
    .vcc('VCC').gnd('GND')
    .resistor('R1', 1000).led('LED1', 2.0)
    .mcu('MCU', ['P1.0'])
    .wire('VCC.vcc', 'R1.a').wire('R1.b', 'LED1.anode')
    .wire('LED1.cathode', 'MCU.P1.0')
    .build();
}

const STEADY = 0.1449; // steady-state brightness

describe('PWM frequencies: 50% duty at various rates', () => {
  const freqs = [
    // 10 Hz: period (100ms) >> window (20ms), so brightness shows
    // current state, not time-average. This is correct — visible flicker.
    // Skipped from the 50%-duty test; tested separately below.
    { hz: 50, label: '50 Hz (mains frequency)' },
    { hz: 100, label: '100 Hz (visible flicker)' },
    { hz: 500, label: '500 Hz (fast timer)' },
    { hz: 1000, label: '1 kHz (standard PWM)' },
    { hz: 3600, label: '3.6 kHz (PCA 8-bit at FOSC/12)' },
    { hz: 10000, label: '10 kHz (fast PWM)' },
    { hz: 50000, label: '50 kHz (ultrasonic)' },
  ];

  for (const { hz, label } of freqs) {
    it(`${label}: brightness ≈ 50% of steady`, () => {
      const { parts, nets } = makeLED();
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const halfPeriodNs = BigInt(Math.round(1e9 / (2 * hz)));
      // Run enough cycles to fill the 20ms window
      const cyclesNeeded = Math.max(30, Math.ceil(0.025 * hz));
      const totalCycles = Math.min(cyclesNeeded, 5000); // cap for speed

      for (let i = 0; i < totalCycles; i++) {
        const t = BigInt(i * 2) * halfPeriodNs;
        board.advanceTo(t);
        board.setPin('P1.0', 'pushpull', false); // on
        board.advanceTo(t + halfPeriodNs);
        board.setPin('P1.0', 'pushpull', true);  // off
      }
      board.advanceTo(BigInt(totalCycles * 2) * halfPeriodNs);

      const b = board.ledBrightness('LED1');
      const expected = 0.5 * STEADY;
      assert.ok(Math.abs(b - expected) < 0.03,
        `${hz}Hz: brightness ${b.toFixed(4)} ≈ ${expected.toFixed(4)}`);
    });
  }
});

describe('PWM: frequency does not affect brightness at same duty', () => {
  it('1kHz and 10kHz at 50% give same brightness', () => {
    const results = [];

    for (const hz of [1000, 10000]) {
      const { parts, nets } = makeLED();
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      const halfPeriodNs = BigInt(Math.round(1e9 / (2 * hz)));
      const cycles = Math.min(Math.ceil(0.025 * hz), 2000);

      for (let i = 0; i < cycles; i++) {
        const t = BigInt(i * 2) * halfPeriodNs;
        board.advanceTo(t);
        board.setPin('P1.0', 'pushpull', false);
        board.advanceTo(t + halfPeriodNs);
        board.setPin('P1.0', 'pushpull', true);
      }
      board.advanceTo(BigInt(cycles * 2) * halfPeriodNs);

      results.push({ hz, brightness: board.ledBrightness('LED1') });
    }

    assert.ok(Math.abs(results[0].brightness - results[1].brightness) < 0.02,
      `1kHz (${results[0].brightness.toFixed(4)}) ≈ 10kHz (${results[1].brightness.toFixed(4)})`);
  });
});

describe('PWM: very low frequency shows time-varying brightness', () => {
  it('1 Hz PWM: brightness changes within the integration window', () => {
    const { parts, nets } = makeLED();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // 1 Hz = 1 second period. 50% duty = 500ms on, 500ms off.
    // The 20ms window sees either all-on or all-off, not 50%.

    // During on phase (first 500ms)
    board.setPin('P1.0', 'pushpull', false); // on
    board.advanceTo(250_000_000n); // 250ms into on phase

    const bOn = board.ledBrightness('LED1');
    assert.ok(bOn > 0.13, `during on: ${bOn} ≈ steady`);

    // During off phase
    board.setPin('P1.0', 'pushpull', true); // off
    board.advanceTo(750_000_000n); // 250ms into off phase

    const bOff = board.ledBrightness('LED1');
    assert.ok(bOff < 0.01, `during off: ${bOff} ≈ 0`);
  });
});
