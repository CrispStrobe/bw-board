/**
 * Halt behavior tests: verify the board handles a halted MCU correctly.
 *
 * From the boundary A × D contract:
 *   - A halted MCU stops calling advanceTo → board time freezes
 *   - Do not catch up on resume (no single huge dt)
 *   - setControl stays live while halted
 *   - RC integrator is exact for any dt (no catch-up artifact)
 *
 * The board is passive: a halt is a no-op beyond "advanceTo stops".
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('halt: advanceTo stops → board freezes', () => {
  it('LED brightness stays constant when advanceTo is not called', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    const b1 = board.ledBrightness('LED_led');
    // "Halt" — just don't call advanceTo
    // Query brightness multiple times — should be stable
    const b2 = board.ledBrightness('LED_led');
    const b3 = board.ledBrightness('LED_led');

    assert.equal(b1, b2);
    assert.equal(b2, b3);
  });
});

describe('halt: setControl stays live', () => {
  it('pot changes while halted, takes effect on resume', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT_pot', 0.5);
    board.advanceTo(1_000_000n);

    // Verify pot reads 2.5V
    assert.ok(Math.abs(board.readAnalog('P1.3') - 2.5) < 0.1);

    // "Halt" — don't call advanceTo, but do change control
    board.setControl('POT_pot', 0.8);

    // readAnalog should reflect the new position immediately
    // (it's user intent, not physics)
    assert.ok(Math.abs(board.readAnalog('P1.3') - 4.0) < 0.1,
      'pot change is live while halted');

    // "Resume" — advanceTo continues from where it stopped
    board.advanceTo(2_000_000n);
    assert.ok(Math.abs(board.readAnalog('P1.3') - 4.0) < 0.1,
      'pot value persists after resume');
  });

  it('button press while halted takes effect on next readPin', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);
    board.advanceTo(1_000_000n);

    assert.equal(board.readPin('P3.2'), 1, 'not pressed');

    // "Halt" + press button
    board.setControl('BTN_btn', 1);
    assert.equal(board.readPin('P3.2'), 0, 'pressed while halted');

    // Resume
    board.advanceTo(2_000_000n);
    assert.equal(board.readPin('P3.2'), 0, 'still pressed after resume');
  });
});

describe('halt: RC integrator handles large dt correctly', () => {
  it('single large dt after halt matches continuous stepping', () => {
    // Two boards: one steps continuously, one halts then resumes
    const makeParts = () => [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
    ];
    const makeNets = () => [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];

    // Board 1: continuous stepping (10ms intervals for 1 second)
    const board1 = new BoardImpl(5.0);
    board1.setNetlist(makeParts(), makeNets());
    for (let t = 10_000_000n; t <= 1_000_000_000n; t += 10_000_000n) {
      board1.advanceTo(t);
    }
    const v1 = board1.nodeVoltage('nrc');

    // Board 2: halt after 100ms, then resume with single large step
    const board2 = new BoardImpl(5.0);
    board2.setNetlist(makeParts(), makeNets());
    board2.advanceTo(100_000_000n); // run 100ms, then "halt"
    // ... 900ms pass with no advanceTo ...
    board2.advanceTo(1_000_000_000n); // resume, single large step

    const v2 = board2.nodeVoltage('nrc');

    // Both should agree — the RC formula is exact for any dt
    assert.ok(Math.abs(v1 - v2) < 0.01,
      `continuous (${v1.toFixed(4)}) ≈ halt+resume (${v2.toFixed(4)})`);
  });
});

describe('halt: no dt assumptions in solver', () => {
  it('zero dt does not crash', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    // Same time twice — zero dt
    board.advanceTo(1_000_000n);
    board.advanceTo(1_000_000n);
    assert.equal(board.nodeVoltage('nv'), 5.0);
  });

  it('1-nanosecond dt does not crash', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    board.advanceTo(1n);
    const v = board.nodeVoltage('nrc');
    assert.ok(!Number.isNaN(v));
  });

  it('1-hour dt does not overflow or produce NaN', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    board.advanceTo(3_600_000_000_000n); // 1 hour
    const v = board.nodeVoltage('nrc');
    assert.ok(Number.isFinite(v));
    assert.ok(v > 4.99, `cap fully charged after 1 hour: ${v}`);
  });
});
