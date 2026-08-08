/**
 * Test: MNA solver — branchCurrent and resistance.
 *
 * These tests verify the MNA solver against hand-computed values for
 * small networks, then check agreement with the closed-form path on
 * cases both can handle.
 *
 * Hand computations:
 *
 * 1. Simple resistor divider: VCC (5V) → 1kΩ → node → 2kΩ → GND
 *    V_node = 5 * 2000 / (1000 + 2000) = 3.333 V
 *    I = 5 / 3000 = 1.667 mA
 *    Current through R1 into terminal b = 1.667 mA
 *    Current through R2 into terminal a = 1.667 mA
 *
 * 2. Parallel resistors: VCC → (1kΩ ∥ 2kΩ) → GND
 *    R_eq = 1/(1/1000 + 1/2000) = 666.67 Ω
 *    I_total = 5 / 666.67 = 7.5 mA
 *    I_R1 = 5 / 1000 = 5 mA
 *    I_R2 = 5 / 2000 = 2.5 mA
 *
 * 3. Resistance measurement (power off): 1kΩ in series with 2kΩ = 3kΩ
 *
 * 4. LED circuit: VCC → 1kΩ → LED (Vf=2V, Rd=10Ω) → GND
 *    I = (5 - 2) / (1000 + 10) = 2.970 mA
 *    This should agree with the closed-form solver.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeVoltageDivider() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
  ];
  return { parts, nets };
}

function makeParallelResistors() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [
      { part: 'VCC', terminal: 'vcc' },
      { part: 'R1', terminal: 'a' },
      { part: 'R2', terminal: 'a' },
    ]},
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' },
      { part: 'R1', terminal: 'b' },
      { part: 'R2', terminal: 'b' },
    ]},
  ];
  return { parts, nets };
}

function makeLedCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED1', terminal: 'cathode' }] },
  ];
  return { parts, nets };
}

function makeSeriesResistors() {
  const parts = [
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'net_a', terminals: [{ part: 'R1', terminal: 'a' }] },
    { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
    { id: 'net_b', terminals: [{ part: 'R2', terminal: 'b' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
  ];
  return { parts, nets };
}

describe('MNA: branchCurrent', () => {
  it('voltage divider: I = 5/3000 ≈ 1.667 mA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeVoltageDivider();
    board.setNetlist(parts, nets);

    // Current through R1 terminal b (flowing from VCC toward GND)
    const iR1 = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(iR1 - 0.001667) < 0.0001,
      `R1 current ${iR1} should be ≈ 1.667 mA`);

    // Current through R2 terminal a (same current, flowing into R2)
    const iR2 = board.branchCurrent('R2', 'a');
    // R2 terminal a receives current from the divider node
    assert.ok(Math.abs(Math.abs(iR2) - 0.001667) < 0.0001,
      `R2 current ${iR2} should be ≈ 1.667 mA`);
  });

  it('parallel resistors: I_R1 = 5 mA, I_R2 = 2.5 mA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeParallelResistors();
    board.setNetlist(parts, nets);

    const iR1 = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(iR1 - 0.005) < 0.0002,
      `R1 current ${iR1} should be ≈ 5 mA`);

    const iR2 = board.branchCurrent('R2', 'b');
    assert.ok(Math.abs(iR2 - 0.0025) < 0.0002,
      `R2 current ${iR2} should be ≈ 2.5 mA`);
  });

  it('LED circuit: I = (5-2)/1010 ≈ 2.970 mA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLedCircuit();
    board.setNetlist(parts, nets);

    const iLed = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(iLed - 0.00297) < 0.0003,
      `LED current ${iLed} should be ≈ 2.970 mA`);

    // Should agree with closed-form (within tolerance due to different methods)
    const iR1 = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(iR1 - 0.00297) < 0.0003,
      `R1 current ${iR1} should match LED current`);
  });

  it('LED + MCU pin (active-low): matches closed-form', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'net_led_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // Push-pull driving 0
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);

    // MNA current through LED
    const iLed = board.branchCurrent('LED1', 'anode');
    // Closed-form brightness
    const brightness = board.ledBrightness('LED1');

    // Both should agree on ~2.9 mA
    // I = (5 - 2) / (1000 + 10 + 25) = 3/1035 ≈ 2.899 mA
    assert.ok(Math.abs(iLed - 0.002899) < 0.0005,
      `MNA LED current ${iLed} should be ≈ 2.899 mA`);
    assert.ok(brightness > 0.13,
      `Closed-form brightness ${brightness} should be > 0.13`);
  });
});

describe('MNA: resistance (power off)', () => {
  it('series 1kΩ + 2kΩ = 3kΩ', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSeriesResistors();
    board.setNetlist(parts, nets);
    board.setPower(false);

    const r = board.resistance('net_a', 'net_b');
    assert.ok(typeof r === 'number', 'should return a number when powered off');
    assert.ok(Math.abs(/** @type {number} */(r) - 3000) < 10,
      `resistance ${r} should be ≈ 3000 Ω`);
  });

  it('parallel 1kΩ ∥ 2kΩ = 666.67 Ω', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'net_top', terminals: [{ part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }] },
      { id: 'net_bot', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'b' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPower(false);

    const r = board.resistance('net_top', 'net_bot');
    assert.ok(typeof r === 'number', 'should return a number when powered off');
    assert.ok(Math.abs(/** @type {number} */(r) - 666.67) < 5,
      `resistance ${r} should be ≈ 666.67 Ω`);
  });

  it('single 1kΩ resistor', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'net_a', terminals: [{ part: 'R1', terminal: 'a' }] },
      { id: 'net_b', terminals: [{ part: 'R1', terminal: 'b' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPower(false);

    const r = board.resistance('net_a', 'net_b');
    assert.ok(typeof r === 'number');
    assert.ok(Math.abs(/** @type {number} */(r) - 1000) < 5,
      `resistance ${r} should be ≈ 1000 Ω`);
  });

  it('still returns requires-power-off when powered', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeVoltageDivider();
    board.setNetlist(parts, nets);
    // Board is powered by default
    assert.equal(board.resistance('net_vcc', 'net_gnd'), 'requires-power-off');
  });
});
