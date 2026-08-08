/**
 * Test: potentiometer → ADC path.
 *
 * Circuit: VCC → pot (10kΩ) → GND, wiper → MCU pin P1.3 (input mode)
 *
 * Hand-computed values:
 *   Pot at position 0.0: wiper = 0V (at GND end)
 *   Pot at position 0.5: wiper = 2.5V
 *   Pot at position 1.0: wiper = 5.0V (at VCC end)
 *   Pot at position 0.33: wiper = 1.65V
 *
 * The pin is in input-only mode (high-Z), so it does not load the pot.
 * readAnalog returns volts; the MCU converts to counts itself.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { runTrace } from '../src/scripted-mcu.js';

/**
 * Build the pot → ADC circuit:
 *   VCC → pot.a, GND → pot.b, pot.wiper → MCU.P1.3
 */
function makePotCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'POT1', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT1', terminal: 'a' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT1', terminal: 'b' }] },
    { id: 'net_wiper', terminals: [{ part: 'POT1', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
  ];
  return { parts, nets };
}

describe('potentiometer → ADC', () => {
  it('midpoint → 2.5V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.3', 'input', false);
    board.setControl('POT1', 0.5);

    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 2.5) < 0.01, `expected ~2.5V, got ${v}`);
  });

  it('position 0 → 0V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.3', 'input', false);
    board.setControl('POT1', 0.0);

    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v) < 0.01, `expected ~0V, got ${v}`);
  });

  it('position 1 → 5V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.3', 'input', false);
    board.setControl('POT1', 1.0);

    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 5.0) < 0.01, `expected ~5V, got ${v}`);
  });

  it('position 0.33 → 1.65V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.3', 'input', false);
    board.setControl('POT1', 0.33);

    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 1.65) < 0.01, `expected ~1.65V, got ${v}`);
  });

  it('readPin returns digital level based on pot position', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.3', 'input', false);

    // Below threshold (~1.5V) → 0
    board.setControl('POT1', 0.2); // 1.0V
    assert.equal(board.readPin('P1.3'), 0, 'pot at 0.2 (1V) → digital 0');

    // Above threshold → 1
    board.setControl('POT1', 0.8); // 4.0V
    assert.equal(board.readPin('P1.3'), 1, 'pot at 0.8 (4V) → digital 1');
  });
});

describe('scripted trace — pot sweep', () => {
  it('replays pot adjustment and checks readAnalog', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePotCircuit();
    board.setNetlist(parts, nets);

    // Set up pin as input before trace
    board.setPin('P1.3', 'input', false);

    // Sweep the pot and check voltages
    board.setControl('POT1', 0.0);
    const failures = runTrace(board, [
      { t: 0n, expect: { readAnalog: ['P1.3', 0.0, 0.01] } },
      { t: 1_000_000n, expect: { readAnalog: ['P1.3', 0.0, 0.01] } },
    ]);

    // Now move pot to midpoint
    board.setControl('POT1', 0.5);
    const failures2 = runTrace(board, [
      { t: 2_000_000n, expect: { readAnalog: ['P1.3', 2.5, 0.01] } },
    ]);

    const allFailures = [...failures, ...failures2];
    if (allFailures.length > 0) {
      for (const f of allFailures) {
        console.log(`FAIL: ${f.field} expected=${f.expected} actual=${f.actual}`);
      }
    }
    assert.equal(allFailures.length, 0, `${allFailures.length} assertion(s) failed`);
  });
});
