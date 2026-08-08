/**
 * Test: switch component and plain diode (non-LED).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('switch component', () => {
  it('switch open behaves like open button', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'SW1', kind: 'switch', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'np', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'SW1', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.0' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'SW1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'input', false);

    // Switch open (value=0) → pull-up wins → pin=1
    board.setControl('SW1', 0);
    assert.equal(board.readPin('P1.0'), 1, 'switch open → pulled up');

    // Switch closed (value=1) → GND wins → pin=0
    board.setControl('SW1', 1);
    assert.equal(board.readPin('P1.0'), 0, 'switch closed → GND');
  });
});

describe('diode (non-LED)', () => {
  it('forward biased diode conducts through MNA', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'D1', kind: 'diode', params: { vf: 0.7 }, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'D1', terminal: 'cathode' }] },
    ];
    board.setNetlist(parts, nets);

    // I = (5 - 0.7) / (1000 + 10) = 4.3/1010 ≈ 4.257 mA
    const iD1 = board.branchCurrent('D1', 'anode');
    assert.ok(Math.abs(iD1 - 0.004257) < 0.0005,
      `diode current ${iD1} should be ≈ 4.257 mA`);
  });

  it('reverse biased diode blocks', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      // Reversed: cathode toward VCC
      { id: 'D1', kind: 'diode', params: { vf: 0.7 }, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'D1', terminal: 'cathode' }] },
      { id: 'nr', terminals: [{ part: 'D1', terminal: 'anode' }, { part: 'R1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    const iD1 = board.branchCurrent('D1', 'anode');
    assert.ok(Math.abs(iD1) < 0.0001,
      `reverse biased diode current ${iD1} should be ≈ 0`);
  });
});
