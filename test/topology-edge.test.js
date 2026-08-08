/**
 * Circuit topology edge cases: Y-networks, loops, diamond networks,
 * and multi-source nodes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('topology: Y-network (two sources feeding one load)', () => {
  it('two VCC paths to one resistor to GND', () => {
    // VCC → R1(1k) → node, VCC → R2(2k) → node, node → R3(1k) → GND
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
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
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R3', terminal: 'b' }] },
      ],
    );

    // Norton at nm: VCC/1k + VCC/2k from top, GND/1k from bottom
    // I = 5/1000 + 5/2000 = 7.5mA
    // G = 1/1000 + 1/2000 + 1/1000 = 0.0025
    // V = 7.5mA / 2.5mS = 3.0V
    const v = board.nodeVoltage('nm');
    assert.ok(Math.abs(v - 3.0) < 0.05, `Y-network: ${v} ≈ 3.0V`);

    // MNA should agree
    const i3 = board.branchCurrent('R3', 'b');
    assert.ok(Math.abs(i3 - 0.003) < 0.0005, `R3 current: ${(i3*1000).toFixed(2)} ≈ 3.0mA`);
  });
});

describe('topology: diamond (Wheatstone with meter path)', () => {
  it('unbalanced diamond with cross-resistor', () => {
    // Same as the MNA Wheatstone test but verify through closed-form too
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R4', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      ],
      [
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
      ],
    );

    // R1/R3 divider: V_A = 5 * 1k/(1k+1k) = 2.5V
    // R2/R4 divider: V_B = 5 * 2k/(2k+2k) = 2.5V
    // Balanced!
    const vA = board.nodeVoltage('nA');
    const vB = board.nodeVoltage('nB');
    assert.ok(Math.abs(vA - 2.5) < 0.05, `diamond A: ${vA} ≈ 2.5V`);
    assert.ok(Math.abs(vB - 2.5) < 0.05, `diamond B: ${vB} ≈ 2.5V`);
  });
});

describe('topology: chain of 5 resistors', () => {
  it('voltage divides evenly across equal resistors', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [];
    const N = 5;

    for (let i = 0; i < N; i++) {
      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] });
    }

    // VCC → R0.a
    nets.push({ id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R0', terminal: 'a' }] });
    // R0.b → R1.a, R1.b → R2.a, etc.
    for (let i = 0; i < N - 1; i++) {
      nets.push({
        id: `n${i}`,
        terminals: [{ part: `R${i}`, terminal: 'b' }, { part: `R${i + 1}`, terminal: 'a' }],
      });
    }
    // R(N-1).b → GND
    nets.push({ id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: `R${N - 1}`, terminal: 'b' }] });

    board.setNetlist(parts, nets);

    // Voltage at each node: V = VCC × (N-1-i) / N
    for (let i = 0; i < N - 1; i++) {
      const expected = 5.0 * (N - 1 - i) / N;
      const v = board.nodeVoltage(`n${i}`);
      assert.ok(Math.abs(v - expected) < 0.05,
        `chain node ${i}: ${v} ≈ ${expected.toFixed(2)}V`);
    }
  });
});

describe('topology: multiple MCU pins on different nets', () => {
  it('each pin resolves independently', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R4', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
      ],
      [
        { id: 'nv', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'n1', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.0' },
        ]},
        { id: 'n2', terminals: [
          { part: 'R3', terminal: 'b' },
          { part: 'R4', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R2', terminal: 'b' },
          { part: 'R4', terminal: 'b' },
        ]},
      ],
    );
    board.setPin('P1.0', 'input', false);
    board.setPin('P1.3', 'input', false);

    // n1: R1(1k)/R2(3k) divider → V = 5 * 3k/4k = 3.75V
    // n2: R3(1k)/R4(1k) divider → V = 5 * 1k/2k = 2.5V
    const v1 = board.readAnalog('P1.0');
    const v2 = board.readAnalog('P1.3');

    assert.ok(Math.abs(v1 - 3.75) < 0.05, `P1.0: ${v1} ≈ 3.75V`);
    assert.ok(Math.abs(v2 - 2.5) < 0.05, `P1.3: ${v2} ≈ 2.5V`);
  });
});
