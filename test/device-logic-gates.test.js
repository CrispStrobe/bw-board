/**
 * Logic gate device model tests — hand-computed oracles.
 *
 * Each test drives gate inputs via MCU pins (push-pull) and asserts the
 * output voltage matches the truth table. Tolerance: the output is a
 * Thévenin source (50 Ohm) into a 10kOhm load, so:
 *   V_high = 5 * 10000 / (10000 + 50) = 4.975V
 *   V_low  = 0V (through 50 Ohm, negligible)
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLogicGates } from '../src/devices/logic-gates.js';
import { unregisterDevice } from '../src/devices.js';

const GATE_KINDS = ['gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor'];

function setup() {
  registerLogicGates();
}

function teardown() {
  for (const k of GATE_KINDS) {
    try { unregisterDevice(k); } catch { /* already gone */ }
  }
}

function makeGateCircuit(gateKind, inputCount = 2) {
  const gateTerminals = [];
  for (let i = 0; i < inputCount; i++) gateTerminals.push(`in${i}`);
  gateTerminals.push('out');

  const mcuTerminals = [];
  for (let i = 0; i < inputCount; i++) mcuTerminals.push(`P1.${i}`);

  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: gateKind, params: { inputs: inputCount }, terminals: gateTerminals },
    { id: 'R_LOAD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerminals },
  ];

  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' },
      { part: 'R_LOAD', terminal: 'b' },
    ]},
    { id: 'net_out', terminals: [
      { part: 'U1', terminal: 'out' },
      { part: 'R_LOAD', terminal: 'a' },
    ]},
  ];

  // Wire each MCU pin to gate input
  for (let i = 0; i < inputCount; i++) {
    nets.push({
      id: `net_in${i}`,
      terminals: [
        { part: 'MCU', terminal: `P1.${i}` },
        { part: 'U1', terminal: `in${i}` },
      ],
    });
  }

  return { parts, nets };
}

function driveInputs(board, levels) {
  for (let i = 0; i < levels.length; i++) {
    board.setPin(`P1.${i}`, 'pushpull', levels[i] === 1);
  }
}

// Oracle: V_high with 50 Ohm output into 10kOhm load
const V_HIGH = 5 * 10000 / (10000 + 50); // 4.975V
const V_LOW_THRESHOLD = 0.1;
const V_HIGH_THRESHOLD = 4.5;

// ─── AND gate ───────────────────────────────────────────────────────────

describe('gate_and: truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  const cases = [
    { inputs: [0, 0], expected: 0 },
    { inputs: [0, 1], expected: 0 },
    { inputs: [1, 0], expected: 0 },
    { inputs: [1, 1], expected: 1 },
  ];

  for (const { inputs, expected } of cases) {
    it(`AND(${inputs}) = ${expected}`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeGateCircuit('gate_and', 2);
      board.setNetlist(parts, nets);
      driveInputs(board, inputs);

      const vOut = board.nodeVoltage('net_out');
      if (expected) {
        assert.ok(vOut > V_HIGH_THRESHOLD, `expected HIGH (~${V_HIGH.toFixed(3)}V), got ${vOut.toFixed(3)}V`);
      } else {
        assert.ok(vOut < V_LOW_THRESHOLD, `expected LOW (~0V), got ${vOut.toFixed(3)}V`);
      }
    });
  }
});

// ─── OR gate ────────────────────────────────────────────────────────────

describe('gate_or: truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  const cases = [
    { inputs: [0, 0], expected: 0 },
    { inputs: [0, 1], expected: 1 },
    { inputs: [1, 0], expected: 1 },
    { inputs: [1, 1], expected: 1 },
  ];

  for (const { inputs, expected } of cases) {
    it(`OR(${inputs}) = ${expected}`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeGateCircuit('gate_or', 2);
      board.setNetlist(parts, nets);
      driveInputs(board, inputs);

      const vOut = board.nodeVoltage('net_out');
      if (expected) {
        assert.ok(vOut > V_HIGH_THRESHOLD, `expected HIGH, got ${vOut.toFixed(3)}V`);
      } else {
        assert.ok(vOut < V_LOW_THRESHOLD, `expected LOW, got ${vOut.toFixed(3)}V`);
      }
    });
  }
});

// ─── NOT gate ───────────────────────────────────────────────────────────

