/**
 * Tests for buzzer inference from pin name convention.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist } from '../src/infer-netlist.js';
import { BoardImpl } from '../src/board.js';

describe('inferNetlist: buzzer detection by name', () => {
  const buzzerNames = ['buzzer', 'buzz', 'speaker', 'tone', 'beep', 'BUZZER', 'myBuzzer'];

  for (const name of buzzerNames) {
    it(`"${name}" → buzzer part, not LED`, () => {
      const { parts } = inferNetlist({
        pins: [{ name, port: 1, bit: 5, direction: 'output', activeLow: false }],
      });
      const buzzer = parts.find(p => p.kind === 'buzzer');
      assert.ok(buzzer, `should create a buzzer for name "${name}"`);
      const led = parts.find(p => p.kind === 'led');
      assert.ok(!led, `should NOT create an LED for name "${name}"`);
    });
  }

  it('"led1" → LED, not buzzer', () => {
    const { parts } = inferNetlist({
      pins: [{ name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    assert.ok(parts.some(p => p.kind === 'led'));
    assert.ok(!parts.some(p => p.kind === 'buzzer'));
  });

  it('inferred buzzer works with buzzerTone', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'buzzer', port: 1, bit: 5, direction: 'output', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Toggle at 1kHz
    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    const tone = board.buzzerTone('BUZZ_buzzer');
    assert.ok(tone.on, 'buzzer should be on');
    assert.ok(Math.abs(tone.hz - 1000) < 100, `freq ${tone.hz} ≈ 1kHz`);
  });

  it('mixed: LED + buzzer inferred correctly', () => {
    const { parts } = inferNetlist({
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'buzzer', port: 1, bit: 5, direction: 'output', activeLow: false },
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      ],
    });

    assert.equal(parts.filter(p => p.kind === 'led').length, 2, '2 LEDs');
    assert.equal(parts.filter(p => p.kind === 'buzzer').length, 1, '1 buzzer');
  });
});
