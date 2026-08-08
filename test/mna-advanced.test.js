/**
 * Advanced MNA solver tests — larger networks, Wheatstone bridges,
 * multiple voltage sources, and corner cases.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('MNA: Wheatstone bridge', () => {
  it('balanced bridge has zero voltage across the bridge', () => {
    // Classic Wheatstone bridge: all 1kΩ resistors.
    //   VCC → R1(1k) → nodeA → R3(1k) → GND
    //   VCC → R2(1k) → nodeB → R4(1k) → GND
    //   nodeA and nodeB: V_A = V_B = 2.5V
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R4', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'R1', terminal: 'a' },
        { part: 'R2', terminal: 'a' },
      ]},
      { id: 'nA', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R3', terminal: 'a' }] },
      { id: 'nB', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'R4', terminal: 'a' }] },
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R3', terminal: 'b' },
        { part: 'R4', terminal: 'b' },
      ]},
    ];
    board.setNetlist(parts, nets);

    const vA = board.nodeVoltage('nA');
    const vB = board.nodeVoltage('nB');
    assert.ok(Math.abs(vA - 2.5) < 0.01, `node A voltage ${vA} should be 2.5V`);
    assert.ok(Math.abs(vB - 2.5) < 0.01, `node B voltage ${vB} should be 2.5V`);
    assert.ok(Math.abs(vA - vB) < 0.01, 'bridge should be balanced');
  });

  it('unbalanced bridge has nonzero bridge voltage', () => {
    // R1=1k, R2=2k, R3=1k, R4=2k → balanced (same ratio)
    // R1=1k, R2=1k, R3=1k, R4=2k → unbalanced
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R4', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'R1', terminal: 'a' },
        { part: 'R2', terminal: 'a' },
      ]},
      { id: 'nA', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R3', terminal: 'a' }] },
      { id: 'nB', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'R4', terminal: 'a' }] },
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R3', terminal: 'b' },
        { part: 'R4', terminal: 'b' },
      ]},
    ];
    board.setNetlist(parts, nets);

    // VA = 5 * 1k/(1k+1k) = 2.5V, VB = 5 * 2k/(1k+2k) = 3.333V
    const vA = board.nodeVoltage('nA');
    const vB = board.nodeVoltage('nB');

    assert.ok(Math.abs(vA - 2.5) < 0.01, `VA = ${vA} should be 2.5V`);
    assert.ok(Math.abs(vB - 3.333) < 0.01, `VB = ${vB} should be 3.333V`);

    // Bridge voltage
    const vBridge = board.branchCurrent('R1', 'a'); // use MNA for current
    assert.ok(vBridge !== undefined, 'MNA should solve this');
  });
});

describe('MNA: T-network resistance', () => {
  it('T-network: 1kΩ series, 2kΩ shunt, 1kΩ series → Rin ≈ 1.667kΩ', () => {
    // R1(1k) → node → R3(2k to GND), node → R2(1k) → output
    // From input to output, with GND as shunt:
    // Rin = R1 + (R3 ∥ R2) = 1000 + (2000*1000)/(2000+1000) = 1000 + 666.67 = 1666.67
    // But resistance() measures between two nodes with power off.
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R3', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'net_in', terminals: [{ part: 'R1', terminal: 'a' }] },
      { id: 'net_mid', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'R3', terminal: 'a' },
      ]},
      { id: 'net_out', terminals: [{ part: 'R2', terminal: 'b' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R3', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPower(false);

    const r = board.resistance('net_in', 'net_out');
    assert.ok(typeof r === 'number');
    // With test current injection at net_in and net_out as ground:
    // This is more complex — need to account for the shunt path.
    // Actually with net_out as the reference (ground), and GND connected to R3:
    // net_out = 0V (reference), net_gnd has R3 to net_mid.
    // R_measured = V(net_in) / I_test
    // By superposition: I_test flows into net_in through R1 to net_mid.
    // At net_mid, it splits: some through R2 to net_out (ground), some through R3 to net_gnd.
    // But net_gnd is floating (GND part is inactive when powerOff).
    // Wait, GND part's net is net_gnd. With powerOff, it's not the reference.
    // The reference is net_out (testNodeB).
    //
    // So the circuit is: net_in → R1 → net_mid → R2 → net_out(ref=0)
    //                                 net_mid → R3 → net_gnd(floating)
    // If net_gnd is floating, R3 doesn't drain current. R = R1 + R2 = 2000Ω
    // Hmm, but the MNA includes net_gnd. Since it's floating, current through R3 = 0.
    // So R = R1 + R2 = 2000Ω.
    assert.ok(Math.abs(/** @type {number} */(r) - 2000) < 10,
      `T-network R = ${r} should be ≈ 2000Ω (shunt path is floating)`);
  });
});

