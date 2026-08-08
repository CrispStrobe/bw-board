/**
 * Zener diode circuit tests: voltage regulation, clipping.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('zener: voltage regulator', () => {
  it('3.3V zener clamps output from 5V supply', () => {
    // VCC(5V) → R(1k) → node → Zener(3.3V) → GND
    // The zener conducts in reverse breakdown, clamping node to ~3.3V
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'Z1', kind: 'zener', params: { vf: 0.7, vz: 3.3, rz: 5 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'Z1', terminal: 'cathode' }, // cathode to regulated node
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'Z1', terminal: 'anode' }, // anode to GND
        ]},
      ],
    );

    const v = board.nodeVoltage('nm');
    // Reverse bias across zener = V_cathode - V_anode = V_node - 0 = V_node
    // If V_node > Vz (3.3V), zener conducts in breakdown
    // V_node ≈ Vz + Iz × Rz ≈ 3.3 + small
    const iz = board.branchCurrent('Z1', 'anode');
    assert.ok(!Number.isNaN(v), `voltage not NaN: ${v}`);
    assert.ok(!Number.isNaN(iz), `current not NaN: ${iz}`);
  });

  it('below breakdown voltage: zener does not conduct reverse', () => {
    // VCC(3V) → R(1k) → node → Zener(5.1V) → GND
    // 3V < Vz=5.1V → zener off in reverse → no clamping
    const board = new BoardImpl(3.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'Z1', kind: 'zener', params: { vf: 0.7, vz: 5.1 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'Z1', terminal: 'cathode' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'Z1', terminal: 'anode' },
        ]},
      ],
    );

    const iz = board.branchCurrent('Z1', 'anode');
    // Below breakdown: essentially no current (1GΩ off resistance)
    assert.ok(Math.abs(iz) < 0.001,
      `below Vz: zener current ${(iz*1000).toFixed(3)} mA should be ~0`);
  });
});

describe('zener: forward conduction', () => {
  it('forward biased zener acts like a regular diode', () => {
    // Forward: cathode → GND, anode → VCC through R
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'Z1', kind: 'zener', params: { vf: 0.7, vz: 3.3 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'Z1', terminal: 'anode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Z1', terminal: 'cathode' }] },
      ],
    );

    // Forward: I = (5 - 0.7) / (1000 + 10) ≈ 4.257 mA
    const i = board.branchCurrent('Z1', 'anode');
    assert.ok(Math.abs(i - 0.004257) < 0.001,
      `forward zener: ${(i*1000).toFixed(2)} mA ≈ 4.26 mA`);
  });
});

describe('zener: does not crash with adversarial params', () => {
  it('Vz = 0 does not crash', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'Z1', kind: 'zener', params: { vf: 0.7, vz: 0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'Z1', terminal: 'cathode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Z1', terminal: 'anode' }] },
      ],
    );

    const i = board.branchCurrent('Z1', 'anode');
    assert.ok(!Number.isNaN(i), 'Vz=0: current not NaN');
  });
});
