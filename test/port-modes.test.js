/**
 * Test: all four port modes explicitly.
 *
 * Verifies the Thévenin equivalents and their observable effects.
 * Circuit: VCC → 10kΩ pull-up → MCU pin P1.0 (with nothing else).
 * The pin voltage depends on the mode and drive.
 *
 * Hand-computed:
 *   input mode:       high-Z, pin = VCC (pulled up). readPin = 1.
 *   open-drain low:   Vth=0, Rth=25Ω. Divider: V = 5 * 25/(10000+25) ≈ 0.012V. readPin = 0.
 *   open-drain high:  high-Z, pin = VCC. readPin = 1.
 *   quasi low:        same as open-drain low. readPin = 0.
 *   quasi high:       Vth=5V, Rth=21700Ω ∥ 10kΩ pull-up(Vth=5V).
 *                     Both pull to VCC → pin ≈ VCC. readPin = 1.
 *   push-pull low:    Vth=0, Rth=25Ω. Same divider → 0.012V. readPin = 0.
 *   push-pull high:   Vth=5V, Rth=25Ω. Pin ≈ VCC. readPin = 1.
 *
 * The open-drain mode test: if you need an I2C bus, you use open-drain
 * with an external pull-up. Driving high releases the bus.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { pinThevenin } from '../src/pin-model.js';

function makePullUpCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
    { id: 'net_pin', terminals: [{ part: 'R_PU', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
  ];
  return { parts, nets };
}

describe('pin model — input-pullup Thévenin values', () => {
  it('input-pullup = weak pull-up ~35kΩ to VCC', () => {
    const t = pinThevenin('input-pullup', false, 5.0);
    assert.notEqual(t, 'high-z');
    assert.equal(t.vTh, 5.0);
    assert.equal(t.rTh, 35000);
  });

  it('input-pullup ignores driveHigh — always pulls up', () => {
    const tLow = pinThevenin('input-pullup', false, 5.0);
    const tHigh = pinThevenin('input-pullup', true, 5.0);
    assert.deepEqual(tLow, tHigh, 'driveHigh does not matter');
  });
});

describe('pin model — Thévenin values', () => {
  it('quasi low = strong sink', () => {
    const t = pinThevenin('quasi', false, 5.0);
    assert.notEqual(t, 'high-z');
    assert.equal(t.vTh, 0);
    assert.equal(t.rTh, 25);
  });

  it('quasi high = weak pull-up ~21.7kΩ', () => {
    const t = pinThevenin('quasi', true, 5.0);
    assert.notEqual(t, 'high-z');
    assert.equal(t.vTh, 5.0);
    assert.equal(t.rTh, 21700);
  });

  it('pushpull low = strong sink', () => {
    const t = pinThevenin('pushpull', false, 5.0);
    assert.deepEqual(t, { vTh: 0, rTh: 25 });
  });

  it('pushpull high = strong source', () => {
    const t = pinThevenin('pushpull', true, 5.0);
    assert.deepEqual(t, { vTh: 5.0, rTh: 25 });
  });

  it('input = always high-Z', () => {
    assert.equal(pinThevenin('input', false, 5.0), 'high-z');
    assert.equal(pinThevenin('input', true, 5.0), 'high-z');
  });

  it('opendrain low = strong sink', () => {
    const t = pinThevenin('opendrain', false, 5.0);
    assert.deepEqual(t, { vTh: 0, rTh: 25 });
  });

  it('opendrain high = high-Z (needs external pull-up)', () => {
    assert.equal(pinThevenin('opendrain', true, 5.0), 'high-z');
  });
});

describe('open-drain with external pull-up', () => {
  it('driving high → released, pull-up wins, readPin = 1', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePullUpCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'opendrain', true);
    assert.equal(board.readPin('P1.0'), 1, 'open-drain high → pulled to VCC');
  });

  it('driving low → sinks, overrides pull-up, readPin = 0', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makePullUpCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'opendrain', false);
    assert.equal(board.readPin('P1.0'), 0, 'open-drain low → sinks to GND');
  });

  it('simulates I2C: two open-drain pins sharing a bus', () => {
    // Two MCU pins on the same net with a pull-up.
    // If either drives low, the bus is low.
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R_PU', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
      { id: 'net_bus', terminals: [
        { part: 'R_PU', terminal: 'b' },
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'MCU', terminal: 'P1.1' },
      ]},
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Both high → bus pulled up
    board.setPin('P1.0', 'opendrain', true);
    board.setPin('P1.1', 'opendrain', true);
    assert.equal(board.readPin('P1.0'), 1, 'both released → bus high');

    // One drives low → bus low
    board.setPin('P1.0', 'opendrain', false);
    assert.equal(board.readPin('P1.0'), 0, 'one low → bus low');
    assert.equal(board.readPin('P1.1'), 0, 'other pin also reads low');

    // Release it → bus high again
    board.setPin('P1.0', 'opendrain', true);
    assert.equal(board.readPin('P1.0'), 1, 'released → bus high again');
  });
});

describe('input-pullup with button to ground', () => {
  // The standard Arduino idiom: INPUT_PULLUP with a button between pin and GND.
  // Open: node voltage = VCC (pulled up through 35kΩ). readPin = 1.
  // Pressed: node voltage = 0V (button shorts to GND). readPin = 0.
  function makeButtonCircuit() {
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      nets: [
        { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'net_pin', terminals: [
          { part: 'MCU', terminal: 'P1.0' },
          { part: 'BTN', terminal: 'a' },
        ]},
        { id: 'net_gnd', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'BTN', terminal: 'b' },
        ]},
      ],
    };
  }

  it('button open → node voltage = VCC, readPin = 1', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeButtonCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'input-pullup', false);
    board.setControl('BTN', 0); // button not pressed

    const v = board.nodeVoltage('net_pin');
    assert.ok(Math.abs(v - 5.0) < 0.01,
      `open button: node voltage should be ~5.0V, got ${v}`);
    assert.equal(board.readPin('P1.0'), 1, 'reads HIGH');
  });

  it('button pressed → node voltage = 0V, readPin = 0', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeButtonCircuit();
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'input-pullup', false);
    board.setControl('BTN', 1); // button pressed

    const v = board.nodeVoltage('net_pin');
    assert.ok(Math.abs(v) < 0.01,
      `pressed button: node voltage should be ~0V, got ${v}`);
    assert.equal(board.readPin('P1.0'), 0, 'reads LOW');
  });

  it('resistor to GND — voltage divider asserted', () => {
    // 10kΩ to GND with 35kΩ internal pull-up: V = 5 * 35k/(35k+10k) = 3.889V
    // Wait — divider from VCC through pull-up R to node, then through external R to GND:
    // V_node = VCC * R_ext / (R_pullup + R_ext) — NO.
    // Thévenin: pin drives vTh=5V through rTh=35kΩ. External 10kΩ to GND.
    // V_node = 5 * 10000 / (35000 + 10000) = 1.111V
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R_EXT', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_pin', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'R_EXT', terminal: 'a' },
      ]},
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R_EXT', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'input-pullup', false);

    const v = board.nodeVoltage('net_pin');
    const expected = 5.0 * 10000 / (35000 + 10000); // 1.111V
    assert.ok(Math.abs(v - expected) < 0.05,
      `divider: expected ~${expected.toFixed(3)}V, got ${v.toFixed(3)}V`);
  });
});
