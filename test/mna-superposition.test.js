/**
 * MNA superposition: verify the solver handles multiple independent
 * sources correctly. Superposition says V_total = sum of individual
 * contributions. We verify by computing each source's contribution
 * separately and comparing to the combined result.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('superposition: two sources through different resistors', () => {
  it('VCC through R1 and MCU pin through R2 to same node', () => {
    // VCC(5V) → R1(1kΩ) → node ← R2(2kΩ) ← MCU pushpull high(5V)
    //                       ↓
    //                    R3(3kΩ) → GND
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R2', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R3', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', true); // 5V through 25Ω + 2kΩ

    // Norton at node nm:
    // Source 1 (VCC through R1): I = 5/1000 = 5mA, G = 1/1000
    // Source 2 (pin through R2): pin Thev = {5V, 25Ω}, so through 2025Ω total
    //   I = 5/2025 = 2.469mA, G = 1/2025
    // Source 3 (GND through R3): I = 0, G = 1/3000
    // V = (5/1000 + 5/2025) / (1/1000 + 1/2025 + 1/3000)
    //   = (0.005 + 0.002469) / (0.001 + 0.000494 + 0.000333)
    //   = 0.007469 / 0.001827 = 4.089V
    const vCF = board.nodeVoltage('nm');
    const vMNA = 5.0 - board.branchCurrent('R1', 'b') * 1000; // V = VCC - I*R1

    assert.ok(Math.abs(vCF - 4.089) < 0.05, `CF: ${vCF} ≈ 4.089V`);
    assert.ok(Math.abs(vMNA - 4.089) < 0.05, `MNA: ${vMNA} ≈ 4.089V`);
  });

  it('VCC and MCU pin driving in opposite directions', () => {
    // VCC(5V) → R1(1kΩ) → node ← R2(1kΩ) ← MCU pushpull LOW(0V)
    //                       ↓
    //                    R3(1kΩ) → GND
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R2', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R3', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false); // 0V through 25Ω + 1kΩ

    // Norton: VCC/1k + 0/1025, GND/1k
    // I = 5/1000 = 5mA, G = 1/1000 + 1/1025 + 1/1000 = 0.002976
    // V = 0.005 / 0.002976 = 1.680V
    const v = board.nodeVoltage('nm');
    assert.ok(Math.abs(v - 1.68) < 0.05, `opposing sources: ${v} ≈ 1.68V`);
  });
});

describe('superposition: three MCU pins', () => {
  it('three pins at different modes converge to one voltage', () => {
    // Three pins on the same net through different resistors
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'b' },
        ]},
        { id: 'n0', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n1', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'R2', terminal: 'a' }] },
        { id: 'n2', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'R3', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    // P1.0 pushpull high, P1.1 pushpull low, P1.2 input (high-Z)
    board.setPin('P1.0', 'pushpull', true);  // 5V / 1025Ω
    board.setPin('P1.1', 'pushpull', false); // 0V / 1025Ω
    board.setPin('P1.2', 'input', false);    // disconnected

    // Two sources: 5V/1025 and 0V/1025. Norton: I=5/1025, G=2/1025
    // V = (5/1025) / (2/1025) = 5/2 = 2.5V
    const v = board.nodeVoltage('nm');
    assert.ok(Math.abs(v - 2.5) < 0.05, `three pins: ${v} ≈ 2.5V`);
  });
});
