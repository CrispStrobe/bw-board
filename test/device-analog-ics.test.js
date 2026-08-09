/**
 * Analog ICs: TIP120, LM393, TMP36, light bulb, optocoupler.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAnalogICs } from '../src/devices/analog-ics.js';
import { unregisterDevice } from '../src/devices.js';

const KINDS = ['tip120', 'lm393', 'tmp36', 'light_bulb', 'optocoupler'];

function setup() { registerAnalogICs(); }
function teardown() { for (const k of KINDS) { try { unregisterDevice(k); } catch {} } }

describe('TIP120: Darlington switch', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('base > 1.4V above emitter → collector sinks', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'Q1', kind: 'tip120', params: {}, terminals: ['base', 'collector', 'emitter'] },
      { id: 'R_BASE', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R_LOAD', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_LOAD', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
      { id: 'net_base', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R_BASE', terminal: 'a' }] },
      { id: 'net_base2', terminals: [{ part: 'R_BASE', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
      { id: 'net_col', terminals: [{ part: 'R_LOAD', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Base driven HIGH → transistor ON → collector near GND
    board.setPin('P1.0', 'pushpull', true);
    const vCol = board.nodeVoltage('net_col');
    assert.ok(vCol < 2.0, `collector should be near GND when ON, got ${vCol.toFixed(3)}V`);

    // Base driven LOW → transistor OFF → collector near VCC
    board.setPin('P1.0', 'pushpull', false);
    const vColOff = board.nodeVoltage('net_col');
    assert.ok(vColOff > 4.0, `collector should be near VCC when OFF, got ${vColOff.toFixed(3)}V`);
  });
});

describe('TMP36: temperature sensor', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('25°C → 750mV output', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'T1', kind: 'tmp36', params: { tempC: 25 }, terminals: ['vcc', 'out', 'gnd'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'T1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'T1', terminal: 'gnd' }] },
      { id: 'net_out', terminals: [{ part: 'T1', terminal: 'out' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_out');
    // 500mV + 25 * 10mV = 750mV
    assert.ok(Math.abs(v - 0.75) < 0.05, `TMP36 at 25°C should output ~750mV, got ${(v*1000).toFixed(1)}mV`);
  });

  it('0°C → 500mV, 100°C → 1500mV', () => {
    // 0°C
    const parts0 = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'T1', kind: 'tmp36', params: { tempC: 0 }, terminals: ['vcc', 'out', 'gnd'] },
    ];
    const nets0 = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'T1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'T1', terminal: 'gnd' }] },
      { id: 'net_out', terminals: [{ part: 'T1', terminal: 'out' }] },
    ];
    const board0 = new BoardImpl(5.0);
    board0.setNetlist(parts0, nets0);
    assert.ok(Math.abs(board0.nodeVoltage('net_out') - 0.5) < 0.05, '0°C → 500mV');

    // 100°C
    const parts100 = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'T1', kind: 'tmp36', params: { tempC: 100 }, terminals: ['vcc', 'out', 'gnd'] },
    ];
    const nets100 = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'T1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'T1', terminal: 'gnd' }] },
      { id: 'net_out', terminals: [{ part: 'T1', terminal: 'out' }] },
    ];
    const board100 = new BoardImpl(5.0);
    board100.setNetlist(parts100, nets100);
    assert.ok(Math.abs(board100.nodeVoltage('net_out') - 1.5) < 0.05, '100°C → 1500mV');
  });
});

describe('LM393: comparator', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('V+ > V- → output floats (open collector), V+ < V- → output sinks', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'lm393', params: {},
        terminals: ['1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out', 'vcc', 'gnd'] },
      { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'U1', terminal: 'vcc' },
        { part: 'R_PU', terminal: 'a' },  // pull-up on output
      ]},
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
      { id: 'net_pos', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: '1_pos' }] },
      { id: 'net_neg', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: '1_neg' }] },
      { id: 'net_out', terminals: [{ part: 'U1', terminal: '1_out' }, { part: 'R_PU', terminal: 'b' }] },
      // Unused comparator 2
      { id: 'net_2p', terminals: [{ part: 'U1', terminal: '2_pos' }] },
      { id: 'net_2n', terminals: [{ part: 'U1', terminal: '2_neg' }] },
      { id: 'net_2o', terminals: [{ part: 'U1', terminal: '2_out' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // V+ > V- → output floats → pulled HIGH by R_PU
    board.setPin('P1.0', 'pushpull', true);  // pos = 5V
    board.setPin('P1.1', 'pushpull', false); // neg = 0V
    assert.ok(board.nodeVoltage('net_out') > 4.0, 'V+ > V- → output HIGH (pulled up)');

    // V+ < V- → output sinks LOW
    board.setPin('P1.0', 'pushpull', false); // pos = 0V
    board.setPin('P1.1', 'pushpull', true);  // neg = 5V
    assert.ok(board.nodeVoltage('net_out') < 1.0, 'V+ < V- → output LOW (sinking)');
  });
});

describe('light_bulb: brightness from power', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('full voltage → brightness 1.0, half → 0.25', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'L1', kind: 'light_bulb', params: { ohms: 500, vRated: 5.0 },
        terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'L1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'L1', terminal: 'b' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(1_000_000n); // let update run

    const state = board.getDeviceState('L1');
    assert.ok(state, 'light bulb has device state');
    assert.ok(Math.abs(state.brightness - 1.0) < 0.05,
      `full voltage: brightness should be ~1.0, got ${state.brightness.toFixed(3)}`);
  });
});
