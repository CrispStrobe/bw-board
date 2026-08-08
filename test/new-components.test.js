/**
 * Tests for new components: LDR, NTC, NPN transistor, zener diode,
 * seven-segment display, RGB LED.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

// ─── LDR (photoresistor) ─────────────────────────────────────────────────

describe('LDR: photoresistor', () => {
  function makeLDRDivider() {
    // VCC → LDR → node → 10kΩ → GND, pin reads node
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'LDR1', kind: 'ldr', params: { rDark: 1000000, rLight: 100 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      nets: [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LDR1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'LDR1', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    };
  }

  it('dark (control=0) → high R → low voltage at divider', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLDRDivider();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('LDR1', 0); // dark = 1MΩ

    // V = 5 * 10k / (1M + 10k) ≈ 0.0495V
    const v = board.readAnalog('P1.3');
    assert.ok(v < 0.1, `dark: ${v} should be near 0V`);
  });

  it('bright (control=1) → low R → high voltage', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLDRDivider();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('LDR1', 1.0); // bright = 100Ω

    // V = 5 * 10k / (100 + 10k) ≈ 4.95V
    const v = board.readAnalog('P1.3');
    assert.ok(v > 4.5, `bright: ${v} should be near 5V`);
  });

  it('midpoint (control=0.5) → intermediate voltage', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLDRDivider();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('LDR1', 0.5);

    // R_ldr = 1M * (100/1M)^0.5 = 1M * 0.01 = 10kΩ
    // V = 5 * 10k / (10k + 10k) = 2.5V
    const v = board.readAnalog('P1.3');
    assert.ok(Math.abs(v - 2.5) < 0.1, `mid: ${v} ≈ 2.5V`);
  });

  it('sweep is monotonically increasing', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLDRDivider();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    let prevV = -1;
    for (let i = 0; i <= 10; i++) {
      board.setControl('LDR1', i / 10);
      const v = board.readAnalog('P1.3');
      assert.ok(v > prevV, `LDR sweep: pos=${i / 10}, V=${v} > ${prevV}`);
      prevV = v;
    }
  });
});

// ─── NTC (thermistor) ─────────────────────────────────────────────────────

describe('NTC: thermistor', () => {
  it('cold (control=0) → high R → low divider voltage', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'NTC1', kind: 'ntc', params: { rCold: 100000, rHot: 1000 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'NTC1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'NTC1', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);
    board.setControl('NTC1', 0); // cold = 100kΩ

    // V = 5 * 10k / (100k + 10k) ≈ 0.455V
    const v = board.readAnalog('P1.3');
    assert.ok(v < 0.6, `cold: ${v} ≈ 0.45V`);
  });

  it('hot (control=1) → low R → high voltage', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'NTC1', kind: 'ntc', params: { rCold: 100000, rHot: 1000 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'NTC1', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'NTC1', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);
    board.setControl('NTC1', 1.0); // hot = 1kΩ

    // V = 5 * 10k / (1k + 10k) ≈ 4.545V
    const v = board.readAnalog('P1.3');
    assert.ok(v > 4.0, `hot: ${v} ≈ 4.5V`);
  });
});

// ─── NPN transistor ───────────────────────────────────────────────────────

describe('NPN transistor', () => {
  it('LED driven through NPN: base high → collector current → LED on', () => {
    // VCC → R_led(1k) → LED → NPN_collector, NPN_emitter → GND
    // MCU pin → R_base(10k) → NPN_base
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_LED', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'Q1', kind: 'npn', params: { beta: 100, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] },
        { id: 'R_BASE', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_LED', terminal: 'a' }] },
        { id: 'n_led', terminals: [{ part: 'R_LED', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'n_col', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'Q1', terminal: 'collector' }] },
        { id: 'n_base', terminals: [{ part: 'R_BASE', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
        { id: 'n_pin', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'R_BASE', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Q1', terminal: 'emitter' }] },
      ],
    );

    // Pin high → base current → collector current → LED on
    board.setPin('P1.0', 'pushpull', true);
    const iLed = board.branchCurrent('LED1', 'anode');
    assert.ok(!Number.isNaN(iLed), 'LED current not NaN');
    assert.ok(iLed > 0.001, `LED should conduct through NPN: ${(iLed * 1000).toFixed(2)} mA`);

    // Pin low → transistor off → LED off
    board.setPin('P1.0', 'pushpull', false);
    const iOff = board.branchCurrent('LED1', 'anode');
    assert.ok(iOff < 0.0001, `LED should be off: ${(iOff * 1000).toFixed(3)} mA`);
  });
});

// ─── Zener diode ──────────────────────────────────────────────────────────

describe('Zener diode', () => {
  it('forward biased: conducts like a regular diode', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'Z1', kind: 'zener', params: { vf: 0.7, vz: 5.1 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'Z1', terminal: 'anode' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'Z1', terminal: 'cathode' }] },
      ],
    );
    // Forward: I = (5 - 0.7) / (1000 + 10) ≈ 4.257 mA
    const i = board.branchCurrent('Z1', 'anode');
    assert.ok(Math.abs(i - 0.004257) < 0.001,
      `forward zener: ${(i * 1000).toFixed(2)} mA ≈ 4.26 mA`);
  });

  it('does not crash with reverse bias below breakdown', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        // Reversed: cathode toward VCC, 3.3V zener, VCC=5V → reverse = 5V > Vz
        // Actually let's use a 12V zener so 5V is below breakdown
        { id: 'Z1', kind: 'zener', params: { vf: 0.7, vz: 12.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'Z1', terminal: 'cathode' }] },
        { id: 'nm', terminals: [{ part: 'Z1', terminal: 'anode' }, { part: 'R1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );
    const i = board.branchCurrent('Z1', 'anode');
    assert.ok(!Number.isNaN(i), 'zener current not NaN');
    assert.ok(Math.abs(i) < 0.001, `below breakdown: ${(i * 1000).toFixed(3)} mA ≈ 0`);
  });
});

// ─── Seven-segment display ────────────────────────────────────────────────

describe('seven-segment display', () => {
  it('sevenSegmentBrightness returns per-segment brightness', () => {
    // Create internal LED sub-parts for a common-cathode display
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];

    // Add sub-LEDs for segments a and b
    for (const seg of ['a', 'b']) {
      const ledId = `SEG1_${seg}`;
      const rId = `R_${seg}`;
      const pin = seg === 'a' ? 'P1.0' : 'P1.1';
      parts.push(
        { id: rId, kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
        { id: ledId, kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      );
      nets[0].terminals.push({ part: rId, terminal: 'a' }); // VCC → R
      nets.push({ id: `n_r_${seg}`, terminals: [{ part: rId, terminal: 'b' }, { part: ledId, terminal: 'anode' }] });
      nets.push({ id: `n_${seg}_pin`, terminals: [{ part: ledId, terminal: 'cathode' }, { part: 'MCU', terminal: pin }] });
    }

    board.setNetlist(parts, nets);

    // Segment a on, segment b off
    board.setPin('P1.0', 'pushpull', false); // sink → LED a on
    board.setPin('P1.1', 'pushpull', true);  // source → LED b off
    board.advanceTo(25_000_000n);

    const ssb = board.sevenSegmentBrightness('SEG1');
    assert.ok(ssb.a > 0.1, `segment a should be on: ${ssb.a}`);
    assert.ok(ssb.b < 0.01, `segment b should be off: ${ssb.b}`);
  });
});

// ─── RGB LED ──────────────────────────────────────────────────────────────

describe('RGB LED', () => {
  it('rgbLedBrightness returns per-channel brightness', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];

    // RGB LED: three sub-LEDs with different Vf
    const channels = [
      { ch: 'r', pin: 'P1.0', vf: 2.0 },
      { ch: 'g', pin: 'P1.1', vf: 2.2 },
      { ch: 'b', pin: 'P1.2', vf: 3.2 },
    ];

    for (const { ch, pin, vf } of channels) {
      const ledId = `RGB1_${ch}`;
      const rId = `R_${ch}`;
      parts.push(
        { id: rId, kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: ledId, kind: 'led', params: { vf }, terminals: ['anode', 'cathode'] },
      );
      nets[0].terminals.push({ part: rId, terminal: 'a' });
      nets.push({ id: `n_r_${ch}`, terminals: [{ part: rId, terminal: 'b' }, { part: ledId, terminal: 'anode' }] });
      nets.push({ id: `n_${ch}_pin`, terminals: [{ part: ledId, terminal: 'cathode' }, { part: 'MCU', terminal: pin }] });
    }

    board.setNetlist(parts, nets);

    // All channels on (active-low)
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', false);
    board.setPin('P1.2', 'pushpull', false);
    board.advanceTo(25_000_000n);

    const rgb = board.rgbLedBrightness('RGB1');
    assert.ok(rgb.r > 0.1, `red channel on: ${rgb.r}`);
    assert.ok(rgb.g > 0.1, `green channel on: ${rgb.g}`);
    assert.ok(rgb.b > 0.05, `blue channel on: ${rgb.b}`);
    // Red should be brightest (lowest Vf), blue dimmest (highest Vf)
    assert.ok(rgb.r > rgb.g, `red > green: ${rgb.r} > ${rgb.g}`);
    assert.ok(rgb.g > rgb.b, `green > blue: ${rgb.g} > ${rgb.b}`);

    // Turn off green
    board.setPin('P1.1', 'pushpull', true);
    board.advanceTo(50_000_000n);
    const rgb2 = board.rgbLedBrightness('RGB1');
    assert.ok(rgb2.g < 0.01, `green off: ${rgb2.g}`);
    assert.ok(rgb2.r > 0.1, `red still on: ${rgb2.r}`);
  });
});
