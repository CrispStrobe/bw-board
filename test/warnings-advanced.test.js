/**
 * Advanced warning tests: various overcurrent scenarios,
 * multiple warnings at once, warning clearance.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('warnings: different overcurrent scenarios', () => {
  it('LED with tiny resistor → danger', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);

    const w = board.getWarnings();
    assert.ok(w.some(w => w.severity === 'danger' && w.partId === 'LED1'));
  });

  it('LED with proper resistor → no warning', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);

    const w = board.getWarnings();
    assert.equal(w.length, 0);
  });

  it('multiple LEDs, only the overcurrent one warns', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_OK', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R_BAD', kind: 'resistor', params: { ohms: 5 }, terminals: ['a', 'b'] },
        { id: 'LED_OK', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'LED_BAD', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
      ],
      [
        { id: 'nv', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R_OK', terminal: 'a' },
          { part: 'R_BAD', terminal: 'a' },
        ]},
        { id: 'nr1', terminals: [{ part: 'R_OK', terminal: 'b' }, { part: 'LED_OK', terminal: 'anode' }] },
        { id: 'np1', terminals: [{ part: 'LED_OK', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'nr2', terminals: [{ part: 'R_BAD', terminal: 'b' }, { part: 'LED_BAD', terminal: 'anode' }] },
        { id: 'np2', terminals: [{ part: 'LED_BAD', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.1' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', false);

    const w = board.getWarnings();
    assert.ok(w.some(w => w.partId === 'LED_BAD' && w.severity === 'danger'),
      'LED_BAD should warn');
    assert.ok(!w.some(w => w.partId === 'LED_OK'),
      'LED_OK should not warn');
  });

  it('LED off → no warning even with tiny resistor', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 5 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    // Pin high → LED off → no current → no warning
    board.setPin('P1.0', 'pushpull', true);
    assert.equal(board.getWarnings().length, 0);
  });
});
