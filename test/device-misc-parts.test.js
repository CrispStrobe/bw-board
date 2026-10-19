/**
 * Miscellaneous parts tests.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerMiscParts } from '../src/devices/misc-parts.js';
import { unregisterDevice } from '../src/devices.js';

const KINDS = ['dc_motor_encoder', 'keypad_4x4', 'dip_switch', 'vibration_motor', 'polarized_cap'];

function setup() { registerMiscParts(); }
function teardown() { for (const k of KINDS) { try { unregisterDevice(k); } catch {} } }

describe('keypad_4x4: pressed key shorts row to column', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('key 5 (row 1, col 1) shorts R1 to C1', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'KP', kind: 'keypad_4x4', params: { pressed: 5 },
        terminals: ['r0', 'r1', 'r2', 'r3', 'c0', 'c1', 'c2', 'c3'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' },
      ]},
      // Drive row 1 HIGH via MCU, read column 1 through pull-down
      { id: 'net_r1', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'KP', terminal: 'r1' }] },
      { id: 'net_c1', terminals: [{ part: 'KP', terminal: 'c1' }, { part: 'R1', terminal: 'a' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Drive row 1 HIGH
    board.setPin('P1.0', 'pushpull', true);

    // Key 5 = row 1, col 1 → C1 should be pulled HIGH through the short
    const vC1 = board.nodeVoltage('net_c1');
    assert.ok(vC1 > 4.0, `C1 should be HIGH when key 5 pressed (row1→col1), got ${vC1.toFixed(3)}V`);
  });
});

describe('dip_switch: individual switches', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('switch 0 closed shorts s0_a to s0_b', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'DS', kind: 'dip_switch', params: { switches: 0b0001 }, // switch 0 closed
        terminals: ['s0_a', 's0_b', 's1_a', 's1_b', 's2_a', 's2_b', 's3_a', 's3_b'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'DS', terminal: 's0_a' }] },
      { id: 'net_out', terminals: [{ part: 'DS', terminal: 's0_b' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_out');
    assert.ok(v > 4.5, `switch 0 closed: output should be ~VCC, got ${v.toFixed(3)}V`);
  });
});

describe('vibration_motor: vibrates above threshold', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('3V across motor → vibrating', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'M1', kind: 'vibration_motor', params: { ohms: 15, vThreshold: 1.5 },
        terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_drive', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'M1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'M1', terminal: 'b' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(1_000_000n);

    const state = board.getDeviceState('M1');
    assert.ok(state.vibrating, 'motor should be vibrating at 5V');
  });
});
