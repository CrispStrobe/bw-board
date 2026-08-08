/**
 * Complex circuit tests — multiple components interacting.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('multiple LEDs', () => {
  it('two LEDs on different pins, independent brightness', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 470 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'LED2', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'R1', terminal: 'a' },
        { part: 'R2', terminal: 'a' },
      ]},
      { id: 'n_r1_led1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n_led1_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'n_r2_led2', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'LED2', terminal: 'anode' }] },
      { id: 'n_led2_pin', terminals: [{ part: 'LED2', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.1' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);

    // Only LED1 on
    board.setPin('P1.0', 'pushpull', false); // LED1 on
    board.setPin('P1.1', 'pushpull', true);  // LED2 off
    board.advanceTo(1_000_000n);

    const b1 = board.ledBrightness('LED1');
    const b2 = board.ledBrightness('LED2');
    assert.ok(b1 > 0.1, `LED1 brightness ${b1} should be on`);
    assert.ok(b2 < 0.01, `LED2 brightness ${b2} should be off`);

    // LED2 should be brighter than LED1 due to lower series resistance
    // I_LED2 = (5-2)/(470+10+25) = 3/505 ≈ 5.94 mA → brightness ≈ 0.297
    // I_LED1 = (5-2)/(1000+10+25) = 3/1035 ≈ 2.90 mA → brightness ≈ 0.145
    board.setPin('P1.1', 'pushpull', false); // LED2 on too
    board.advanceTo(25_000_000n); // past window

    const b1b = board.ledBrightness('LED1');
    const b2b = board.ledBrightness('LED2');
    assert.ok(b2b > b1b, `LED2 (470Ω, ${b2b}) should be brighter than LED1 (1kΩ, ${b1b})`);
    assert.ok(Math.abs(b2b - 0.297) < 0.03, `LED2 brightness ${b2b} should be ≈ 0.297`);
  });
});

describe('LED with different forward voltages', () => {
  it('blue LED (Vf=3.2V) is dimmer than red (Vf=2.0V) through same resistor', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED_RED', kind: 'led', params: { vf: 2.0, color: 'red' }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED_RED', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED_RED', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(1_000_000n);
    const bRed = board.ledBrightness('LED_RED');

    // Now blue LED
    const board2 = new BoardImpl(5.0);
    const parts2 = [...parts];
    parts2[3] = { id: 'LED_BLUE', kind: 'led', params: { vf: 3.2, color: 'blue' }, terminals: ['anode', 'cathode'] };
    const nets2 = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED_BLUE', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED_BLUE', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    board2.setNetlist(parts2, nets2);
    board2.setPin('P1.0', 'pushpull', false);
    board2.advanceTo(1_000_000n);
    const bBlue = board2.ledBrightness('LED_BLUE');

    // Red: I=(5-2)/1035 ≈ 2.9mA, Blue: I=(5-3.2)/1035 ≈ 1.74mA
    assert.ok(bRed > bBlue, `red (${bRed}) should be brighter than blue (${bBlue})`);
    assert.ok(bBlue > 0.05, `blue LED (${bBlue}) should still be visible`);
  });

  it('LED with Vf > VCC does not conduct', () => {
    const board = new BoardImpl(3.3);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 3.5 }, terminals: ['anode', 'cathode'] },
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

    const b = board.ledBrightness('LED1');
    assert.ok(b < 0.01, `LED with Vf(3.5) > VCC(3.3) should not conduct, brightness=${b}`);
  });
});

describe('button debounce scenario', () => {
  it('rapid button press/release changes pin reading', () => {
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

    // Simulate rapid toggling
    const readings = [];
    for (let i = 0; i < 10; i++) {
      board.setControl('BTN', i % 2); // alternate press/release
      readings.push(board.readPin('P3.2'));
    }

    // Even indices (button released) → 1, odd indices (pressed) → 0
    for (let i = 0; i < 10; i++) {
      const expected = i % 2 === 0 ? 1 : 0;
      assert.equal(readings[i], expected, `step ${i}: expected ${expected}, got ${readings[i]}`);
    }
  });
});

describe('resistor voltage divider accuracy', () => {
  it('10kΩ / 10kΩ → exactly 2.5V', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
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
    assert.ok(Math.abs(v - 2.5) < 0.01, `divider voltage ${v} should be 2.5V`);
  });

  it('1kΩ / 3kΩ → 3.75V', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
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

    // V = 5 * 3000 / (1000 + 3000) = 3.75V
    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 3.75) < 0.01, `divider voltage ${v} should be 3.75V`);
  });
});

describe('MNA agreement with closed-form', () => {
  it('branchCurrent through resistor matches V/R from closed-form', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // Closed-form: V_mid = 5 * 2000/3000 = 3.333V, I = 5/3000 = 1.667mA
    const vMid = board.nodeVoltage('nm');
    const iR1 = board.branchCurrent('R1', 'b');

    assert.ok(Math.abs(vMid - 3.333) < 0.01, `node voltage ${vMid} should be 3.333V`);
    assert.ok(Math.abs(iR1 - 0.001667) < 0.0001, `current ${iR1} should be 1.667mA`);
  });
});

describe('capacitor discharge', () => {
  it('charged cap discharges when source is removed', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    // Phase 1: charge through VCC → R → C → GND
    const nets1 = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets1);

    // Charge for 5 RC (fully charged)
    board.advanceTo(5_000_000_000n);
    const vCharged = board.nodeVoltage('nrc');
    assert.ok(vCharged > 4.9, `cap should be fully charged: ${vCharged}`);

    // Now reconnect: pin drives low through R → discharges cap
    // Add MCU pin to the RC node
    const parts2 = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets2 = [
      { id: 'nrc', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'C1', terminal: 'a' },
      ]},
      { id: 'npin', terminals: [
        { part: 'R1', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.0' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts2, nets2);
    // Preserve the cap voltage
    board.capVoltages.set('C1', vCharged);
    board.setPin('P1.0', 'pushpull', false); // drive low → target = 0V

    // After 5 RC, should be nearly discharged
    board.advanceTo(10_000_000_000n);
    const vDischarged = board.nodeVoltage('nrc');
    assert.ok(vDischarged < 0.1, `cap should be discharged: ${vDischarged}`);
  });
});

describe('quasi-bidir pin loading a voltage divider', () => {
  it('quasi high weakly loads a divider', () => {
    // VCC → 10kΩ → node → 10kΩ → GND, quasi pin on node driving 1
    // Without pin: Vnode = 2.5V
    // With quasi high: pin adds a weak pull-up (21.7kΩ to VCC)
    // Three parallel paths at node: 10kΩ to VCC, 10kΩ to GND, 21.7kΩ to VCC
    // By Norton: I = VCC/10k + VCC/21.7k from VCC side, G_total = 1/10k + 1/10k + 1/21.7k
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
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

    // Input mode: no loading → 2.5V
    board.setPin('P1.3', 'input', false);
    const vInput = board.readAnalog('P1.3');
    assert.ok(Math.abs(vInput - 2.5) < 0.01, `input mode: ${vInput} should be 2.5V`);

    // Quasi driving high: weak pull-up loads the divider slightly toward VCC
    board.setPin('P1.3', 'quasi', true);
    const vQuasi = board.readAnalog('P1.3');
    // Norton: I_total = 5/10k + 5/21.7k = 0.5mA + 0.2304mA = 0.7304mA toward node
    // G_total = 1/10k + 1/10k + 1/21.7k = 0.0001 + 0.0001 + 0.00004608 = 0.00024608
    // V = 0.7304mA / 0.24608mS... let me just check it's slightly above 2.5
    assert.ok(vQuasi > 2.5, `quasi high should pull slightly above 2.5V: ${vQuasi}`);
    assert.ok(vQuasi < 3.0, `quasi high shouldn't pull too far: ${vQuasi}`);
  });
});
