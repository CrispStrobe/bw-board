/**
 * Sensor circuit tests: realistic analog sensor configurations
 * using LDR, NTC, and voltage dividers with MCU ADC.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('LDR light sensor circuit', () => {
  function makeLightSensor() {
    // VCC → LDR → node → R(10k) → GND, MCU P1.3 reads node
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'LDR', kind: 'ldr', params: { rDark: 500000, rLight: 200 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      nets: [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LDR', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'LDR', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    };
  }

  it('dark room → low ADC reading', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLightSensor();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('LDR', 0);

    const v = board.readAnalog('P1.3');
    const counts = Math.round(v / 5.0 * 1023);
    // V = 5 * 10k / (500k + 10k) ≈ 0.098V → ~20 counts
    assert.ok(counts < 50, `dark: ${counts} counts should be low`);
  });

  it('bright sunlight → high ADC reading', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLightSensor();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('LDR', 1.0);

    const v = board.readAnalog('P1.3');
    const counts = Math.round(v / 5.0 * 1023);
    assert.ok(counts > 950, `bright: ${counts} counts ≈ 1023`);
  });

  it('indoor light → mid-range reading', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLightSensor();
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('LDR', 0.5);

    const v = board.readAnalog('P1.3');
    const counts = Math.round(v / 5.0 * 1023);
    assert.ok(counts > 200 && counts < 800,
      `indoor: ${counts} counts should be mid-range`);
  });

  it('LDR controls LED brightness via threshold', () => {
    // LDR → divider → MCU reads → if dark, turn on LED
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'LDR', kind: 'ldr', params: { rDark: 500000, rLight: 200 }, terminals: ['a', 'b'] },
      { id: 'R_SENSE', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'R_LED', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'LDR', terminal: 'a' },
        { part: 'R_LED', terminal: 'a' },
      ]},
      { id: 'nm', terminals: [
        { part: 'LDR', terminal: 'b' },
        { part: 'R_SENSE', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.3' },
      ]},
      { id: 'nr', terminals: [{ part: 'R_LED', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R_SENSE', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Dark → LDR high R → low voltage → readPin = 0 → turn on LED
    board.setControl('LDR', 0);
    const darkV = board.readAnalog('P1.3');
    assert.equal(board.readPin('P1.3'), 0, `dark: pin=${board.readPin('P1.3')}`);

    board.setPin('P1.0', 'pushpull', false); // LED on
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.1, 'LED on in dark');

    // Bright → LDR low R → high voltage → readPin = 1 → turn off LED
    board.setControl('LDR', 1.0);
    assert.equal(board.readPin('P1.3'), 1);
    board.setPin('P1.0', 'pushpull', true); // LED off
    board.advanceTo(50_000_000n);
    assert.ok(board.ledBrightness('LED1') < 0.01, 'LED off in bright');
  });
});

describe('NTC temperature sensor circuit', () => {
  it('temperature sweep produces monotonic ADC readings', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'NTC', kind: 'ntc', params: { rCold: 50000, rHot: 500 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'NTC', terminal: 'a' }] },
        { id: 'nm', terminals: [
          { part: 'NTC', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);

    const readings = [];
    for (let i = 0; i <= 20; i++) {
      const temp = i / 20;
      board.setControl('NTC', temp);
      readings.push({
        temp,
        v: board.readAnalog('P1.3'),
        counts: Math.round(board.readAnalog('P1.3') / 5.0 * 1023),
      });
    }

    // Should be monotonically increasing (NTC resistance drops, voltage rises)
    for (let i = 1; i < readings.length; i++) {
      assert.ok(readings[i].v >= readings[i - 1].v,
        `temp ${readings[i].temp}: ${readings[i].v} ≥ ${readings[i - 1].v}`);
    }

    // Cold end should be low, hot end should be high
    // V = 5 * 10k / (50k + 10k) ≈ 0.833V → ~170 counts
    assert.ok(readings[0].counts < 200, `cold: ${readings[0].counts} counts`);
    assert.ok(readings[20].counts > 900, `hot: ${readings[20].counts} counts`);
  });
});