describe('gate_not: truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('NOT(0) = 1', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeGateCircuit('gate_not', 1);
    board.setNetlist(parts, nets);
    driveInputs(board, [0]);

    const vOut = board.nodeVoltage('net_out');
    assert.ok(vOut > V_HIGH_THRESHOLD, `expected HIGH, got ${vOut.toFixed(3)}V`);
  });

  it('NOT(1) = 0', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeGateCircuit('gate_not', 1);
    board.setNetlist(parts, nets);
    driveInputs(board, [1]);

    const vOut = board.nodeVoltage('net_out');
    assert.ok(vOut < V_LOW_THRESHOLD, `expected LOW, got ${vOut.toFixed(3)}V`);
  });
});

// ─── NAND gate ──────────────────────────────────────────────────────────

describe('gate_nand: truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  const cases = [
    { inputs: [0, 0], expected: 1 },
    { inputs: [0, 1], expected: 1 },
    { inputs: [1, 0], expected: 1 },
    { inputs: [1, 1], expected: 0 },
  ];

  for (const { inputs, expected } of cases) {
    it(`NAND(${inputs}) = ${expected}`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeGateCircuit('gate_nand', 2);
      board.setNetlist(parts, nets);
      driveInputs(board, inputs);

      const vOut = board.nodeVoltage('net_out');
      if (expected) {
        assert.ok(vOut > V_HIGH_THRESHOLD, `expected HIGH, got ${vOut.toFixed(3)}V`);
      } else {
        assert.ok(vOut < V_LOW_THRESHOLD, `expected LOW, got ${vOut.toFixed(3)}V`);
      }
    });
  }
});

// ─── NOR gate ───────────────────────────────────────────────────────────

describe('gate_nor: truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  const cases = [
    { inputs: [0, 0], expected: 1 },
    { inputs: [0, 1], expected: 0 },
    { inputs: [1, 0], expected: 0 },
    { inputs: [1, 1], expected: 0 },
  ];

  for (const { inputs, expected } of cases) {
    it(`NOR(${inputs}) = ${expected}`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeGateCircuit('gate_nor', 2);
      board.setNetlist(parts, nets);
      driveInputs(board, inputs);

      const vOut = board.nodeVoltage('net_out');
      if (expected) {
        assert.ok(vOut > V_HIGH_THRESHOLD, `expected HIGH, got ${vOut.toFixed(3)}V`);
      } else {
        assert.ok(vOut < V_LOW_THRESHOLD, `expected LOW, got ${vOut.toFixed(3)}V`);
      }
    });
  }
});

// ─── XOR gate ───────────────────────────────────────────────────────────

describe('gate_xor: truth table', () => {
  beforeEach(setup);
  afterEach(teardown);

  const cases = [
    { inputs: [0, 0], expected: 0 },
    { inputs: [0, 1], expected: 1 },
    { inputs: [1, 0], expected: 1 },
    { inputs: [1, 1], expected: 0 },
  ];

  for (const { inputs, expected } of cases) {
    it(`XOR(${inputs}) = ${expected}`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeGateCircuit('gate_xor', 2);
      board.setNetlist(parts, nets);
      driveInputs(board, inputs);

      const vOut = board.nodeVoltage('net_out');
      if (expected) {
        assert.ok(vOut > V_HIGH_THRESHOLD, `expected HIGH, got ${vOut.toFixed(3)}V`);
      } else {
        assert.ok(vOut < V_LOW_THRESHOLD, `expected LOW, got ${vOut.toFixed(3)}V`);
      }
    });
  }
});

// ─── Gate chain settles ─────────────────────────────────────────────────

describe('gate chain: two inverters = buffer', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('NOT(NOT(1)) = 1', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'N1', kind: 'gate_not', params: { inputs: 1 }, terminals: ['in0', 'out'] },
      { id: 'N2', kind: 'gate_not', params: { inputs: 1 }, terminals: ['in0', 'out'] },
      { id: 'R_LOAD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R_LOAD', terminal: 'b' }] },
      { id: 'net_in', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'N1', terminal: 'in0' }] },
      { id: 'net_mid', terminals: [{ part: 'N1', terminal: 'out' }, { part: 'N2', terminal: 'in0' }] },
      { id: 'net_out', terminals: [{ part: 'N2', terminal: 'out' }, { part: 'R_LOAD', terminal: 'a' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    const vOut = board.nodeVoltage('net_out');
    assert.ok(vOut > V_HIGH_THRESHOLD, `double inversion should be HIGH, got ${vOut.toFixed(3)}V`);
  });
});
