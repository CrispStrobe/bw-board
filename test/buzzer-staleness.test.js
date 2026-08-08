/**
 * Buzzer staleness: verify the buzzer reports off after toggle edges
 * become stale (e.g., after a debug halt or program stopping).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('buzzer staleness', () => {
  function makeBuzzer() {
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

  it('buzzer on while actively toggling', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzer();
    board.setNetlist(parts, nets);

    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'should be on while toggling');
    assert.ok(tone.hz > 800, `freq ${tone.hz} ≈ 1kHz`);
  });

  it('buzzer off after 100ms of no toggles', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzer();
    board.setNetlist(parts, nets);

    // Toggle for a bit
    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    // Verify it's on
    assert.ok(board.buzzerTone('BUZZ').on);

    // Advance 200ms without toggling (simulates halt or program stopping)
    board.advanceTo(200_000_000n);

    const tone = board.buzzerTone('BUZZ');
    assert.equal(tone.on, false, 'buzzer should be off after 200ms silence');
    assert.equal(tone.hz, 0);
  });

  it('buzzer comes back on after resuming toggles', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzer();
    board.setNetlist(parts, nets);

    // Toggle
    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    // Go silent for 200ms
    board.advanceTo(200_000_000n);
    assert.equal(board.buzzerTone('BUZZ').on, false, 'stale');

    // Resume toggling
    for (let i = 0; i < 10; i++) {
      const t = 200_000_000n + BigInt(i) * 500_000n;
      board.advanceTo(t);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'buzzer should be on again after resuming');
    assert.ok(tone.hz > 800, `freq ${tone.hz} ≈ 1kHz`);
  });

  it('50ms gap is not stale (within threshold)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeBuzzer();
    board.setNetlist(parts, nets);

    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    // 50ms gap — still within the 100ms threshold
    board.advanceTo(55_000_000n);
    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, '50ms gap is not stale');
  });
});
