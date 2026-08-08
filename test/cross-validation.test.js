/**
 * Cross-validation: closed-form solver vs MNA solver on every circuit
 * type both can handle. They should agree within tolerance.
 *
 * This is the most important class of test — if the two solvers diverge,
 * the closed-form path is wrong (or the MNA is wrong), and we need to
 * know which.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function assertClose(a, b, tol, msg) {
  assert.ok(Math.abs(a - b) < tol, `${msg}: ${a} vs ${b} (tol=${tol})`);
}

describe('cross-validation: voltage dividers', () => {
  const testCases = [
    { r1: 1000, r2: 1000, expected: 2.5 },
    { r1: 1000, r2: 2000, expected: 3.333 },
    { r1: 1000, r2: 3000, expected: 3.75 },
    { r1: 10000, r2: 1000, expected: 0.4545 },
    { r1: 470, r2: 10000, expected: 4.775 },
  ];

  for (const tc of testCases) {
    it(`${tc.r1}Ω / ${tc.r2}Ω → ${tc.expected}V`, () => {
      const board = new BoardImpl(5.0);
      const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: tc.r1 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: tc.r2 }, terminals: ['a', 'b'] },
      ];
      const nets = [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
      ];
      board.setNetlist(parts, nets);

      // Closed-form
      const vCF = board.nodeVoltage('nm');
      assertClose(vCF, tc.expected, 0.01, 'closed-form');

      // MNA (via branchCurrent which triggers the solver)
      const i = board.branchCurrent('R1', 'b');
      const vMNA = 5.0 - i * tc.r1; // V_mid = VCC - I*R1
      assertClose(vMNA, tc.expected, 0.01, 'MNA');

      // Agreement
      assertClose(vCF, vMNA, 0.02, 'CF vs MNA');
    });
  }
});

describe('cross-validation: LED circuits', () => {
  const testCases = [
    { r: 220, vf: 2.0, label: '220Ω red' },
    { r: 1000, vf: 2.0, label: '1kΩ red' },
    { r: 470, vf: 3.2, label: '470Ω blue' },
    { r: 10000, vf: 1.8, label: '10kΩ IR' },
  ];

  for (const tc of testCases) {
    it(`${tc.label}: LED Vf=${tc.vf}V through ${tc.r}Ω`, () => {
      const board = new BoardImpl(5.0);
      const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: tc.r }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: tc.vf }, terminals: ['anode', 'cathode'] },
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
      board.advanceTo(1_000_000n);

      // Closed-form: brightness
      const brightness = board.ledBrightness('LED1');
      const cfCurrent = brightness * 0.020;

      // MNA: branchCurrent
      const mnaCurrent = board.branchCurrent('LED1', 'anode');

      // Hand-computed
      const rd = 10;
      const rPin = 25;
      const expected = (5.0 - tc.vf) / (tc.r + rd + rPin);

      assertClose(cfCurrent, expected, 0.0005, 'CF vs hand');
      assertClose(mnaCurrent, expected, 0.0005, 'MNA vs hand');
      assertClose(cfCurrent, mnaCurrent, 0.0005, 'CF vs MNA');
    });
  }
});

describe('cross-validation: button with pull-up', () => {
  it('button open → VCC, pressed → GND', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.2'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
      { id: 'np', terminals: [
        { part: 'R_PU', terminal: 'b' },
        { part: 'BTN', terminal: 'a' },
        { part: 'MCU', terminal: 'P3.2' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BTN', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);

    // Open: CF
    board.setControl('BTN', 0);
    assert.equal(board.readPin('P3.2'), 1);
    const vOpenCF = board.nodeVoltage('np');
    assertClose(vOpenCF, 5.0, 0.1, 'open CF');

    // Open: MNA
    const iOpen = board.branchCurrent('R_PU', 'b');
    assertClose(iOpen, 0, 0.0001, 'open MNA current ≈ 0');

    // Pressed: CF
    board.setControl('BTN', 1);
    assert.equal(board.readPin('P3.2'), 0);
    const vClosedCF = board.nodeVoltage('np');
    assertClose(vClosedCF, 0, 0.1, 'pressed CF');

    // Pressed: MNA
    const iClosed = board.branchCurrent('R_PU', 'b');
    // I = 5/10000 = 0.5 mA (through pull-up into GND via button)
    assertClose(iClosed, 0.0005, 0.0001, 'pressed MNA current');
  });
});

describe('cross-validation: MCU pin modes on divider', () => {
  function makeDividerWithPin() {
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      nets: [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.0' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
      ],
    };
  }

  it('input mode: no loading', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeDividerWithPin();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'input', false);

    assertClose(board.nodeVoltage('nm'), 2.5, 0.01, 'input: divider');
  });

  it('pushpull low: pulls to GND', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeDividerWithPin();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    // Norton: VCC/10k, GND/10k, pin(0V/25Ω)
    // V = (5/10000) / (1/10000 + 1/10000 + 1/25) = 0.0005/0.0402 ≈ 0.0124V
    assertClose(board.nodeVoltage('nm'), 0.0124, 0.005, 'pp low');
  });

  it('pushpull high: pulls to VCC', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeDividerWithPin();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    // Norton: VCC/10k + VCC/25, GND/10k
    // I = 5/10000 + 5/25 = 0.0005 + 0.2 = 0.2005
    // G = 0.0001 + 0.0001 + 0.04 = 0.0402
    // V = 0.2005/0.0402 ≈ 4.988V
    assertClose(board.nodeVoltage('nm'), 4.988, 0.01, 'pp high');
  });

  it('quasi high: weak pull-up barely moves divider', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeDividerWithPin();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', true);

    // Norton: VCC/10k + VCC/21700, GND/10k
    // I = 5/10000 + 5/21700 = 0.0005 + 0.0002304 = 0.0007304
    // G = 0.0001 + 0.0001 + 1/21700 = 0.0002461
    // V = 0.0007304/0.0002461 ≈ 2.968V
    const v = board.nodeVoltage('nm');
    assert.ok(v > 2.5, `quasi high: ${v} should be > 2.5V (slight pull up)`);
    assert.ok(v < 3.2, `quasi high: ${v} should be < 3.2V (weak pull)`);
  });

  it('opendrain high: high-Z, same as input', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeDividerWithPin();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'opendrain', true);

    assertClose(board.nodeVoltage('nm'), 2.5, 0.01, 'opendrain high = input');
  });

  it('opendrain low: pulls to GND (same as pushpull low)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeDividerWithPin();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'opendrain', false);

    assertClose(board.nodeVoltage('nm'), 0.0124, 0.005, 'opendrain low');
  });
});

describe('cross-validation: parallel resistors to GND', () => {
  it('3 parallel 1kΩ to GND', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R_top', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_top', terminal: 'a' }] },
      { id: 'nm', terminals: [
        { part: 'R_top', terminal: 'b' },
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
    ];
    board.setNetlist(parts, nets);

    // R_bottom = 1k ∥ 1k ∥ 1k = 333.33Ω
    // V = 5 * 333.33 / (1000 + 333.33) = 5 * 0.25 = 1.25V
    const vCF = board.nodeVoltage('nm');
    assertClose(vCF, 1.25, 0.01, 'closed-form');

    // MNA
    const iTop = board.branchCurrent('R_top', 'b');
    const vMNA = 5.0 - iTop * 1000;
    assertClose(vMNA, 1.25, 0.01, 'MNA');
  });
});
