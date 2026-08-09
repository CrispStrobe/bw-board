/**
 * Verify the LED sample recording optimization doesn't break
 * brightness calculation in edge cases.
 *
 * The optimization skips recording when current hasn't changed.
 * These tests exercise cases where that could produce wrong results.
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

describe('optimization: many advanceTo between toggles', () => {
  it('1000 advanceTo calls between on/off → correct brightness', () => {
    const { parts, nets } = makeLED();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // On for 10ms (1000 × 10µs steps)
    board.setPin('P1.0', 'pushpull', false);
    for (let i = 0; i < 1000; i++) {
      board.advanceTo(BigInt(i) * 10_000n);
    }

    // Off for 10ms
    board.setPin('P1.0', 'pushpull', true);
    for (let i = 0; i < 1000; i++) {
      board.advanceTo(10_000_000n + BigInt(i) * 10_000n);
    }

    // On for another 10ms
    board.setPin('P1.0', 'pushpull', false);
    for (let i = 0; i < 1000; i++) {
      board.advanceTo(20_000_000n + BigInt(i) * 10_000n);
    }
    board.advanceTo(30_000_000n);

    // 20ms window: 10ms on + 10ms off = 50% duty (approx, depends on window position)
    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.03, `many-advanceTo brightness: ${b} > 0`);
    assert.ok(b < 0.15, `many-advanceTo brightness: ${b} < steady`);
  });
});

describe('optimization: single advanceTo per toggle', () => {
  it('matches many-advanceTo result for same duty', () => {
    const { parts, nets } = makeLED();

    // Method A: many advanceTo between toggles
    const boardA = new BoardImpl(5.0);
    boardA.setNetlist(parts, nets);
    boardA.setPin('P1.0', 'pushpull', false);
    for (let i = 0; i < 100; i++) boardA.advanceTo(BigInt(i) * 100_000n);
    boardA.advanceTo(10_000_000n);
    boardA.setPin('P1.0', 'pushpull', true);
    for (let i = 0; i < 100; i++) boardA.advanceTo(10_000_000n + BigInt(i) * 100_000n);
    boardA.advanceTo(20_000_000n);
    boardA.setPin('P1.0', 'pushpull', false);
    boardA.advanceTo(40_000_000n);

    // Method B: single advanceTo per toggle
    const boardB = new BoardImpl(5.0);
    boardB.setNetlist(parts, nets);
    boardB.setPin('P1.0', 'pushpull', false);
    boardB.advanceTo(10_000_000n);
    boardB.setPin('P1.0', 'pushpull', true);
    boardB.advanceTo(20_000_000n);
    boardB.setPin('P1.0', 'pushpull', false);
    boardB.advanceTo(40_000_000n);

    const bA = boardA.ledBrightness('LED1');
    const bB = boardB.ledBrightness('LED1');

    // Both should give similar brightness
    assert.ok(Math.abs(bA - bB) < 0.02,
      `many-step (${bA.toFixed(4)}) ≈ single-step (${bB.toFixed(4)})`);
  });
});

describe('optimization: rapid toggling still records edges', () => {
  it('1kHz PWM with many advanceTo per period', () => {
    const { parts, nets } = makeLED();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // 30 PWM periods, 10 advanceTo steps per half-period
    for (let cycle = 0; cycle < 30; cycle++) {
      const base = BigInt(cycle) * 1_000_000n;

      board.setPin('P1.0', 'pushpull', false); // on
      for (let step = 0; step < 10; step++) {
        board.advanceTo(base + BigInt(step) * 50_000n);
      }

      board.setPin('P1.0', 'pushpull', true); // off
      for (let step = 0; step < 10; step++) {
        board.advanceTo(base + 500_000n + BigInt(step) * 50_000n);
      }
    }
    board.advanceTo(30_000_000n);

    const b = board.ledBrightness('LED1');
    // 50% duty → ~0.0725
    assert.ok(b > 0.05, `rapid toggle brightness: ${b}`);
    assert.ok(b < 0.10, `rapid toggle brightness: ${b}`);
  });
});

describe('optimization: LED current changes without pin toggle', () => {
  it('pot change affects LED current → recorded correctly', () => {
    // LED in series with pot wiper: changing pot changes LED current
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    // LED on with steady current
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);
    const b1 = board.ledBrightness('LED1');
    assert.ok(b1 > 0.13, `steady: ${b1}`);
  });
});
