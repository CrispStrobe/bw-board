/**
 * LED color and Vf sweep: verify the full range of forward voltages
 * produce correct current and brightness through the same circuit.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function ledCircuit(vf, ohms = 1000) {
  return {
    parts: [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ],
    nets: [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ],
  };
}

const LED_COLORS = [
  { name: 'infrared', vf: 1.2, color: 'ir' },
  { name: 'red', vf: 1.8, color: 'red' },
  { name: 'orange', vf: 2.0, color: 'orange' },
  { name: 'yellow', vf: 2.1, color: 'yellow' },
  { name: 'green', vf: 2.2, color: 'green' },
  { name: 'blue', vf: 3.2, color: 'blue' },
  { name: 'white', vf: 3.4, color: 'white' },
  { name: 'UV', vf: 3.8, color: 'uv' },
];

describe('LED colors: brightness through same 1kΩ resistor at 5V', () => {
  for (const led of LED_COLORS) {
    it(`${led.name} (Vf=${led.vf}V)`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = ledCircuit(led.vf);
      board.setNetlist(parts, nets);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(25_000_000n);

      const brightness = board.ledBrightness('LED1');
      const mnaCurrent = board.branchCurrent('LED1', 'anode');

      // I = (5 - KNEE) / (R + Rd + Rpin) = (5 - KNEE) / 1035, where the KNEE is
      // Vf - I_RATED*Rd and NOT Vf itself. Vf is the DATASHEET drop, specified
      // at the rated 20 mA; a piecewise model answers Vf + i*Rd, so feeding it
      // Vf directly describes a part that drops 0.2 V too much at its own rated
      // current. Written out rather than imported from the engine on purpose:
      // this is meant to be a third opinion, and a hand check that calls the
      // code under test has stopped being one.
      const expectedI = (5.0 - (led.vf - 0.020 * 10)) / (1000 + 10 + 25);
      const expectedB = Math.min(1.0, expectedI / 0.020);

      if (led.vf < 5.0) {
        assert.ok(Math.abs(mnaCurrent - expectedI) < 0.0005,
          `${led.name}: MNA current ${(mnaCurrent * 1000).toFixed(2)} mA ≈ ${(expectedI * 1000).toFixed(2)} mA`);
        assert.ok(Math.abs(brightness - expectedB) < 0.02,
          `${led.name}: brightness ${brightness.toFixed(4)} ≈ ${expectedB.toFixed(4)}`);
      } else {
        assert.ok(mnaCurrent < 0.0001, `${led.name}: should not conduct`);
      }
    });
  }
});

describe('LED colors: brightness ordering', () => {
  it('lower Vf → more current → brighter', () => {
    const results = [];

    for (const led of LED_COLORS) {
      if (led.vf >= 5.0) continue;
      const board = new BoardImpl(5.0);
      const { parts, nets } = ledCircuit(led.vf);
      board.setNetlist(parts, nets);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(25_000_000n);
      results.push({ name: led.name, vf: led.vf, brightness: board.ledBrightness('LED1') });
    }

    // Verify monotonically decreasing brightness with increasing Vf
    for (let i = 1; i < results.length; i++) {
      assert.ok(results[i].brightness <= results[i - 1].brightness,
        `${results[i - 1].name} (${results[i - 1].brightness.toFixed(4)}) ≥ ${results[i].name} (${results[i].brightness.toFixed(4)})`);
    }
  });
});

describe('LED colors: at 3.3V some colors are too dim or off', () => {
  for (const led of LED_COLORS) {
    it(`${led.name} at 3.3V`, () => {
      const board = new BoardImpl(3.3);
      const { parts, nets } = ledCircuit(led.vf);
      board.setNetlist(parts, nets);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(25_000_000n);

      const b = board.ledBrightness('LED1');

      if (led.vf >= 3.3) {
        // Not enough voltage → LED off
        assert.ok(b < 0.01, `${led.name} at 3.3V: Vf=${led.vf} ≥ VCC → off (${b})`);
      } else {
        assert.ok(b > 0, `${led.name} at 3.3V: should conduct (${b})`);
      }
    });
  }
});

describe('LED: different series resistors', () => {
  const resistors = [100, 220, 330, 470, 680, 1000, 2200, 4700, 10000];

  for (const r of resistors) {
    it(`${r}Ω with red LED (Vf=2.0)`, () => {
      const board = new BoardImpl(5.0);
      const { parts, nets } = ledCircuit(2.0, r);
      board.setNetlist(parts, nets);
      board.setPin('P1.0', 'pushpull', false);
      board.advanceTo(25_000_000n);

      // 3.2, not 3.0, and the digits are spelled out because the old constant
      // had ABSORBED the parameter: `3.0` was 5.0 - Vf with Vf already folded
      // in, so no search for `vf` could find this line when Vf's meaning
      // changed. Vf is the datasheet drop at the rated 20 mA, so the piecewise
      // knee is Vf - 0.020*Rd = 2.0 - 0.2 = 1.8, and the driving voltage is
      // 5.0 - 1.8 = 3.2.
      const VCC = 5.0, VF = 2.0, RD = 10, I_RATED = 0.020;
      const expectedI = (VCC - (VF - I_RATED * RD)) / (r + RD + 25);
      const b = board.ledBrightness('LED1');
      const expectedB = Math.min(1.0, expectedI / 0.020);

      assert.ok(Math.abs(b - expectedB) < 0.02,
        `${r}Ω: brightness ${b.toFixed(4)} ≈ ${expectedB.toFixed(4)}`);
    });
  }
});
