/**
 * Edge cases and robustness tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('empty / degenerate netlists', () => {
  it('empty netlist does not crash', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    board.advanceTo(1_000_000n);
    // Should not throw
  });

  it('VCC and GND only — no other parts', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assert.equal(board.nodeVoltage('net_vcc'), 5.0);
    assert.equal(board.nodeVoltage('net_gnd'), 0);
  });

  it('querying unknown net returns 0', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    assert.equal(board.nodeVoltage('nonexistent'), 0);
  });

  it('querying unknown LED brightness returns 0', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    assert.equal(board.ledBrightness('nonexistent'), 0);
  });

  it('querying unknown buzzer returns off', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const tone = board.buzzerTone('nonexistent');
    assert.equal(tone.on, false);
    assert.equal(tone.hz, 0);
  });

  it('readPin on unset pin returns 0', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }],
      [{ id: 'net_p', terminals: [{ part: 'MCU', terminal: 'P1.0' }] }],
    );
    assert.equal(board.readPin('P1.0'), 0);
  });

  it('readAnalog on unset pin returns 0', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] }],
      [{ id: 'net_p', terminals: [{ part: 'MCU', terminal: 'P1.3' }] }],
    );
    assert.equal(board.readAnalog('P1.3'), 0);
  });
});

describe('power on/off transitions', () => {
  it('turning power off clears node voltages', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    board.setPin('P1.0', 'pushpull', true);
    assert.equal(board.nodeVoltage('net_vcc'), 5.0);

    board.setPower(false);
    assert.equal(board.nodeVoltage('net_vcc'), 0);

    board.setPower(true);
    assert.equal(board.nodeVoltage('net_vcc'), 5.0);
  });

  it('LED brightness returns 0 when powered off', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'n4', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);

    const brightOn = board.ledBrightness('LED1');
    assert.ok(brightOn > 0.1, 'LED should be on');

    board.setPower(false);
    // After power off, solve clears everything. New samples won't have current.
    board.advanceTo(25_000_000n); // advance past the integration window
    const brightOff = board.ledBrightness('LED1');
    assert.ok(brightOff < 0.01, `LED brightness ${brightOff} should be ~0 when powered off`);
  });
});

describe('setNetlist resets state', () => {
  it('changing netlist clears previous LED history', () => {
    const board = new BoardImpl(5.0);
    const parts1 = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets1 = [
      { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'n4', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts1, nets1);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.1);

    // Replace with a different netlist — old LED1 history should be gone
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assert.equal(board.ledBrightness('LED1'), 0);
  });
});

describe('different VCC values', () => {
  it('3.3V supply produces lower LED current', () => {
    const board = new BoardImpl(3.3);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'n4', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);

    // I = (3.3 - 2) / (1000 + 10 + 25) = 1.3/1035 ≈ 1.256 mA
    // brightness = 1.256/20 ≈ 0.0628
    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.05, `brightness ${b} should be > 0.05`);
    assert.ok(b < 0.08, `brightness ${b} should be < 0.08`);
  });

  it('3.3V pot at midpoint → 1.65V', () => {
    const board = new BoardImpl(3.3);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT', 0.5);

    assert.ok(Math.abs(board.readAnalog('P1.3') - 1.65) < 0.01);
  });
});
