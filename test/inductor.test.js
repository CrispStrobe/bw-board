/**
 * Inductor tests: DC steady state (wire), series with resistor,
 * MNA current, and validation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { validateNetlist } from '../src/validate.js';

describe('inductor: DC steady state', () => {
  it('inductor is a wire at DC — full VCC across load', () => {
    // VCC → L(10mH) → R(1k) → GND
    // At DC, inductor has zero impedance, so V_node = VCC, I = VCC/R
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'L1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'L1', terminal: 'b' }, { part: 'R1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );

    // Closed-form: inductor = wire, so V_node = VCC
    const v = board.nodeVoltage('nm');
    assert.ok(Math.abs(v - 5.0) < 0.01, `inductor DC: node voltage ${v} ≈ 5V`);

    // MNA: current = VCC/R = 5mA
    const i = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(i - 0.005) < 0.001, `inductor DC: current ${(i*1000).toFixed(2)} mA ≈ 5mA`);
  });

  it('inductor in series with LED — same current as without inductor', () => {
    // VCC → L → R(1k) → LED(Vf=2) → GND
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'L1', terminal: 'a' }] },
        { id: 'nl', terminals: [{ part: 'L1', terminal: 'b' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED1', terminal: 'cathode' }] },
      ],
    );

    // I = (5-2)/(1000+10) ≈ 2.97 mA (inductor adds ~0Ω at DC)
    const i = board.branchCurrent('LED1', 'anode');
    assert.ok(Math.abs(i - 0.00297) < 0.0005,
      `LED current with inductor: ${(i*1000).toFixed(2)} mA ≈ 2.97 mA`);
  });
});

describe('inductor: parallel with resistor', () => {
  it('at DC, inductor shorts the parallel resistor', () => {
    // VCC → R1(1k) → node → L(10mH) → GND (parallel: R2(1k) → GND)
    // At DC, inductor = wire, so node = GND = 0V. R2 has 0V across it.
    // All current goes through the inductor.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'R2', terminal: 'a' },
          { part: 'L1', terminal: 'a' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R2', terminal: 'b' },
          { part: 'L1', terminal: 'b' },
        ]},
      ],
    );

    // Inductor shorts R2: V_node ≈ 0V (inductor is ~0Ω to GND)
    const v = board.nodeVoltage('nm');
    assert.ok(v < 0.1, `inductor shorts parallel R: node = ${v} ≈ 0V`);
  });
});

describe('inductor: validation', () => {
  it('correct terminals pass', () => {
    // validateNetlist imported at top level
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    const fatal = errors.filter(e => e.severity === 'error');
    assert.equal(fatal.length, 0, `inductor should validate: ${errors.map(e => e.message).join('; ')}`);
  });

  it('wrong terminals rejected', () => {
    // validateNetlist imported at top level
    const errors = validateNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['in', 'out'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assert.ok(errors.some(e => e.severity === 'error' && e.partId === 'L1'));
  });
});

describe('inductor: flyback peak SCALES with declared L (henrys fix regression)', () => {
  // Before the henrys/henries fix (ecfbdf2), the MNA solver always read
  // params.henries which was never set (builder/validate use henrys),
  // so it fell back to 0.001 for every inductor regardless of declared L.
  // This test pins the regression: 1mH and 100mH inductors must produce
  // distinctly different flyback peaks when a switch opens.
  //
  // Method (from the audit): inductor + switch (MCU pin going high-Z),
  // sample at 1µs after turn-off. V = -L * dI/dt: larger L → larger peak.
  // Forces the MNA transient path by including a diode (MNA_ONLY_KINDS).
  // The diode across the inductor is the classic flyback clamp topology;
  // without it, the closed-form path can't produce a voltage spike.
  function flybackPeak(henrys) {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'L1', kind: 'inductor', params: { henrys }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
        { id: 'D1', kind: 'diode', params: { vf: 0.7 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'L1', terminal: 'a' }, { part: 'D1', terminal: 'cathode' }] },
        { id: 'nsw', terminals: [{ part: 'L1', terminal: 'b' }, { part: 'R1', terminal: 'a' }, { part: 'D1', terminal: 'anode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );
    // Drive the switch low (sink current through inductor): 5ms build
    board.setPin('P1.0', 'pushpull', false);
    for (let i = 0; i < 5; i++) board.advanceTo(BigInt(i + 1) * 1_000_000n);
    // Record current before opening
    const iBefore = board.inductorCurrents?.get?.('L1') ?? 0;
    // Open the switch (high-Z) — inductor current has nowhere to go
    board.setPin('P1.0', 'input', false);
    // Sample 100µs later — the inductor's dI/dt spike
    board.advanceTo(5_100_000n);
    return { v: board.nodeVoltage('nsw'), iBefore };
  }

  it('1mH and 100mH produce distinctly different flyback peaks', () => {
    const r1mH = flybackPeak(0.001);
    const r100mH = flybackPeak(0.1);
    console.log(`# flyback: 1mH v=${r1mH.v.toFixed(3)} i=${r1mH.iBefore.toFixed(4)}, ` +
                `100mH v=${r100mH.v.toFixed(3)} i=${r100mH.iBefore.toFixed(4)}`);
    // The inductor currents at turn-off should differ (more current through
    // smaller L for same voltage and time), and the peak voltages should differ.
    // Before the fix: both used henries=0.001 → identical.
    assert.ok(Math.abs(r1mH.iBefore) > 1e-6 || Math.abs(r100mH.iBefore) > 1e-6,
      'at least one inductor should have built current');
    assert.ok(Math.abs(r1mH.iBefore - r100mH.iBefore) > 0.001 ||
              Math.abs(r1mH.v - r100mH.v) > 0.01,
      `1mH and 100mH must produce different behavior — ` +
      `1mH: v=${r1mH.v.toFixed(3)}, 100mH: v=${r100mH.v.toFixed(3)} — ` +
      `if identical, the henrys param is being ignored (the pre-fix bug)`);
  });
});

describe('inductor: resistance measurement', () => {
  it('inductor has ~0Ω DC resistance', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['a', 'b'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'na', terminals: [{ part: 'L1', terminal: 'a' }] },
        { id: 'nb', terminals: [{ part: 'L1', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPower(false);
    const r = board.resistance('na', 'nb');
    assert.ok(typeof r === 'number');
    assert.ok(/** @type {number} */(r) < 1, `inductor DC resistance ${r} ≈ 0Ω`);
  });
});
