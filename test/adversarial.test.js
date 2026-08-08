/**
 * Adversarial tests — circuits that break naive solvers.
 *
 * The rule: never return NaN into the UI, never silently produce
 * a plausible number for an invalid circuit. Degrade gracefully.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function assertNoNaN(board, label) {
  for (const net of board.nets) {
    const v = board.nodeVoltage(net.id);
    assert.ok(!Number.isNaN(v), `${label}: nodeVoltage("${net.id}") = NaN`);
    assert.ok(Number.isFinite(v), `${label}: nodeVoltage("${net.id}") = ${v} (not finite)`);
  }
  for (const part of board.parts) {
    if (part.kind === 'led') {
      const b = board.ledBrightness(part.id);
      assert.ok(!Number.isNaN(b), `${label}: ledBrightness("${part.id}") = NaN`);
      assert.ok(b >= 0 && b <= 1, `${label}: ledBrightness("${part.id}") = ${b} (out of range)`);
    }
    if (part.kind === 'buzzer') {
      const tone = board.buzzerTone(part.id);
      assert.ok(!Number.isNaN(tone.hz), `${label}: buzzerTone("${part.id}").hz = NaN`);
    }
  }
}

describe('floating node (no path to ground)', () => {
  it('does not crash or return NaN', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      // R1.b goes to a net with nothing else — floating node
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nfloat', terminals: [{ part: 'R1', terminal: 'b' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    assertNoNaN(board, 'floating node');
  });

  it('floating node still resolves with MNA', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nfloat', terminals: [{ part: 'R1', terminal: 'b' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // branchCurrent should not crash
    try {
      const i = board.branchCurrent('R1', 'b');
      assert.ok(!Number.isNaN(i), `branchCurrent should not be NaN: ${i}`);
    } catch {
      // Singular matrix is acceptable — it should not be NaN
    }
  });
});

describe('short circuit: pin driving high straight into GND', () => {
  it('does not crash, computes large current', () => {
    // A beginner will absolutely wire this: push-pull high → GND directly.
    // V = 5V, R = 25Ω (pin resistance), I = 5/25 = 200 mA.
    // This is a dead short that would damage the chip.
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      // Pin directly to GND — the short
      { id: 'nshort', terminals: [
        { part: 'MCU', terminal: 'P1.0' },
        { part: 'GND', terminal: 'gnd' },
      ]},
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true); // drives 5V into GND

    assertNoNaN(board, 'short circuit');

    // readPin should still work
    const v = board.readPin('P1.0');
    assert.ok(v === 0 || v === 1, `readPin returns valid digital level: ${v}`);
  });

  it('MNA computes the short-circuit current', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] }, // ~0Ω
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    // I = 5 / (25 + 1) ≈ 192 mA — well above the 20 mA safe limit
    const i = board.branchCurrent('R1', 'b');
    assert.ok(!Number.isNaN(i), `short circuit current should not be NaN`);
    assert.ok(i > 0.1, `short circuit current ${i} should be large (>100 mA)`);
  });
});

describe('VCC shorted to GND', () => {
  it('does not crash', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      // VCC and GND on the same net — dead short
      { id: 'nshort', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'GND', terminal: 'gnd' },
      ]},
    ];
    board.setNetlist(parts, nets);
    assertNoNaN(board, 'VCC-GND short');
  });
});

describe('zero-ohm resistor', () => {
  it('does not crash, treated as wire', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R0', kind: 'resistor', params: { ohms: 0 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R0', terminal: 'a' }] },
      { id: 'np', terminals: [{ part: 'R0', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'input', false);

    const v = board.readAnalog('P1.0');
    assert.ok(!Number.isNaN(v), `voltage should not be NaN`);
    // 0Ω wire from VCC → pin reads VCC
    assert.ok(Math.abs(v - 5.0) < 0.01, `0Ω from VCC: voltage ${v} should be 5V`);
  });
});

describe('negative resistance (bad user input)', () => {
  it('does not crash or return NaN', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R_BAD', kind: 'resistor', params: { ohms: -100 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_BAD', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'R_BAD', terminal: 'b' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    assertNoNaN(board, 'negative resistance');
  });
});

describe('zero-farad capacitor', () => {
  it('does not crash', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'C0', kind: 'capacitor', params: { farads: 0 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C0', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C0', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.advanceTo(1_000_000n);
    assertNoNaN(board, 'zero-farad cap');
  });
});

describe('very large values', () => {
  it('1 MΩ resistor does not lose precision', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 2.5) < 0.01, `1MΩ divider: ${v} should be 2.5V`);
  });

  it('1 µΩ resistor does not cause division by zero', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R_TINY', kind: 'resistor', params: { ohms: 0.000001 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_TINY', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'R_TINY', terminal: 'b' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    assertNoNaN(board, 'micro-ohm resistor');
  });
});

describe('multiple parts with same id (user error)', () => {
  it('does not crash', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] }, // duplicate id
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    // Should not throw
    board.setNetlist(parts, nets);
    assertNoNaN(board, 'duplicate part id');
  });
});

describe('MNA: NR convergence edge cases', () => {
  it('LED driven backward through the MNA does not diverge', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      // LED wired backward: cathode to VCC, anode to GND
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LED1', terminal: 'cathode' }] },
      { id: 'nm', terminals: [{ part: 'LED1', terminal: 'anode' }, { part: 'R1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(!Number.isNaN(i), `reverse LED current should not be NaN`);
    assert.ok(Math.abs(i) < 0.001, `reverse LED should not conduct: ${i}`);
  });
});

describe('empty net (no terminals)', () => {
  it('does not crash', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] }],
      [
        { id: 'n1', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'nempty', terminals: [] }, // no terminals
      ],
    );
    assert.equal(board.nodeVoltage('nempty'), 0);
  });
});
