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

// The AUTHORED position is where the example's trimmer was left, and it must
// answer the same in both solvers. `stampPotentiometer` in mna.js has always
// honoured `params.position` and says why in its own comment ("the LCD
// contrast pot defaulted to a washed-out 0.25 contrast because every pot woke
// at 0.5 regardless of wiring"). The closed-form walker fell back to a bare
// 0.5 and ignored it, so the SAME bench with the SAME untouched control read
// 2.5000 V or 1.2500 V depending only on which solver `_needsMNA` picked —
// found 2026-08-29 while writing the D22 noise design, which has to inject at
// both call sites for exactly this reason.
describe('potentiometer authored position', () => {
  const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

  /** `mna` picks a vsource (routes to MNA) or a vcc symbol (the walker). */
  function wiperVolts(mna) {
    const top = mna
      ? { id: 'v1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] }
      : { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] };
    const board = new BoardImpl(5.0);
    board.setNetlist([
      { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'P1', kind: 'potentiometer', params: { ohms: 10000, position: 0.25 },
        terminals: ['a', 'wiper', 'b'] },
      { id: 'mcu1', kind: 'mcu', params: {}, terminals: ['a0'] },
      top,
    ], [
      net('ntop', [top.id, mna ? 'pos' : 'vcc'], ['P1', 'a']),
      net('ngnd', ['gnd1', 'gnd'], ['P1', 'b'], ...(mna ? [['v1', 'neg']] : [])),
      net('nw', ['P1', 'wiper'], ['mcu1', 'a0']),
    ]);
    board.setPin('a0', 'input', false);
    board.advanceTo(1n);
    return board.nodeVoltage('nw');
  }

  it('an untouched control falls back to params.position in BOTH solvers', () => {
    // 5 V x 0.25 = 1.25 V. The walker answered 2.5000 V until this landed.
    // MNA carries gmin on every node, so it lands 2.3e-9 short of the exact
    // divider; the walker is closed-form and exact. 1e-6 covers the gap
    // without hiding the 1.25 V vs 2.50 V the defect was.
    assert.ok(Math.abs(wiperVolts(true) - 1.25) < 1e-6, `MNA: ${wiperVolts(true)}`);
    assert.ok(Math.abs(wiperVolts(false) - 1.25) < 1e-12, `walker: ${wiperVolts(false)}`);
    assert.ok(Math.abs(wiperVolts(true) - wiperVolts(false)) < 1e-6,
      'and the two solvers agree on the same bench');
  });
});
