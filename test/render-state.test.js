/**
 * getRenderState tests: verify the UI gets everything in one call.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('getRenderState', () => {
  it('returns all fields with correct types', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
        { name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.setPin('P1.3', 'input', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT_pot', 0.6);
    board.advanceTo(25_000_000n);

    const state = board.getRenderState();

    assert.equal(typeof state.powered, 'boolean');
    assert.equal(typeof state.timeNs, 'bigint');
    assert.equal(typeof state.vcc, 'number');
    assert.ok(Array.isArray(state.leds));
    assert.ok(Array.isArray(state.buzzers));
    assert.ok(Array.isArray(state.controls));
    assert.ok(Array.isArray(state.pins));
    assert.ok(Array.isArray(state.warnings));
    assert.ok(Array.isArray(state.nodeVoltages));
  });

  it('LED brightness is populated', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);

    const state = board.getRenderState();
    const led = state.leds.find(l => l.id === 'LED_led');
    assert.ok(led, 'LED should be in render state');
    assert.ok(led.brightness > 0.10, `brightness: ${led.brightness}`);
  });

  it('controls reflect current values', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setControl('POT_pot', 0.42);

    const state = board.getRenderState();
    const pot = state.controls.find(c => c.id === 'POT_pot');
    assert.ok(pot);
    assert.equal(pot.value, 0.42);
  });

  it('pins reflect current state', () => {
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
    board.setPin('P1.0', 'pushpull', true);

    const state = board.getRenderState();
    const pin = state.pins.find(p => p.pin === 'P1.0');
    assert.ok(pin);
    assert.equal(pin.mode, 'pushpull');
    assert.equal(pin.driveHigh, true);
  });

  it('node voltages included', () => {
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

    const state = board.getRenderState();
    const vccNode = state.nodeVoltages.find(n => n.net === 'nv');
    assert.ok(vccNode);
    assert.equal(vccNode.voltage, 5.0);
  });

  it('warnings appear in render state', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nshort', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false); // LOW into VCC = short

    const state = board.getRenderState();
    assert.ok(state.warnings.length > 0, 'should have warnings');
    assert.ok(state.warnings.some(w => w.severity === 'danger'));
  });
});
