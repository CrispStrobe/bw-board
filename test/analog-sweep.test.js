/**
 * ADC/analog path tests: pot sweep linearity, ADC resolution boundaries,
 * multiple analog channels, and readAnalog under different pin loads.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makePotCircuit() {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ],
    nets: [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ],
  };
}

describe('analog: pot sweep linearity', () => {
  it('11-point sweep from 0 to 1 is perfectly linear', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    for (let i = 0; i <= 10; i++) {
      const pos = i / 10;
      board.setControl('POT', pos);
      const v = board.readAnalog('P1.3');
      const expected = 5.0 * pos;
      assert.ok(Math.abs(v - expected) < 0.01,
        `pos=${pos}: ${v} should be ${expected}`);
    }
  });

  it('fine sweep: 101 points', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    let maxError = 0;
    for (let i = 0; i <= 100; i++) {
      const pos = i / 100;
      board.setControl('POT', pos);
      const v = board.readAnalog('P1.3');
      const err = Math.abs(v - 5.0 * pos);
      maxError = Math.max(maxError, err);
    }
    assert.ok(maxError < 0.001, `max error over 101 points: ${maxError}`);
  });
});

describe('analog: ADC count boundaries', () => {
  it('voltage maps correctly to 10-bit ADC counts', () => {
    // The board returns volts; the MCU converts to counts.
    // Verify the voltage at key count boundaries.
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Count 0 → 0V, Count 512 → 2.5V, Count 1023 → 5.0V
    const testPoints = [
      { counts: 0, pos: 0 },
      { counts: 256, pos: 256 / 1023 },
      { counts: 512, pos: 512 / 1023 },
      { counts: 768, pos: 768 / 1023 },
      { counts: 1023, pos: 1 },
    ];

    for (const tp of testPoints) {
      board.setControl('POT', tp.pos);
      const v = board.readAnalog('P1.3');
      const counts = Math.round(v / 5.0 * 1023);
      assert.ok(Math.abs(counts - tp.counts) <= 1,
        `pos=${tp.pos.toFixed(4)}: counts=${counts} should be ≈${tp.counts}`);
    }
  });
});

describe('analog: multiple channels', () => {
  it('two pots on different pins are independent', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT1', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'POT2', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'POT1', terminal: 'a' },
        { part: 'POT2', terminal: 'a' },
      ]},
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'POT1', terminal: 'b' },
        { part: 'POT2', terminal: 'b' },
      ]},
      { id: 'nw1', terminals: [{ part: 'POT1', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'nw2', terminals: [{ part: 'POT2', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'input', false);
    board.setPin('P1.3', 'input', false);

    board.setControl('POT1', 0.25);
    board.setControl('POT2', 0.75);

    const v1 = board.readAnalog('P1.0');
    const v2 = board.readAnalog('P1.3');

    assert.ok(Math.abs(v1 - 1.25) < 0.01, `POT1 at 25%: ${v1}`);
    assert.ok(Math.abs(v2 - 3.75) < 0.01, `POT2 at 75%: ${v2}`);

    // Changing POT1 doesn't affect POT2
    board.setControl('POT1', 0.9);
    assert.ok(Math.abs(board.readAnalog('P1.0') - 4.5) < 0.01);
    assert.ok(Math.abs(board.readAnalog('P1.3') - 3.75) < 0.01, 'POT2 unchanged');
  });
});

describe('analog: readAnalog vs readPin threshold', () => {
  it('digital threshold at ~1.5V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Below threshold
    board.setControl('POT', 0.29); // 1.45V
    assert.equal(board.readPin('P1.3'), 0, '1.45V → digital 0');

    // Above threshold
    board.setControl('POT', 0.31); // 1.55V
    assert.equal(board.readPin('P1.3'), 1, '1.55V → digital 1');

    // Right at VCC/2
    board.setControl('POT', 0.5); // 2.5V
    assert.equal(board.readPin('P1.3'), 1, '2.5V → digital 1');

    // Near zero
    board.setControl('POT', 0.01); // 0.05V
    assert.equal(board.readPin('P1.3'), 0, '0.05V → digital 0');
  });
});

describe('analog: voltage divider as ADC input', () => {
  it('resistor divider feeds stable voltage to ADC pin', () => {
    // VCC → 3.3kΩ → node → 6.8kΩ → GND, pin on node
    // V = 5 * 6800 / (3300 + 6800) = 5 * 0.6733 = 3.366V
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 3300 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 6800 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 3.366) < 0.02, `divider voltage ${v} ≈ 3.366V`);
  });
});
