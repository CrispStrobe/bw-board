/**
 * Advanced RC capacitor tests: MCU pin as source, multiple time constants,
 * RC with button switching, and capacitor holding voltage after disconnect.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('RC: MCU pin as charge source', () => {
  it('pushpull high charges cap through resistor', () => {
    // MCU pin (pushpull high, Rth=25Ω) → R(1kΩ) → C(100µF) → GND
    // Total R = 25 + 1000 = 1025Ω, RC = 1025 * 0.0001 = 0.1025s
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    // After 5 RC ≈ 0.5125s, cap should be near VCC
    board.advanceTo(512_500_000n);
    const v = board.nodeVoltage('nrc');
    assert.ok(v > 4.9, `cap should be charged: ${v}`);
  });

  it('quasi-bidir high charges slowly (Rth=21.7kΩ)', () => {
    // RC = (21700 + 1000) * 0.0001 = 2.27s
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);

    // After 1 RC ≈ 2.27s, cap at ~63%
    board.advanceTo(2_270_000_000n);
    const v = board.nodeVoltage('nrc');
    assert.ok(v > 2.5, `cap at 1RC quasi: ${v} should be > 2.5V`);
    assert.ok(v < 4.0, `cap at 1RC quasi: ${v} should be < 4.0V`);
  });
});

describe('RC: charge then discharge cycle', () => {
  it('charge through pin high, discharge through pin low', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // Charge: pin high, RC = (25+10000)*0.0001 ≈ 1s
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(5_000_000_000n); // 5RC — fully charged
    const vCharged = board.nodeVoltage('nrc');
    assert.ok(vCharged > 4.9, `charged: ${vCharged}`);

    // Discharge: pin low, same RC
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(10_000_000_000n); // another 5RC
    const vDischarged = board.nodeVoltage('nrc');
    assert.ok(vDischarged < 0.1, `discharged: ${vDischarged}`);
  });
});

describe('RC: different time constants', () => {
  const testCases = [
    { r: 100, c: 0.001, label: '100Ω × 1mF = 0.1s' },      // RC = 0.1s
    { r: 1000000, c: 0.000001, label: '1MΩ × 1µF = 1s' },   // RC = 1s
    { r: 100, c: 0.000001, label: '100Ω × 1µF = 100µs' },   // RC = 100µs
  ];

  for (const tc of testCases) {
    it(`${tc.label}: 63% at 1RC`, () => {
      const board = new BoardImpl(5.0);
      const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: tc.r }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: tc.c }, terminals: ['a', 'b'] },
      ];
      const nets = [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ];
      board.setNetlist(parts, nets);

      const rcNs = BigInt(Math.round(tc.r * tc.c * 1e9));
      board.advanceTo(rcNs);

      const v = board.nodeVoltage('nrc');
      // At 1RC: V = VCC * (1 - e^-1) = 5 * 0.6321 = 3.161V
      assert.ok(Math.abs(v - 3.161) < 0.2,
        `${tc.label} at 1RC: ${v} should be ~3.161V`);
    });
  }
});
