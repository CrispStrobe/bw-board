/**
 * Bare-chip GPIO tests — an attiny88/attiny85 DIP body is an MCU-pin
 * surface exactly like the STC12 'mcu' kind and the dev-board kinds:
 * setPin() drives its terminals, readPin() reads them.
 *
 * Regression for the blinkenrocket pendant (owner report 2026-08-16):
 * the chip was ELECTRICALLY ABSENT — _pinSources recognized only kind
 * 'mcu', no device model existed for the bare chips, and _pinVoltage
 * also gated on kind 'mcu'. The firmware ran, the adapter published pin
 * states, and nothing on the board ever saw them: matrix dark, buttons
 * pressing into the void.
 *
 * Oracle values derived by hand from Ohm's law, not from the solver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function makeBoard(parts, nets, vcc = 5.0) {
  const board = new BoardImpl(vcc);
  board.setNetlist(parts, nets);
  return board;
}

describe('bare attiny88 as MCU-pin surface', () => {
  it('setPin drives an LED through the chip terminal (output path)', () => {
    // attiny88 pb0 → 220Ω → LED (Vf=2, Rd=10) → GND symbol
    // Push-pull high ≈ 5V at low impedance:
    // I ≈ (5 - 2) / (220 + 10 + small) ≈ 13 mA → LED lit, anode ≈ 2.13V
    const board = makeBoard(
      [
        { id: 'MCU', kind: 'attiny88', params: {},
          terminals: ['pb0', 'vcc', 'gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n_pb0', terminals: [
          { part: 'MCU', terminal: 'pb0' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'LED1', terminal: 'anode' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'LED1', terminal: 'cathode' },
          { part: 'GND1', terminal: 'gnd' },
        ]},
      ],
    );

    // Before the pin drives: net floats near 0, LED dark
    assert.equal(board.ledBrightness('LED1'), 0, 'LED dark before drive');

    board.setPin('PB0', 'pushpull', true);
    const vPin = board.nodeVoltage('n_pb0');
    assert.ok(vPin > 4.0,
      `pb0 driven high should pull its net near 5V, got ${vPin.toFixed(3)}V`);
    assert.ok(board.ledBrightness('LED1') > 0.3,
      `LED should light from a bare-chip pin, brightness=${board.ledBrightness('LED1')}`);

    board.setPin('PB0', 'pushpull', false);
    assert.ok(board.nodeVoltage('n_pb0') < 0.5,
      'pb0 driven low should pull its net near 0V');
  });

  it('readPin reads a button through the chip terminal (input path)', () => {
    // VCC symbol → button → pc3, with 10k pull-down pc3 → GND.
    // Released: pc3 ≈ 0 (pull-down) → readPin 0.
    // Pressed:  pc3 ≈ 5V (button closes) → readPin 1.
    const board = makeBoard(
      [
        { id: 'MCU', kind: 'attiny88', params: {}, terminals: ['pc3'] },
        { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        { id: 'RPD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_vcc', terminals: [
          { part: 'VCC1', terminal: 'vcc' },
          { part: 'BTN', terminal: 'a' },
        ]},
        { id: 'n_pc3', terminals: [
          { part: 'BTN', terminal: 'b' },
          { part: 'MCU', terminal: 'pc3' },
          { part: 'RPD', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'RPD', terminal: 'b' },
          { part: 'GND1', terminal: 'gnd' },
        ]},
      ],
    );

    board.setPin('PC3', 'input', false);
    assert.equal(board.readPin('PC3'), 0, 'released button reads 0 (pull-down)');

    board.setControl('BTN', 1);
    assert.equal(board.readPin('PC3'), 1, 'pressed button reads 1');

    board.setControl('BTN', 0);
    assert.equal(board.readPin('PC3'), 0, 'released again reads 0');
  });
});

describe('bare attiny85 as MCU-pin surface', () => {
  it('setPin drives its pb1 terminal', () => {
    const board = makeBoard(
      [
        { id: 'T85', kind: 'attiny85', params: {}, terminals: ['pb1'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n_pb1', terminals: [
          { part: 'T85', terminal: 'pb1' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'GND1', terminal: 'gnd' },
        ]},
      ],
    );
    board.setPin('PB1', 'pushpull', true);
    assert.ok(board.nodeVoltage('n_pb1') > 4.0, 'pb1 drives high');
  });
});

describe('arduino_mega as MCU-pin surface (example-sweep regression)', () => {
  it('5v sources; d13 drives; a0 reads', () => {
    const board = makeBoard(
      [
        { id: 'MEGA', kind: 'arduino_mega', params: {}, terminals: ['5v', 'gnd', 'd13', 'a0'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_d13', terminals: [{ part: 'MEGA', terminal: 'd13' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n_gnd', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'MEGA', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
        { id: 'n_a0', terminals: [{ part: 'MEGA', terminal: 'a0' }, { part: 'R2', terminal: 'a' }] },
        { id: 'n_5v', terminals: [{ part: 'MEGA', terminal: '5v' }] },
      ],
    );
    assert.ok(board.nodeVoltage('n_5v') > 4.9, 'Mega 5v pin sources');
    board.setPin('D13', 'pushpull', true);
    assert.ok(board.nodeVoltage('n_d13') > 4.0, 'd13 drives high');
    board.setPin('A0', 'input', false);
    assert.equal(board.readPin('A0'), 0, 'a0 reads its pulled-down net');
  });
});
