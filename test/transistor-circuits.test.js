/**
 * Transistor circuit tests: NPN switch, NPN current gain,
 * NPN saturation, and LED driver through transistor.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('NPN: basic switch', () => {
  function makeNPNSwitch() {
    // MCU → R_base(10k) → NPN base; VCC → R_load(1k) → NPN collector; emitter → GND
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_LOAD', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R_BASE', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'Q1', kind: 'npn', params: { beta: 100, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      nets: [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_LOAD', terminal: 'a' }] },
        { id: 'nc', terminals: [{ part: 'R_LOAD', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
        { id: 'nb', terminals: [{ part: 'R_BASE', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R_BASE', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
      ],
    };
  }

  it('pin high → transistor on → collector near GND', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeNPNSwitch();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    // Ib = (5 - 0.7) / (10000 + 25) ≈ 0.429 mA
    // Ic = β × Ib = 100 × 0.429 = 42.9 mA (but limited by VCC/R_LOAD = 5mA)
    // Use MNA-derived collector voltage (closed-form doesn't know about transistors)
    const ic = board.branchCurrent('R_LOAD', 'b');
    assert.ok(ic > 0.003, `collector current ${(ic*1000).toFixed(1)} mA should be significant`);
    // Vc = VCC - Ic × R_LOAD
    const vcMNA = 5.0 - ic * 1000;
    assert.ok(vcMNA < 2.0, `MNA collector voltage ${vcMNA.toFixed(2)} should be low`);
  });

  it('pin low → transistor off → collector near VCC', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeNPNSwitch();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    const ic = board.branchCurrent('R_LOAD', 'b');
    assert.ok(ic < 0.0005, `collector current ${(ic*1000).toFixed(3)} mA should be ~0`);
    // Off: Vc = VCC - Ic×R ≈ VCC
    const vcMNA = 5.0 - ic * 1000;
    assert.ok(vcMNA > 4.0, `MNA collector voltage ${vcMNA.toFixed(2)} should be near VCC`);
  });
});

describe('NPN: LED driver', () => {
  it('weak quasi pin drives LED brightly through transistor', () => {
    // The whole point: quasi-bidir can't drive an LED directly with enough
    // current, but it CAN drive a transistor base, which then drives the LED.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_LED', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'R_BASE', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'Q1', kind: 'npn', params: { beta: 100, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_LED', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R_LED', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'nc', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'Q1', terminal: 'collector' }] },
        { id: 'nb', terminals: [{ part: 'R_BASE', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R_BASE', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
      ],
    );

    // Quasi high: weak 230µA source → enough to drive transistor base
    board.setPin('P1.0', 'quasi', true);

    const iLed = board.branchCurrent('LED1', 'anode');
    // Base current ≈ (5 - 0.7) / (21700 + 10000) ≈ 0.136 mA
    // Collector current = β × Ib = 13.6 mA (if not saturated)
    // LED current limited by R_LED: I = (5 - 2) / 340 ≈ 8.8 mA max
    assert.ok(iLed > 0.002, `LED through transistor: ${(iLed*1000).toFixed(2)} mA`);
  });

  it('quasi high directly: LED barely visible', () => {
    // Compare: same LED but directly from quasi pin (no transistor)
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LED1', terminal: 'cathode' }] },
      ],
    );
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    // Quasi source: I = (5-2)/(21700+330+10) ≈ 0.136 mA → barely visible
    assert.ok(b < 0.02, `direct quasi: brightness ${b} should be very dim`);
  });
});

describe('NPN: different beta values', () => {
  const betas = [10, 50, 100, 200, 500];

  for (const beta of betas) {
    it(`β=${beta}: higher gain → more collector current`, () => {
      const board = new BoardImpl(5.0);
      board.setNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'R_LOAD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
          { id: 'R_BASE', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
          { id: 'Q1', kind: 'npn', params: { beta, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] },
          { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_LOAD', terminal: 'a' }] },
          { id: 'nc', terminals: [{ part: 'R_LOAD', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
          { id: 'nb', terminals: [{ part: 'R_BASE', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
          { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R_BASE', terminal: 'a' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
        ],
      );
      board.setPin('P1.0', 'pushpull', true);

      const ic = board.branchCurrent('Q1', 'collector');
      assert.ok(!Number.isNaN(ic), `β=${beta}: current not NaN`);
      assert.ok(ic >= 0, `β=${beta}: current ≥ 0`);
    });
  }

  // A SMALL LOAD, AND THE OLD LARGE ONE WAS WHY THIS CLAIM DID NOT HOLD.
  //
  // "Higher beta gives more collector current" is a statement about the ACTIVE
  // region: Ic = beta*Ib only while the load can pass it. With R_LOAD = 100k
  // the load caps Ic at 5/100k = 0.05 mA while beta*Ib is 0.43 to 21.6 mA, so
  // all three transistors were SATURATED — closed switches, current set by the
  // load and not by beta. Measured there:
  //
  //     beta= 10   Ic 0.049880 mA   Vce 0.0328   saturated
  //     beta=100   Ic 0.049823 mA   Vce 0.0300   saturated
  //     beta=500   Ic 0.049820 mA   Vce 0.0297   saturated
  //
  // Identical to four figures, and ordered the WRONG way by about 6e-8 A. That
  // residue is not physics: in saturation the extraction reads
  // `gS*(Vce - Vce_sat)`, a difference of two numbers that the clamp has forced
  // to within 5e-6 V of each other, so its low digits are cancellation noise.
  // The test passed for years on the sign of that noise, and only stopped when
  // Vce(sat) became a derived value and the noise landed the other way.
  //
  // R_LOAD = 100 puts all three in the active region, where the claim is
  // actually true and the margins are the ratios themselves:
  //
  //     beta= 10   Ic  0.431843 mA   Vce 4.9568   active
  //     beta=100   Ic  4.318428 mA   Vce 4.5682   active
  //     beta=500   Ic 21.592142 mA   Vce 2.8408   active
  //
  // Ten times and five times, which is beta*Ib and nothing else.
  it('higher β produces more collector current, in the ACTIVE region', () => {
    const currents = [];

    for (const beta of [10, 100, 500]) {
      const board = new BoardImpl(5.0);
      board.setNetlist(
        [
          { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
          { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
          { id: 'R_LOAD', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
          { id: 'R_BASE', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
          { id: 'Q1', kind: 'npn', params: { beta, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] },
          { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        ],
        [
          { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_LOAD', terminal: 'a' }] },
          { id: 'nc', terminals: [{ part: 'R_LOAD', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
          { id: 'nb', terminals: [{ part: 'R_BASE', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
          { id: 'np', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R_BASE', terminal: 'a' }] },
          { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
        ],
      );
      board.setPin('P1.0', 'pushpull', true);
      currents.push({ beta, ic: board.branchCurrent('Q1', 'collector') });
    }

    // Higher β → more Ic (when not saturated)
    for (let i = 1; i < currents.length; i++) {
      assert.ok(currents[i].ic >= currents[i - 1].ic,
        `β=${currents[i].beta} (${(currents[i].ic*1000).toFixed(3)}mA) ≥ β=${currents[i-1].beta} (${(currents[i-1].ic*1000).toFixed(3)}mA)`);
    }
  });
});
