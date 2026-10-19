/**
 * Teaching-oriented warning tests: backward LED, unconnected output pin.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('warnings: backward LED', () => {
  it('cathode at higher voltage than anode → warning', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        // LED wired backward: cathode → VCC side, anode → GND side
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LED1', terminal: 'cathode' }] },
        { id: 'nr', terminals: [{ part: 'LED1', terminal: 'anode' }, { part: 'R1', terminal: 'a' }] },
        { id: 'np', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);

    const w = board.getWarnings();
    assert.ok(w.some(w => w.partId === 'LED1' && w.message.includes('backward')),
      `should warn about backward LED: ${w.map(w => w.message).join('; ')}`);
  });

  it('correctly wired LED → no backward warning', () => {
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

    const w = board.getWarnings().filter(w => w.message.includes('backward'));
    assert.equal(w.length, 0, 'correctly wired → no backward warning');
  });
});

describe('warnings: unconnected output pin', () => {
  it('output pin driving with nothing attached → warning', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }] }, // only MCU on this net
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', true); // driving output

    const w = board.getWarnings();
    assert.ok(w.some(w => w.message.includes('nothing is connected')),
      `should warn: ${w.map(w => w.message).join('; ')}`);
  });

  it('output pin with LED attached → no warning', () => {
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

    const w = board.getWarnings().filter(w => w.message.includes('nothing is connected'));
    assert.equal(w.length, 0);
  });

  it('input pin with nothing attached → no warning (expected)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'input', false); // input mode

    const w = board.getWarnings().filter(w => w.message.includes('nothing is connected'));
    assert.equal(w.length, 0, 'input pin alone is fine');
  });
});
