/**
 * Test: button and resistance honesty trap.
 *
 * Button circuit: VCC → 10kΩ pull-up → MCU pin P3.2 (input), button P3.2 → GND.
 *   Button open: pin reads VCC (digital 1)
 *   Button pressed: pin reads GND (digital 0)
 *
 * Resistance: returns 'requires-power-off' when the board is powered.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeButtonCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'BTN1', kind: 'button', params: {}, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.2'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
    { id: 'net_pin', terminals: [
      { part: 'R_PU', terminal: 'b' },
      { part: 'BTN1', terminal: 'a' },
      { part: 'MCU', terminal: 'P3.2' },
    ]},
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BTN1', terminal: 'b' }] },
  ];
  return { parts, nets };
}

describe('button with pull-up', () => {
  it('button open → pin reads 1 (pulled to VCC)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeButtonCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P3.2', 'input', false);
    board.setControl('BTN1', 0); // not pressed

    assert.equal(board.readPin('P3.2'), 1);
  });

  it('button pressed → pin reads 0 (shorted to GND)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeButtonCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P3.2', 'input', false);
    board.setControl('BTN1', 1); // pressed

    assert.equal(board.readPin('P3.2'), 0);
  });
});

describe('resistance honesty trap', () => {
  it('returns requires-power-off when powered', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeButtonCircuit();
    board.setNetlist(parts, nets);

    const result = board.resistance('net_vcc', 'net_gnd');
    assert.equal(result, 'requires-power-off');
  });
});
