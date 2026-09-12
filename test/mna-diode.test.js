/**
 * MNA diode/LED Newton-Raphson convergence tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('MNA: LED current through different resistors', () => {
  function ledCircuit(ohms) {
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      nets: [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED1', terminal: 'cathode' }] },
      ],
    };
  }

  it('220Ω → I ≈ 13.04 mA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = ledCircuit(220);
    board.setNetlist(parts, nets);
    // I = (5 - 2) / (220 + 10) = 3/230 ≈ 13.04 mA
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(i - 0.01304) < 0.001, `current ${i} ≈ 13.04 mA`);
  });

  it('330Ω → I ≈ 8.82 mA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = ledCircuit(330);
    board.setNetlist(parts, nets);
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(i - 0.00882) < 0.001, `current ${i} ≈ 8.82 mA`);
  });

  it('10kΩ → I ≈ 0.2994 mA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = ledCircuit(10000);
    board.setNetlist(parts, nets);
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(i - 0.0002994) < 0.0001, `current ${i} ≈ 0.2994 mA`);
  });

  it('100kΩ → I ≈ 29.97 µA', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = ledCircuit(100000);
    board.setNetlist(parts, nets);
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(i - 0.00002997) < 0.00001, `current ${i} ≈ 29.97 µA`);
  });
});

describe('MNA: series LEDs', () => {
  it('two LEDs in series carry the current ngspice measures, ~1.30 mA', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'LED2', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n2', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'LED2', terminal: 'anode' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED2', terminal: 'cathode' }] },
    ];
    board.setNetlist(parts, nets);

    // THE EXPECTATION USED TO BE THE PWL FORMULA, AND IT WAS WRONG.
    //
    // It read `I = (5 - 2 - 2) / (1000 + 10 + 10) = 1/1020 ~= 0.98 mA` — the
    // piecewise model's own arithmetic, asserted as though it were the
    // circuit's behaviour. test/golden/ngspice_diode.json measures this exact
    // circuit at 1.304 mA, so the old expectation was 25% below the device and
    // the test's own NAME carried the error.
    //
    // A junction pair on a 5 V rail has only 1 V of headroom over its 4 V of
    // forward drop, which is inside the band where the walker's knee is not
    // adequate, so this circuit now routes to the exponential model (see
    // _junctionHeadroomV in board.js). Tolerance is +-5% of the ngspice value
    // rather than the old +-0.2 mA, which was 20% and wide enough to hide this.
    const NGSPICE = 0.001304;
    const i1 = board.branchCurrent('LED1', 'anode');
    const i2 = board.branchCurrent('LED2', 'anode');
    assert.ok(Math.abs(i1 - NGSPICE) < NGSPICE * 0.05,
      `LED1 current ${(i1 * 1000).toFixed(3)} mA, ngspice measures ${(NGSPICE * 1000).toFixed(3)} mA`);
    assert.ok(Math.abs(i1 - i2) < 0.0001, 'series LEDs carry same current');
  });

  it('three LEDs in series at 3.3V → not enough voltage, LEDs off', () => {
    const board = new BoardImpl(3.3);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'LED2', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'LED3', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n2', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'LED2', terminal: 'anode' }] },
      { id: 'n3', terminals: [{ part: 'LED2', terminal: 'cathode' }, { part: 'LED3', terminal: 'anode' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED3', terminal: 'cathode' }] },
    ];
    board.setNetlist(parts, nets);

    // 3.3V < 3 × 2V = 6V → no current flows
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(i) < 0.0001, `3 LEDs at 3.3V: current ${i} should be ≈ 0`);
  });
});

describe('MNA: LED + MCU Thévenin agreement', () => {
  it('MNA and closed-form agree for all four modes', () => {
    function test(mode, driveHigh, label) {
      const board = new BoardImpl(5.0);
      const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ];
      const nets = [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ];
      board.setNetlist(parts, nets);
      board.setPin('P1.0', mode, driveHigh);
      board.advanceTo(1_000_000n);

      const brightness = board.ledBrightness('LED1');
      const mnaCurrent = board.branchCurrent('LED1', 'anode');

      // Both should agree within tolerance
      const brightFromMNA = mnaCurrent / 0.020;
      if (brightness > 0.001 || brightFromMNA > 0.001) {
        const ratio = brightness > 0 ? brightFromMNA / brightness : 1;
        assert.ok(Math.abs(ratio - 1) < 0.1,
          `${label}: MNA (${brightFromMNA.toFixed(4)}) vs closed-form (${brightness.toFixed(4)}) ratio=${ratio.toFixed(3)}`);
      }
    }

    test('quasi', false, 'quasi-low');
    test('quasi', true, 'quasi-high');
    test('pushpull', false, 'pushpull-low');
    test('pushpull', true, 'pushpull-high');
    test('opendrain', false, 'opendrain-low');
    test('opendrain', true, 'opendrain-high');
    test('input', false, 'input-low');
    test('input', true, 'input-high');
  });
});

describe('MNA: resistance with LEDs', () => {
  it('LED resistance measurement (power off) includes LED dynamic R', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'na', terminals: [{ part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'nb', terminals: [{ part: 'LED1', terminal: 'cathode' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPower(false);

    // The 1mA test current through R1+LED produces enough voltage to turn
    // the diode on (NR converges to the ON state). Measured R includes the
    // apparent resistance from the forward voltage drop:
    //   R_measured = R1 + Rd + Vf/I_test = 1000 + 10 + 2/0.001 = 3010 Ω
    // This is physically correct: a real DMM in resistance mode would show
    // a similar value because the diode's forward voltage creates an
    // apparent resistance of Vf/I_test.
    const r = board.resistance('na', 'nb');
    assert.ok(typeof r === 'number');
    assert.ok(Math.abs(/** @type {number} */(r) - 3010) < 50,
      `R through LED = ${r} should be ≈ 3010 Ω (R1 + Rd + Vf/I)`);
  });
});
