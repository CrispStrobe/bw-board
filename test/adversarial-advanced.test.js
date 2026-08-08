/**
 * More adversarial tests: circuits a beginner will wire, and solver
 * robustness under pathological inputs.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function assertSafe(board, label) {
  for (const net of board.nets) {
    const v = board.nodeVoltage(net.id);
    assert.ok(!Number.isNaN(v), `${label}: NaN at ${net.id}`);
    assert.ok(Number.isFinite(v), `${label}: Inf at ${net.id}`);
  }
  for (const part of board.parts) {
    if (part.kind === 'led') {
      const b = board.ledBrightness(part.id);
      assert.ok(b >= 0 && b <= 1 && !Number.isNaN(b), `${label}: bad brightness for ${part.id}`);
    }
  }
}

describe('beginner mistakes', () => {
  it('LED without resistor (direct VCC → LED → GND)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED1', terminal: 'cathode' }] },
      ],
    );
    assertSafe(board, 'LED no resistor');

    // Should still compute current — just very high
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(!Number.isNaN(i), 'current not NaN');
    // I = (5-2)/10 = 300mA — way above rated, but calculable
    assert.ok(i > 0.1, `current ${i} should be large (no limiting resistor)`);
  });

  it('two LEDs in parallel (mismatched Vf)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: 'LED_R', kind: 'led', params: { vf: 1.8 }, terminals: ['anode', 'cathode'] },
        { id: 'LED_B', kind: 'led', params: { vf: 3.2 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'LED_R', terminal: 'anode' },
          { part: 'LED_B', terminal: 'anode' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'LED_R', terminal: 'cathode' },
          { part: 'LED_B', terminal: 'cathode' },
        ]},
      ],
    );
    assertSafe(board, 'parallel LEDs');

    // The red LED (lower Vf) should hog most of the current
    const iR = board.branchCurrent('LED_R', 'anode');
    const iB = board.branchCurrent('LED_B', 'anode');
    assert.ok(!Number.isNaN(iR) && !Number.isNaN(iB));
  });

  it('button with no pull-up or pull-down (floating input)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.2'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'np', terminals: [{ part: 'BTN', terminal: 'a' }, { part: 'MCU', terminal: 'P3.2' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BTN', terminal: 'b' }] },
      ],
    );
    board.setPin('P3.2', 'input', false);

    // Floating pin with button open → no defined voltage
    board.setControl('BTN', 0);
    const v = board.readAnalog('P3.2');
    assert.ok(!Number.isNaN(v), 'floating pin should not be NaN');

    // Button pressed → connected to GND
    board.setControl('BTN', 1);
    assert.equal(board.readPin('P3.2'), 0, 'pressed → GND');
  });

  it('resistor connected to nothing on one side', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nf', terminals: [{ part: 'R1', terminal: 'b' }] }, // floating
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assertSafe(board, 'dangling resistor');
    // Floating end should be at VCC (no current path → no drop)
    const v = board.nodeVoltage('nf');
    assert.ok(!Number.isNaN(v));
  });

  it('pot wired backward (a→GND, b→VCC)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        // Backward: a→GND, b→VCC
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'a' }] },
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);
    board.setControl('POT', 0.5);

    // Backward pot: position 0.5 → V = GND + (VCC - GND) * 0.5 = 2.5V
    // The formula is vB + (vA - vB) * pos = 5 + (0 - 5) * 0.5 = 2.5
    const v = board.readAnalog('P1.3');
    assert.ok(!Number.isNaN(v), `backward pot: ${v}`);
    assert.ok(Math.abs(v - 2.5) < 0.1, `backward pot midpoint: ${v} ≈ 2.5V`);
  });
});

describe('pathological inputs', () => {
  it('NaN resistance is rejected by setNetlist', () => {
    const board = new BoardImpl(5.0);
    assert.throws(() => {
      board.setNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'R1', kind: 'resistor', params: { ohms: NaN }, terminals: ['a', 'b'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
          { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
        ],
      );
    }, /Invalid netlist/, 'NaN ohms should be rejected');
  });

  it('Infinity resistance does not crash', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: Infinity }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    const v = board.nodeVoltage('n2');
    assert.ok(typeof v === 'number');
  });

  it('missing params defaults gracefully', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: {}, terminals: ['a', 'b'] }, // no ohms
        { id: 'LED1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] }, // no vf
        { id: 'C1', kind: 'capacitor', params: {}, terminals: ['a', 'b'] }, // no farads
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'n3', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    assertSafe(board, 'missing params');
    board.advanceTo(1_000_000n);
    assertSafe(board, 'missing params after advance');
  });

  it('extremely large netlist does not stack overflow', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [];
    const vccNet = { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] };

    // 100 resistors in a chain
    for (let i = 0; i < 100; i++) {
      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] });
      if (i === 0) {
        vccNet.terminals.push({ part: 'R0', terminal: 'a' });
      } else {
        nets.push({
          id: `n${i}`,
          terminals: [{ part: `R${i - 1}`, terminal: 'b' }, { part: `R${i}`, terminal: 'a' }],
        });
      }
    }
    nets.push(vccNet);
    nets.push({
      id: 'ng',
      terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R99', terminal: 'b' }],
    });

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Should not crash or overflow
    const v = board.nodeVoltage('n50');
    assert.ok(!Number.isNaN(v), `100-resistor chain: node 50 voltage = ${v}`);
  });
});
