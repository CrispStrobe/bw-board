/**
 * Digital IC tests — decade counter, D flip-flop, JK flip-flop.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerDigitalICs } from '../src/devices/digital-ics.js';
import { unregisterDevice } from '../src/devices.js';

const KINDS = ['decade_counter', 'dff', 'jkff', 'darlington_driver', 'piezo'];

function setup() { registerDigitalICs(); }
function teardown() { for (const k of KINDS) { try { unregisterDevice(k); } catch {} } }

// ─── Decade Counter ─────────────────────────────────────────────────────

describe('decade_counter: CD4017', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('counts through Q0-Q9 on clock edges', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'decade_counter', params: {},
        terminals: ['clk', 'rst', 'en', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'co'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];

    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'U1', terminal: 'en' },  // EN active LOW (tied LOW)
        { part: 'U1', terminal: 'rst' }, // RST tied LOW
      ]},
      { id: 'net_clk', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'clk' }] },
    ];

    // Add output nets
    for (let i = 0; i < 10; i++) {
      nets.push({ id: `net_q${i}`, terminals: [{ part: 'U1', terminal: `q${i}` }] });
    }
    nets.push({ id: 'net_co', terminals: [{ part: 'U1', terminal: 'co' }] });

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false); // CLK starts LOW

    // Q0 should be HIGH initially
    assert.ok(board.nodeVoltage('net_q0') > 3.0, 'Q0 starts HIGH');
    assert.ok(board.nodeVoltage('net_q1') < 1.0, 'Q1 starts LOW');

    // Clock once: Q1 should go HIGH
    board.setPin('P1.0', 'pushpull', true);  // rising edge
    board.setPin('P1.0', 'pushpull', false); // falling edge

    assert.ok(board.nodeVoltage('net_q0') < 1.0, 'Q0 now LOW');
    assert.ok(board.nodeVoltage('net_q1') > 3.0, 'Q1 now HIGH');

    // Clock 4 more times to reach Q5
    for (let i = 0; i < 4; i++) {
      board.setPin('P1.0', 'pushpull', true);
      board.setPin('P1.0', 'pushpull', false);
    }
    assert.ok(board.nodeVoltage('net_q5') > 3.0, 'Q5 HIGH after 5 clocks');

    // Carry out: should be LOW for counts 5-9
    assert.ok(board.nodeVoltage('net_co') < 1.0, 'CO LOW for count >= 5');
  });
});

// ─── D Flip-Flop ────────────────────────────────────────────────────────

describe('dff: D flip-flop', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('captures D on rising clock edge', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'dff', params: {},
        terminals: ['d', 'clk', 'set', 'rst', 'q', 'q_bar'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'U1', terminal: 'set' },
        { part: 'U1', terminal: 'rst' },
      ]},
      { id: 'net_d', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'd' }] },
      { id: 'net_clk', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'clk' }] },
      { id: 'net_q', terminals: [{ part: 'U1', terminal: 'q' }] },
      { id: 'net_qbar', terminals: [{ part: 'U1', terminal: 'q_bar' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.1', 'pushpull', false); // CLK LOW

    // Set D=HIGH, clock it
    board.setPin('P1.0', 'pushpull', true);  // D = HIGH
    board.setPin('P1.1', 'pushpull', true);  // CLK rising edge
    board.setPin('P1.1', 'pushpull', false);

    assert.ok(board.nodeVoltage('net_q') > 3.0, 'Q should be HIGH after capturing D=1');
    assert.ok(board.nodeVoltage('net_qbar') < 1.0, 'Q_bar should be LOW');

    // Set D=LOW, clock it
    board.setPin('P1.0', 'pushpull', false); // D = LOW
    board.setPin('P1.1', 'pushpull', true);  // CLK rising edge
    board.setPin('P1.1', 'pushpull', false);

    assert.ok(board.nodeVoltage('net_q') < 1.0, 'Q should be LOW after capturing D=0');
    assert.ok(board.nodeVoltage('net_qbar') > 3.0, 'Q_bar should be HIGH');
  });
});

// ─── JK Flip-Flop ───────────────────────────────────────────────────────

describe('jkff: JK flip-flop toggle', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('J=K=1 toggles on each clock', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'jkff', params: {},
        terminals: ['j', 'k', 'clk', 'set', 'rst', 'q', 'q_bar'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'U1', terminal: 'j' },  // J=1
        { part: 'U1', terminal: 'k' },  // K=1
      ]},
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'U1', terminal: 'set' },
        { part: 'U1', terminal: 'rst' },
      ]},
      { id: 'net_clk', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'clk' }] },
      { id: 'net_q', terminals: [{ part: 'U1', terminal: 'q' }] },
      { id: 'net_qbar', terminals: [{ part: 'U1', terminal: 'q_bar' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    // Initially Q=0
    assert.ok(board.nodeVoltage('net_q') < 1.0, 'Q starts LOW');

    // First clock: toggle to 1
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.0', 'pushpull', false);
    assert.ok(board.nodeVoltage('net_q') > 3.0, 'Q toggles to HIGH');

    // Second clock: toggle back to 0
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.0', 'pushpull', false);
    assert.ok(board.nodeVoltage('net_q') < 1.0, 'Q toggles back to LOW');
  });
});
