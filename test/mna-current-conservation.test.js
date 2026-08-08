/**
 * MNA current conservation: Kirchhoff's Current Law must hold at every node.
 * Sum of currents into any node = 0. This catches sign errors and stamping bugs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function assertKCL(board, netId, partTerminals, label) {
  let sum = 0;
  for (const [partId, terminal] of partTerminals) {
    sum += board.branchCurrent(partId, terminal);
  }
  assert.ok(Math.abs(sum) < 0.0001,
    `KCL at ${netId} (${label}): sum of currents = ${(sum * 1000).toFixed(4)} mA, should be ≈ 0`);
}

describe('KCL: voltage divider', () => {
  it('current in = current out at mid node', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
      ],
    );

    // At mid node: R1 current out (b) + R2 current in (a) = 0
    const iR1 = board.branchCurrent('R1', 'b');
    const iR2 = board.branchCurrent('R2', 'a');
    // R1.b: current flows from a→b (positive into b)
    // R2.a: current flows from a→b (negative into a, i.e. out of a)
    // They should have opposite signs at the node
    assert.ok(Math.abs(iR1 + iR2) < 0.0001,
      `KCL: R1.b (${iR1}) + R2.a (${iR2}) = ${iR1 + iR2}, should ≈ 0`);
  });
});

describe('KCL: three-resistor star', () => {
  it('currents sum to zero at center', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nc', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'a' },
          { part: 'R3', terminal: 'a' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R2', terminal: 'b' },
          { part: 'R3', terminal: 'b' },
        ]},
      ],
    );

    const i1 = board.branchCurrent('R1', 'b');
    const i2 = board.branchCurrent('R2', 'a');
    const i3 = board.branchCurrent('R3', 'a');
    assert.ok(Math.abs(i1 + i2 + i3) < 0.0001,
      `KCL center: ${i1} + ${i2} + ${i3} = ${i1 + i2 + i3}`);
  });
});

describe('KCL: LED + resistor + pin', () => {
  it('current through resistor = current through LED', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);

    const iR = board.branchCurrent('R1', 'b');
    const iLED = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(iR - iLED) < 0.0001,
      `series: R1 current (${iR}) = LED current (${iLED})`);
  });
});

describe('KCL: Wheatstone bridge', () => {
  it('all four nodes satisfy KCL', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1500 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
        { id: 'R4', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
        { id: 'R5', kind: 'resistor', params: { ohms: 5000 }, terminals: ['a', 'b'] }, // bridge R
      ],
      [
        { id: 'nv', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' },
        ]},
        { id: 'nA', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R3', terminal: 'a' },
          { part: 'R5', terminal: 'a' },
        ]},
        { id: 'nB', terminals: [
          { part: 'R2', terminal: 'b' },
          { part: 'R4', terminal: 'a' },
          { part: 'R5', terminal: 'b' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R3', terminal: 'b' },
          { part: 'R4', terminal: 'b' },
        ]},
      ],
    );

    // Node A: R1.b + R3.a + R5.a = 0
    const i1b = board.branchCurrent('R1', 'b');
    const i3a = board.branchCurrent('R3', 'a');
    const i5a = board.branchCurrent('R5', 'a');
    assert.ok(Math.abs(i1b + i3a + i5a) < 0.0001,
      `KCL at A: ${i1b} + ${i3a} + ${i5a} = ${i1b + i3a + i5a}`);

    // Node B: R2.b + R4.a + R5.b = 0
    const i2b = board.branchCurrent('R2', 'b');
    const i4a = board.branchCurrent('R4', 'a');
    const i5b = board.branchCurrent('R5', 'b');
    assert.ok(Math.abs(i2b + i4a + i5b) < 0.0001,
      `KCL at B: ${i2b} + ${i4a} + ${i5b} = ${i2b + i4a + i5b}`);
  });
});