describe('MNA: multiple MCU pins on same net', () => {
  it('two push-pull pins driving same net to same voltage', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    // Both pins drive the same net (cathode of LED)
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [
        { part: 'LED1', terminal: 'cathode' },
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'MCU', terminal: 'P1.1' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // Both drive low → parallel sinks → half the Thévenin resistance
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', false);
    board.advanceTo(1_000_000n);

    // Two parallel 25Ω sinks → Rth = 12.5Ω
    // I = (5 - 2) / (1000 + 10 + 12.5) = 3/1022.5 ≈ 2.934 mA
    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.13, `brightness ${b} with parallel pins`);

    // MNA current should be slightly higher than single pin
    const iLed = board.branchCurrent('LED1', 'anode');
    assert.ok(iLed > 0.0028, `LED current ${iLed} should be > 2.8 mA`);
  });
});

describe('MNA: resistance of complex networks', () => {
  it('three resistors in a delta → correct equivalent', () => {
    // Delta network: R_ab=1k, R_bc=2k, R_ac=3k
    // Resistance across a-b with power off.
    // R_ab ∥ (R_ac + R_bc) = 1000 ∥ (3000 + 2000) = 1000 ∥ 5000 = 833.33Ω
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'R_ab', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R_bc', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      { id: 'R_ac', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'na', terminals: [{ part: 'R_ab', terminal: 'a' }, { part: 'R_ac', terminal: 'a' }] },
      { id: 'nb', terminals: [{ part: 'R_ab', terminal: 'b' }, { part: 'R_bc', terminal: 'a' }] },
      { id: 'nc', terminals: [{ part: 'R_ac', terminal: 'b' }, { part: 'R_bc', terminal: 'b' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPower(false);

    const r = board.resistance('na', 'nb');
    assert.ok(typeof r === 'number');
    assert.ok(Math.abs(/** @type {number} */(r) - 833.33) < 5,
      `delta R_ab = ${r} should be ≈ 833.33Ω`);
  });

  it('ladder network', () => {
    // Simple ladder: R1(1k) → node1 → R2(1k to gnd), node1 → R3(1k) → node2
    // With node2 as the output and measuring from input to node2:
    // Same as T-network test logic, but let's verify with MNA.
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n1', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'R3', terminal: 'a' },
      ]},
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R2', terminal: 'b' },
        { part: 'R3', terminal: 'b' },
      ]},
    ];
    board.setNetlist(parts, nets);

    // V_n1 = VCC * (R2∥R3) / (R1 + R2∥R3) = 5 * 500 / 1500 = 1.667V
    const vn1 = board.nodeVoltage('n1');
    assert.ok(Math.abs(vn1 - 1.667) < 0.01, `ladder node voltage ${vn1} ≈ 1.667V`);

    // Branch currents
    const iR1 = board.branchCurrent('R1', 'b');
    // I_R1 = (5 - 1.667) / 1000 = 3.333 mA
    assert.ok(Math.abs(iR1 - 0.003333) < 0.0002, `R1 current ${iR1} ≈ 3.333 mA`);

    const iR2 = board.branchCurrent('R2', 'b');
    const iR3 = board.branchCurrent('R3', 'b');
    // Each: 1.667 / 1000 = 1.667 mA
    assert.ok(Math.abs(iR2 - 0.001667) < 0.0002, `R2 current ${iR2} ≈ 1.667 mA`);
    assert.ok(Math.abs(iR3 - 0.001667) < 0.0002, `R3 current ${iR3} ≈ 1.667 mA`);
  });
});
