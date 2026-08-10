/**
 * 08-seven-segment: PORT OUTPUT → 8 LEDs on one port.
 *
 * This is the sixth inferNetlist row, found by looking at what the
 * board actually RECEIVES rather than reading the contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const PINS_PATH = path.resolve(here, '../../stc/examples/08-seven-segment/pins.json');

function loadFixture() {
  if (!existsSync(PINS_PATH)) return null;
  return JSON.parse(readFileSync(PINS_PATH, 'utf-8'));
}

describe('example: 08-seven-segment', () => {
  const stc = loadFixture();
  if (!stc) { it.skip('08-seven-segment not found'); return; }

  it('has empty pins array and a ports array', () => {
    assert.equal(stc.pins.length, 0, 'no individual pins');
    assert.ok(stc.ports && stc.ports.length > 0, 'has ports');
    assert.equal(stc.ports[0].direction, 'output');
    assert.equal(stc.ports[0].width, 8);
  });

  it('inferNetlist creates 8 LEDs for the port', () => {
    const { parts, nets, notes } = inferNetlist(stc);
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.equal(errors.length, 0, errors.map(e => e.message).join('; '));
    assert.equal(notes.length, 0, notes.join('; '));

    const leds = parts.filter(p => p.kind === 'led');
    assert.equal(leds.length, 8, `should have 8 LEDs, got ${leds.length}`);

    const resistors = parts.filter(p => p.kind === 'resistor');
    assert.equal(resistors.length, 8, `should have 8 resistors`);

    // MCU should have P0.0 through P0.7
    const mcu = parts.find(p => p.kind === 'mcu');
    assert.ok(mcu);
    for (let bit = 0; bit < 8; bit++) {
      assert.ok(mcu.terminals.includes(`P0.${bit}`),
        `MCU should have P0.${bit}`);
    }
  });

  it('LED names follow segment convention (a-g, dp)', () => {
    const { parts } = inferNetlist(stc);
    const leds = parts.filter(p => p.kind === 'led');
    const names = leds.map(p => p.id);

    for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']) {
      assert.ok(names.some(n => n.includes(seg)),
        `should have segment ${seg}: ${names.join(', ')}`);
    }
  });

  it('displays digit 0: segments a-f on, g off', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Digit 0: segments a,b,c,d,e,f ON, g OFF
    // Active-high: bit=1 → LED on
    // Port value for digit 0: 0b00111111 = 0x3F
    const digit0 = 0x3F;
    for (let bit = 0; bit < 8; bit++) {
      const on = (digit0 >> bit) & 1;
      board.setPin(`P0.${bit}`, 'pushpull', on === 1);
    }
    board.advanceTo(25_000_000n);

    // Check each segment
    const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    const expected = [1, 1, 1, 1, 1, 1, 0, 0]; // 0x3F

    for (let i = 0; i < 8; i++) {
      const b = board.ledBrightness(`LED_segments_${segments[i]}`);
      if (expected[i]) {
        assert.ok(b > 0.05, `segment ${segments[i]} should be on: ${b}`);
      } else {
        assert.ok(b < 0.01, `segment ${segments[i]} should be off: ${b}`);
      }
    }
  });

  it('displays digit 1: segments b,c on, rest off', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Digit 1: 0b00000110 = 0x06
    const digit1 = 0x06;
    for (let bit = 0; bit < 8; bit++) {
      board.setPin(`P0.${bit}`, 'pushpull', ((digit1 >> bit) & 1) === 1);
    }
    board.advanceTo(25_000_000n);

    const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    const expected = [0, 1, 1, 0, 0, 0, 0, 0];

    let onCount = 0;
    for (let i = 0; i < 8; i++) {
      const b = board.ledBrightness(`LED_segments_${segments[i]}`);
      if (b > 0.05) onCount++;
    }
    assert.equal(onCount, 2, `digit 1: 2 segments on, got ${onCount}`);
  });

  it('sevenSegmentBrightness returns per-segment values', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Display digit 8: all segments on (0xFF)
    for (let bit = 0; bit < 8; bit++) {
      board.setPin(`P0.${bit}`, 'pushpull', true);
    }
    board.advanceTo(25_000_000n);

    const ssb = board.sevenSegmentBrightness('LED_segments');
    assert.ok(ssb.a > 0.05, `segment a: ${ssb.a}`);
    assert.ok(ssb.g > 0.05, `segment g: ${ssb.g}`);
    assert.ok(ssb.dp > 0.05, `segment dp: ${ssb.dp}`);
  });

  it('getRenderState includes all 8 LEDs', () => {
    const { parts, nets } = inferNetlist(stc);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (let bit = 0; bit < 8; bit++) {
      board.setPin(`P0.${bit}`, 'pushpull', false);
    }
    board.advanceTo(1_000_000n);

    const state = board.getRenderState();
    assert.equal(state.leds.length, 8, '8 LEDs in render state');
  });
});
