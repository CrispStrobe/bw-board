/**
 * Netlist mutation tests: hot-swapping components, adding/removing parts,
 * changing resistor values, and verifying the board resets correctly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('netlist hot-swap', () => {
  it('changing resistor value changes LED brightness', () => {
    const board = new BoardImpl(5.0);

    function makeLED(ohms) {
      return {
        parts: [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'R1', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
          { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
          { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        ],
        nets: [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
          { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
          { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      };
    }

    // 1kΩ
    const c1 = makeLED(1000);
    board.setNetlist(c1.parts, c1.nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);
    const b1k = board.ledBrightness('LED1');

    // Hot-swap to 470Ω — brighter
    const c2 = makeLED(470);
    board.setNetlist(c2.parts, c2.nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(50_000_000n);
    const b470 = board.ledBrightness('LED1');

    assert.ok(b470 > b1k, `470Ω (${b470}) should be brighter than 1kΩ (${b1k})`);

    // Hot-swap to 10kΩ — dimmer
    const c3 = makeLED(10000);
    board.setNetlist(c3.parts, c3.nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(75_000_000n);
    const b10k = board.ledBrightness('LED1');

    assert.ok(b10k < b1k, `10kΩ (${b10k}) should be dimmer than 1kΩ (${b1k})`);
  });

  it('adding a second LED to existing circuit', () => {
    const board = new BoardImpl(5.0);

    // Start with 1 LED
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
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.1);
    assert.equal(board.ledBrightness('LED2'), 0); // doesn't exist yet

    // Add second LED
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'LED2', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }] },
        { id: 'nr1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np1', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'nr2', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'LED2', terminal: 'anode' }] },
        { id: 'np2', terminals: [{ part: 'LED2', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.1' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', false);
    board.advanceTo(50_000_000n);

    assert.ok(board.ledBrightness('LED1') > 0.1, 'LED1 still works');
    assert.ok(board.ledBrightness('LED2') > 0.1, 'LED2 now works');
  });
});

describe('netlist: VCC value change', () => {
  it('switching from 5V to 3.3V board changes all voltages', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];

    const board5V = new BoardImpl(5.0);
    board5V.setNetlist(parts, nets);
    assert.ok(Math.abs(board5V.nodeVoltage('nm') - 2.5) < 0.01);

    const board3V3 = new BoardImpl(3.3);
    board3V3.setNetlist(parts, nets);
    assert.ok(Math.abs(board3V3.nodeVoltage('nm') - 1.65) < 0.01);
  });
});

describe('netlist: pin state survives setNetlist', () => {
  it('pin states are preserved across netlist changes', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];

    // Set pin before netlist
    board.setPin('P1.0', 'pushpull', false);
    board.setNetlist(parts, nets);
    board.advanceTo(25_000_000n);

    // Pin state should have been applied during setNetlist's _solve()
    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.1, `LED should be on from pre-existing pin state: ${b}`);
  });
});
