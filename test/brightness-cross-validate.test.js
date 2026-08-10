/**
 * Cross-validation: 50% PCA PWM through emu8051 adapter → ledBrightness.
 *
 * This answers the question from ucsim-stc: does a real 50% duty edge
 * stream from the emulator produce brightness 0.0725 through the board?
 *
 * The test uses the ScriptedMCU (not the real WASM) to generate a
 * precise 50% duty toggle at the PCA rate (7.2K edges/sec at FOSC/12),
 * feeds it through the board, and asserts the brightness.
 *
 * Oracle: LED with 1kΩ series resistor, VCC=5V, quasi-bidir sink.
 * I_led = (5 - 2) / (1000 + 25) = 2.93 mA. I_rated = 20 mA.
 * At 50% duty: brightness = (I_led / I_rated) * 0.5 = 0.0732
 * (close to the reported 0.0725 — difference is rounding in integration)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('brightness cross-validation: 50% duty PWM', () => {
  it('50% duty toggle at PCA rate produces brightness ~0.07', () => {
    // Standard LED circuit: VCC → 1kΩ → LED → MCU P1.0
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'net_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // PCA 8-bit PWM at FOSC/12 = 11059200/12 = 921600 Hz PCA clock.
    // 8-bit PWM period = 256 PCA clocks = 277.78 µs.
    // 50% duty: pin LOW for 128 clocks, HIGH for 128 clocks.
    // Half-period = 128 / 921600 = 138.89 µs ≈ 138889 ns.
    const halfPeriodNs = 138889n;

    // Run for 25ms (> 20ms brightness integration window) with 50% toggle
    const endNs = 25_000_000n;
    let tNs = 0n;
    let pinHigh = false;

    while (tNs < endNs) {
      // Quasi-bidir: LOW = strong sink (LED on), HIGH = weak source (LED dim)
      board.setPin('P1.0', 'quasi', pinHigh);
      tNs += halfPeriodNs;
      board.advanceTo(tNs);
      pinHigh = !pinHigh;
    }

    const brightness = board.ledBrightness('LED1');

    // Oracle: I_on = (5 - 2) / (1000 + 25) = 2.926 mA
    // I_off (quasi high, weak source): negligible current (LED reverse-biased
    //   from the LED's perspective, or very small forward current through 21.7kΩ)
    // duty = 0.5
    // brightness ≈ (I_on / 20mA) * duty = (2.926 / 20) * 0.5 = 0.0732
    //
    // Tolerance: ±0.02 (integration window edge effects, sub-sample timing)
    assert.ok(brightness > 0.05 && brightness < 0.10,
      `50% duty brightness should be ~0.073, got ${brightness.toFixed(4)}`);

    // Report the exact number for cross-validation with ucsim-stc
    console.log(`# 50% PCA PWM brightness = ${brightness.toFixed(5)}`);
  });

  it('25% duty produces ~half the brightness of 50%', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'net_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // 25% duty: pin LOW for 1/4 period, HIGH for 3/4 period
    // (LED on when pin LOW in active-low wiring)
    const quarterPeriodNs = 69444n; // 128/2 PCA clocks
    const threeQuarterNs = 208333n;

    const endNs = 25_000_000n;
    let tNs = 0n;
    let phase = 0; // 0=on(low), 1=off(high)

    while (tNs < endNs) {
      if (phase === 0) {
        board.setPin('P1.0', 'quasi', false); // LED on
        tNs += quarterPeriodNs;
      } else {
        board.setPin('P1.0', 'quasi', true);  // LED off
        tNs += threeQuarterNs;
      }
      board.advanceTo(tNs);
      phase = 1 - phase;
    }

    const brightness = board.ledBrightness('LED1');
    // 25% on → brightness ≈ 0.073 * 0.5 = 0.0366
    assert.ok(brightness > 0.02 && brightness < 0.06,
      `25% duty brightness should be ~0.037, got ${brightness.toFixed(4)}`);
    console.log(`# 25% PCA PWM brightness = ${brightness.toFixed(5)}`);
  });
});
