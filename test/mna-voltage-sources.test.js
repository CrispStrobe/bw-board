/**
 * MNA voltage source tests: VCC as ideal source, multiple parts
 * drawing from VCC, and voltage source current.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('MNA: VCC as ideal voltage source', () => {
  it('VCC voltage is exactly VCC regardless of load', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] }, // heavy load
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );

    // VCC should still be 5V even with 10Ω load (500mA)
    assert.equal(board.nodeVoltage('nv'), 5.0);

    // MNA should compute 500mA
    const i = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(i - 0.5) < 0.01, `current ${i} ≈ 500mA`);
  });

  it('VCC current is sum of all branch currents', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 5000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'b' },
        ]},
      ],
    );

    const i1 = board.branchCurrent('R1', 'b');
    const i2 = board.branchCurrent('R2', 'b');
    const i3 = board.branchCurrent('R3', 'b');

    // I_total = 5/1000 + 5/2000 + 5/5000 = 5 + 2.5 + 1 = 8.5 mA
    const total = i1 + i2 + i3;
    assert.ok(Math.abs(total - 0.0085) < 0.0005,
      `total current ${total * 1000} mA ≈ 8.5 mA`);
  });
});

describe('MNA: resistor networks', () => {
  it('star-to-delta equivalence', () => {
    // Star: three 1kΩ resistors from center to A, B, C
    // Delta equivalent: each leg = 3kΩ
    // Measure resistance A-B: star gives 2kΩ (two 1k in series),
    // delta gives 3k ∥ (3k+3k) = 3k ∥ 6k = 2kΩ. Same!

    const boardStar = new BoardImpl(5.0);
    boardStar.setNetlist(
      [
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nA', terminals: [{ part: 'R1', terminal: 'a' }] },
        { id: 'nB', terminals: [{ part: 'R2', terminal: 'a' }] },
        { id: 'nC', terminals: [{ part: 'R3', terminal: 'a' }] },
        { id: 'nc', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'b' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    boardStar.setPower(false);
    const rStar = boardStar.resistance('nA', 'nB');

    const boardDelta = new BoardImpl(5.0);
    boardDelta.setNetlist(
      [
        { id: 'Rab', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'Rbc', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'Rac', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nA', terminals: [{ part: 'Rab', terminal: 'a' }, { part: 'Rac', terminal: 'a' }] },
        { id: 'nB', terminals: [{ part: 'Rab', terminal: 'b' }, { part: 'Rbc', terminal: 'a' }] },
        { id: 'nC', terminals: [{ part: 'Rac', terminal: 'b' }, { part: 'Rbc', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    boardDelta.setPower(false);
    const rDelta = boardDelta.resistance('nA', 'nB');

    assert.ok(typeof rStar === 'number' && typeof rDelta === 'number');
    assert.ok(Math.abs(/** @type {number} */(rStar) - /** @type {number} */(rDelta)) < 10,
      `star R=${rStar} ≈ delta R=${rDelta} ≈ 2000Ω`);
    assert.ok(Math.abs(/** @type {number} */(rStar) - 2000) < 10);
  });
});

describe('MNA: power dissipation', () => {
  it('P = V × I for a resistor', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );

    const i = board.branchCurrent('R1', 'b');
    const vA = board.nodeVoltage('nv');
    const vB = board.nodeVoltage('ng');
    const vDrop = vA - vB;
    const power = vDrop * i;

    // P = V²/R = 25/1000 = 25 mW
    assert.ok(Math.abs(power - 0.025) < 0.001,
      `power ${power * 1000} mW ≈ 25 mW`);

    // P = I²R = (0.005)² × 1000 = 25 mW
    assert.ok(Math.abs(i * i * 1000 - 0.025) < 0.001);
  });
});
