/**
 * Multi-LED pattern tests: 7-segment digit display, LED bar graph,
 * charlieplexing, and scanning patterns.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeNLedCircuit(n) {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const mcuTerminals = [];
  const nets = [];
  const vccNet = { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] };

  for (let i = 0; i < n; i++) {
    const pin = `P1.${i}`;
    mcuTerminals.push(pin);
    parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] });
    parts.push({ id: `LED${i}`, kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] });
    vccNet.terminals.push({ part: `R${i}`, terminal: 'a' });
    nets.push({ id: `nr${i}`, terminals: [{ part: `R${i}`, terminal: 'b' }, { part: `LED${i}`, terminal: 'anode' }] });
    nets.push({ id: `np${i}`, terminals: [{ part: `LED${i}`, terminal: 'cathode' }, { part: 'MCU', terminal: pin }] });
  }

  parts.push({ id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals });
  nets.push(vccNet);
  nets.push({ id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] });
  return { parts, nets };
}

// 7-segment digit patterns (active low: 0 = on)
const DIGITS = {
  0: [0,0,0,0,0,0,1], // a,b,c,d,e,f on; g off
  1: [1,0,0,1,1,1,1], // b,c on
  2: [0,0,1,0,0,1,0], // a,b,d,e,g on
  3: [0,0,0,0,1,1,0], // a,b,c,d,g on
  4: [1,0,0,1,1,0,0], // b,c,f,g on
  5: [0,1,0,0,1,0,0], // a,c,d,f,g on
  6: [0,1,0,0,0,0,0], // a,c,d,e,f,g on
  7: [0,0,0,1,1,1,1], // a,b,c on
  8: [0,0,0,0,0,0,0], // all on
  9: [0,0,0,0,1,0,0], // a,b,c,d,f,g on
};

describe('7-segment digit display', () => {
  for (const [digit, pattern] of Object.entries(DIGITS)) {
    it(`displays digit ${digit}`, () => {
      const { parts, nets } = makeNLedCircuit(7);
      const board = new BoardImpl(5.0);
      board.setNetlist(parts, nets);

      // Apply pattern (active low)
      for (let i = 0; i < 7; i++) {
        board.setPin(`P1.${i}`, 'pushpull', pattern[i] === 1);
      }
      board.advanceTo(25_000_000n);

      const onCount = pattern.filter(v => v === 0).length;
      let actualOn = 0;
      for (let i = 0; i < 7; i++) {
        const b = board.ledBrightness(`LED${i}`);
        if (b > 0.1) actualOn++;
      }
      assert.equal(actualOn, onCount,
        `digit ${digit}: ${onCount} segments on, got ${actualOn}`);
    });
  }
});

describe('LED bar graph', () => {
  it('progressive fill: 0 to 8 LEDs', () => {
    const { parts, nets } = makeNLedCircuit(8);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (let level = 0; level <= 8; level++) {
      // Light LEDs 0..level-1
      for (let i = 0; i < 8; i++) {
        board.setPin(`P1.${i}`, 'pushpull', i >= level); // off if >= level
      }
      board.advanceTo(BigInt(level + 1) * 25_000_000n);

      let onCount = 0;
      for (let i = 0; i < 8; i++) {
        if (board.ledBrightness(`LED${i}`) > 0.1) onCount++;
      }
      assert.equal(onCount, level, `bar level ${level}: ${onCount} LEDs on`);
    }
  });
});

describe('LED scanning pattern', () => {
  it('single LED scans across 8 positions', () => {
    const { parts, nets } = makeNLedCircuit(8);
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    for (let pos = 0; pos < 8; pos++) {
      // Only LED at `pos` is on
      for (let i = 0; i < 8; i++) {
        board.setPin(`P1.${i}`, 'pushpull', i !== pos);
      }
      board.advanceTo(BigInt(pos + 1) * 25_000_000n);

      for (let i = 0; i < 8; i++) {
        const b = board.ledBrightness(`LED${i}`);
        if (i === pos) {
          assert.ok(b > 0.1, `pos=${pos}: LED${i} should be on (${b})`);
        } else {
          assert.ok(b < 0.01, `pos=${pos}: LED${i} should be off (${b})`);
        }
      }
    }
  });
});
