/**
 * Solver agreement: verify that nodeVoltage (closed-form) and MNA
 * agree on the same circuits under various conditions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function assertClose(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b}`);
}

describe('solver agreement: pot loaded by divider', () => {
  it('pot wiper through voltage divider to pin', () => {
    // POT (50%) → R1(1k) → node → R2(1k) → GND, pin on node
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }, { part: 'R2', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT', 0.5);

    // A LOADED wiper is NOT an ideal 2.5 V source: it is 2.5 V behind
    // 5k‖5k = 2.5 kΩ. V_node = 2.5·R2/(Rth + R1 + R2) = 2.5·1000/4500
    // = 0.5556 V, and the wiper itself sags to 1.1111 V.
    // (This test used to EXPECT the stitched walker answer 1.25 V — the
    // wiper-as-ideal-source artifact that violated KCL at the wiper by
    // the whole load current; re-derived 2026-08-23 when loaded wipers
    // were routed to MNA.)
    const vCF = board.nodeVoltage('nm');
    assertClose(vCF, 2.5 * 1000 / 4500, 0.005, 'loaded divider node');
    const vW = board.nodeVoltage('nw');
    assertClose(vW, 2.5 * 2000 / 4500, 0.005, 'wiper behind its Thevenin');
    // KCL closes at the wiper: pot halves vs R1.
    const residual = (5 - vW) / 5000 - vW / 5000 - (vW - vCF) / 1000;
    assert.ok(Math.abs(residual) < 1e-6, `KCL residual ${residual}`);

    const i = board.branchCurrent('R1', 'b');
    assert.ok(!Number.isNaN(i), 'MNA current not NaN');
  });
});

describe('solver agreement: multiple voltage sources through resistors', () => {
  it('two resistors from VCC, one from GND', () => {
    // VCC → R1(1k) → node, VCC → R2(2k) → node, GND → R3(3k) → node
    // Norton: I = 5/1k + 5/2k = 7.5mA toward node
    // G = 1/1k + 1/2k + 1/3k = 0.001 + 0.0005 + 0.000333 = 0.001833
    // V = 7.5mA / 1.833mS = 4.091V
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      { id: 'R3', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'R1', terminal: 'a' },
        { part: 'R2', terminal: 'a' },
      ]},
      { id: 'nm', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'b' },
        { part: 'R3', terminal: 'a' },
      ]},
      { id: 'ng', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'R3', terminal: 'b' },
      ]},
    ];
    board.setNetlist(parts, nets);

    const vCF = board.nodeVoltage('nm');
    assertClose(vCF, 4.091, 0.02, 'closed-form');

    const iR1 = board.branchCurrent('R1', 'b');
    const iR3 = board.branchCurrent('R3', 'b');
    // I_R1 = (5 - 4.091) / 1000 = 0.909 mA
    assertClose(iR1, 0.000909, 0.0001, 'R1 current');
    // I_R3 = 4.091 / 3000 = 1.364 mA
    assertClose(iR3, 0.001364, 0.0001, 'R3 current');
  });
});

describe('solver agreement: LED brightness integration check', () => {
  it('steady-state brightness equals current/I_rated', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 470 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 1.8 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(25_000_000n);

    const brightness = board.ledBrightness('LED1');
    const mnaCurrent = board.branchCurrent('LED1', 'anode');

    // I = (5 - 1.8) / (470 + 10 + 25) = 3.2/505 = 6.337 mA
    assertClose(mnaCurrent, 0.006337, 0.0005, 'MNA current');
    assertClose(brightness, mnaCurrent / 0.020, 0.02, 'brightness = I/I_rated');
  });
});

describe('solver: capacitor voltage after power cycle', () => {
  it('cap retains charge across power off/on', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.001 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // Charge for 5 RC = 5s
    board.advanceTo(5_000_000_000n);
    const vBefore = board.capVoltages.get('C1');
    assert.ok(vBefore > 4.9, `charged: ${vBefore}`);

    // Power off
    board.setPower(false);
    // Cap voltage should be preserved
    const vOff = board.capVoltages.get('C1');
    assert.ok(vOff > 4.9, `cap holds charge when power off: ${vOff}`);

    // Power on — cap starts from charged state
    board.setPower(true);
    board.advanceTo(5_001_000_000n);
    const vAfter = board.nodeVoltage('nrc');
    assert.ok(vAfter > 4.9, `cap still charged after power restore: ${vAfter}`);
  });
});
