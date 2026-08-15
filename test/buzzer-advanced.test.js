/**
 * Advanced buzzer tests: frequency sweep, duty cycle variation,
 * multiple buzzers, and silence detection.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeBuzzerCircuit() {
  return {
    parts: [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.5'] },
    ],
    nets: [
      { id: 'nb', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BUZZ', terminal: 'b' }] },
    ],
  };
}

function togglePin(board, pin, halfPeriodNs, count) {
  let t = 0n;
  for (let i = 0; i < count; i++) {
    board.advanceTo(t);
    board.setPin(pin, 'pushpull', i % 2 === 0);
    t += halfPeriodNs;
  }
  board.advanceTo(t);
}

describe('buzzer: frequency sweep', () => {
  const freqs = [
    { halfNs: 5_000_000n, hz: 100, label: '100 Hz' },
    { halfNs: 2_000_000n, hz: 250, label: '250 Hz' },
    { halfNs: 1_000_000n, hz: 500, label: '500 Hz' },
    { halfNs: 500_000n, hz: 1000, label: '1 kHz' },
    { halfNs: 250_000n, hz: 2000, label: '2 kHz' },
    { halfNs: 100_000n, hz: 5000, label: '5 kHz' },
  ];

  for (const tc of freqs) {
    it(`${tc.label}`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeBuzzerCircuit();
      board.setNetlist(parts, nets);

      togglePin(board, 'P1.5', tc.halfNs, 20);

      const tone = board.buzzerTone('BUZZ');
      assert.ok(tone.on, `${tc.label} should be on`);
      assert.ok(Math.abs(tone.hz - tc.hz) < tc.hz * 0.05,
        `${tc.label}: got ${tone.hz.toFixed(1)} Hz`);
    });
  }
});

describe('buzzer: silence after stopping', () => {
  it('single toggle then silence → off', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzerCircuit();
    board.setNetlist(parts, nets);

    // One toggle only — not enough for a frequency
    board.advanceTo(0n);
    board.setPin('P1.5', 'pushpull', true);
    board.advanceTo(1_000_000n);

    // SEMANTIC CHANGE 2026-08-15 (audit E2): an ACTIVE buzzer has a
    // built-in oscillator — steady DC across it IS sound. A single
    // edge that leaves the pin HIGH therefore leaves the buzzer ON at
    // its rated tone; the old assertion encoded the bug.
    const tone = board.buzzerTone('BUZZ');
    assert.equal(tone.on, true, 'pin left high = DC across an active buzzer = sound');
    assert.equal(tone.hz, 2400, 'rated tone, not a measured toggle frequency');
  });

  it('steady high → the RATED tone (active buzzer on DC)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzerCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.5', 'pushpull', true);
    board.advanceTo(10_000_000n);

    const tone = board.buzzerTone('BUZZ');
    assert.equal(tone.on, true, 'steady DC sounds the built-in oscillator');
    assert.equal(tone.hz, 2400);
  });

  it('steady low → no sound', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzerCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.5', 'pushpull', false);
    board.advanceTo(10_000_000n);

    const tone = board.buzzerTone('BUZZ');
    assert.equal(tone.on, false, 'steady low = no toggle = no sound');
  });
});

describe('buzzer: two buzzers on different pins', () => {
  it('independent frequencies', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'BUZ1', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
      { id: 'BUZ2', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.5', 'P1.6'] },
    ];
    const nets = [
      { id: 'n1', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZ1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'MCU', terminal: 'P1.6' }, { part: 'BUZ2', terminal: 'a' }] },
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'BUZ1', terminal: 'b' },
        { part: 'BUZ2', terminal: 'b' },
      ]},
    ];
    board.setNetlist(parts, nets);

    // BUZ1 at 1kHz, BUZ2 at 500Hz — interleaved toggles
    let t = 0n;
    for (let i = 0; i < 20; i++) {
      board.advanceTo(t);
      board.setPin('P1.5', 'pushpull', i % 2 === 0); // 1kHz toggle
      if (i % 2 === 0) {
        board.setPin('P1.6', 'pushpull', (i / 2) % 2 === 0); // 500Hz toggle
      }
      t += 500_000n; // 500µs half-period for 1kHz
    }

    const tone1 = board.buzzerTone('BUZ1');
    const tone2 = board.buzzerTone('BUZ2');
    assert.ok(tone1.on, 'BUZ1 should be on');
    assert.ok(tone2.on, 'BUZ2 should be on');
    assert.ok(Math.abs(tone1.hz - 1000) < 100, `BUZ1: ${tone1.hz} Hz ≈ 1 kHz`);
    assert.ok(Math.abs(tone2.hz - 500) < 100, `BUZ2: ${tone2.hz} Hz ≈ 500 Hz`);
  });
});
