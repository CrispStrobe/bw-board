/**
 * Tests for power devices and sensors.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerPowerDevices } from '../src/devices/power.js';
import { registerSensors } from '../src/devices/sensors.js';
import { registerHBridge } from '../src/devices/h-bridge.js';
import { registerMotorDrivers } from '../src/devices/motor-drivers.js';
import { registerDisplayDevices } from '../src/devices/display.js';
import { unregisterDevice } from '../src/devices.js';

const ALL_KINDS = [
  'battery', 'vreg', 'fuse',
  'ultrasonic', 'pir', 'tilt_sensor', 'flex_sensor', 'force_sensor', 'phototransistor',
  'h_bridge', 'stepper', 'solenoid', 'neopixel', 'bargraph',
];

function setup() {
  registerPowerDevices();
  registerSensors();
  registerHBridge();
  registerMotorDrivers();
  registerDisplayDevices();
}
function teardown() {
  for (const k of ALL_KINDS) {
    try { unregisterDevice(k); } catch {}
  }
}

// ─── Battery ────────────────────────────────────────────────────────────

describe('battery: 9V source', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('drives 9V across a load resistor', () => {
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B1', kind: 'battery', params: { volts: 9, rInternal: 0.5 },
        terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'B1', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_pos');
    // 9V through 0.5Ω internal + 1000Ω load: V_load = 9 * 1000/1000.5 ≈ 8.996V
    assert.ok(v > 8.5, `battery should drive ~9V, got ${v.toFixed(3)}V`);
  });
});

// ─── Voltage Regulator ──────────────────────────────────────────────────

describe('vreg: 7805 (5V out from 9V in)', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('regulates to 5V output', () => {
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'B1', kind: 'battery', params: { volts: 9 }, terminals: ['pos', 'neg'] },
      { id: 'U1', kind: 'vreg', params: { vOut: 5.0, dropout: 1.5 },
        terminals: ['in', 'out', 'gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_9v', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'U1', terminal: 'in' }] },
      { id: 'net_5v', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'B1', terminal: 'neg' },
        { part: 'U1', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const vOut = board.nodeVoltage('net_5v');
    assert.ok(vOut > 4.5 && vOut < 5.5, `vreg should output ~5V, got ${vOut.toFixed(3)}V`);
  });
});

// ─── H-Bridge ───────────────────────────────────────────────────────────

describe('h_bridge: motor direction control', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('EN=H, IN1=H, IN2=L → OUT1=HIGH, OUT2=LOW (forward)', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'H1', kind: 'h_bridge', params: {},
        terminals: ['vcc', 'gnd', 'en1', 'in1', 'in2', 'out1', 'out2', 'en2', 'in3', 'in4', 'out3', 'out4'] },
      { id: 'MCU', kind: 'mcu', params: {},
        terminals: ['P1.0', 'P1.1', 'P1.2'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'H1', terminal: 'vcc' },
      ]},
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'H1', terminal: 'gnd' },
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'b' },
      ]},
      { id: 'net_en1', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'H1', terminal: 'en1' }] },
      { id: 'net_in1', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'H1', terminal: 'in1' }] },
      { id: 'net_in2', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'H1', terminal: 'in2' }] },
      { id: 'net_out1', terminals: [{ part: 'H1', terminal: 'out1' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_out2', terminals: [{ part: 'H1', terminal: 'out2' }, { part: 'R2', terminal: 'a' }] },
      // Unused half-bridge pins
      { id: 'net_en2', terminals: [{ part: 'H1', terminal: 'en2' }] },
      { id: 'net_in3', terminals: [{ part: 'H1', terminal: 'in3' }] },
      { id: 'net_in4', terminals: [{ part: 'H1', terminal: 'in4' }] },
      { id: 'net_out3', terminals: [{ part: 'H1', terminal: 'out3' }] },
      { id: 'net_out4', terminals: [{ part: 'H1', terminal: 'out4' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Enable + forward: EN=H, IN1=H, IN2=L
    board.setPin('P1.0', 'pushpull', true);  // EN1 HIGH
    board.setPin('P1.1', 'pushpull', true);  // IN1 HIGH
    board.setPin('P1.2', 'pushpull', false); // IN2 LOW

    const vOut1 = board.nodeVoltage('net_out1');
    const vOut2 = board.nodeVoltage('net_out2');

    assert.ok(vOut1 > 2.5, `OUT1 should be HIGH (~3.6V), got ${vOut1.toFixed(3)}V`);
    assert.ok(vOut2 < 2.5, `OUT2 should be LOW (~1.4V), got ${vOut2.toFixed(3)}V`);
  });
});

// ─── Flex sensor ────────────────────────────────────────────────────────

describe('flex_sensor: resistance varies with bend', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('straight = 25kΩ, bent = 100kΩ — voltage divider verifies', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'F1', kind: 'flex_sensor', params: { bend: 0, rFlat: 25000, rBent: 100000 },
        terminals: ['a', 'b'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 25000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'F1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [{ part: 'F1', terminal: 'b' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_mid');
    // Divider: 25k (flex) + 25k (fixed) = 50k. V_mid = 5 * 25k/50k = 2.5V
    assert.ok(Math.abs(v - 2.5) < 0.3, `straight flex: expected ~2.5V, got ${v.toFixed(3)}V`);
  });
});
