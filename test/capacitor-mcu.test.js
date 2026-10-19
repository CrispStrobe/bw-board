/**
 * Capacitor + MCU pin tests: pin mode affects RC time constant,
 * capacitor voltage affects readPin threshold, ADC reads cap voltage.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeRCWithPin() {
  return {
    parts: [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ],
    nets: [
      { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ],
  };
}

describe('RC + pin: pushpull charges, then releases', () => {
  it('charge with pushpull high, then switch to input and watch decay stop', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeRCWithPin();
    board.setNetlist(parts, nets);

    // Charge: pushpull high, RC = (25+10000)*0.0001 ≈ 1s
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(5_000_000_000n); // 5 RC = charged
    const vCharged = board.nodeVoltage('nrc');
    assert.ok(vCharged > 4.5, `charged: ${vCharged}`);

    // Switch to input mode (high-Z): cap holds charge, no discharge path
    // (R1 has nothing on the other side since input is high-Z)
    board.setPin('P1.0', 'input', false);
    board.advanceTo(10_000_000_000n); // wait 5 more seconds
    const vHeld = board.nodeVoltage('nrc');
    // Cap voltage should barely change (only leakage through 1GΩ off-resistance)
    assert.ok(vHeld > 4.0, `cap should hold charge in input mode: ${vHeld}`);
  });
});

describe('RC + pin: readPin tracks cap voltage', () => {
  it('rising cap voltage crosses digital threshold', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'C1', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // RC = 10000 * 0.0001 = 1s
    // At t=0, V=0 → readPin = 0
    assert.equal(board.readPin('P1.3'), 0, 't=0: below threshold');

    // At t ≈ 0.35 RC (0.35s), V ≈ 5*(1-e^-0.35) ≈ 1.48V → still 0
    board.advanceTo(350_000_000n);
    assert.equal(board.readPin('P1.3'), 0, 't=0.35RC: below 1.5V threshold');

    // At t ≈ 0.40 RC (0.40s), V ≈ 5*(1-e^-0.40) ≈ 1.65V → crosses to 1
    board.advanceTo(400_000_000n);
    assert.equal(board.readPin('P1.3'), 1, 't=0.40RC: above 1.5V threshold');

    // At t = 5 RC, V ≈ 5V → definitely 1
    board.advanceTo(5_000_000_000n);
    assert.equal(board.readPin('P1.3'), 1, 't=5RC: fully charged');
  });
});

describe('RC + pin: readAnalog tracks cap voltage', () => {
  it('cap voltage is readable as analog value', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'C1', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // At t=1RC, V ≈ 3.16V
    board.advanceTo(1_000_000_000n);
    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 3.16) < 0.2, `1RC: readAnalog ${v} ≈ 3.16V`);

    // At t=3RC, V ≈ 4.75V
    board.advanceTo(3_000_000_000n);
    const v3 = board.readAnalog('P1.3');
    assert.ok(v3 > 4.5, `3RC: readAnalog ${v3} > 4.5V`);
  });
});
