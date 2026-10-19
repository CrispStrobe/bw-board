/**
 * Real-world circuit patterns from 8051 tutorials and starter kits.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('traffic light: 3 LEDs cycling', () => {
  it('red → yellow → green → red cycle', () => {
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

    // Add 3 LEDs (active low) with different Vf for color accuracy
    for (const [i, vf] of [[0, 2.0], [1, 2.1], [2, 2.2]]) {
      const pin = `P1.${i}`;
      const rId = `R${i}`;
      const ledId = `LED${i}`;
      parts.push({ id: rId, kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] });
      parts.push({ id: ledId, kind: 'led', params: { vf }, terminals: ['anode', 'cathode'] });
      nets[0].terminals.push({ part: rId, terminal: 'a' });
      nets.push({ id: `nr${i}`, terminals: [{ part: rId, terminal: 'b' }, { part: ledId, terminal: 'anode' }] });
      nets.push({ id: `np${i}`, terminals: [{ part: ledId, terminal: 'cathode' }, { part: 'MCU', terminal: pin }] });
    }
    board.setNetlist(parts, nets);

    const MS = 1_000_000n;

    // Red on, others off
    board.setPin('P1.0', 'pushpull', false);
    board.setPin('P1.1', 'pushpull', true);
    board.setPin('P1.2', 'pushpull', true);
    board.advanceTo(25n * MS);
    assert.ok(board.ledBrightness('LED0') > 0.1, 'red on');
    assert.ok(board.ledBrightness('LED1') < 0.01, 'yellow off');
    assert.ok(board.ledBrightness('LED2') < 0.01, 'green off');

    // Yellow on
    board.setPin('P1.0', 'pushpull', true);
    board.setPin('P1.1', 'pushpull', false);
    board.advanceTo(50n * MS);
    assert.ok(board.ledBrightness('LED0') < 0.01, 'red off');
    assert.ok(board.ledBrightness('LED1') > 0.1, 'yellow on');

    // Green on
    board.setPin('P1.1', 'pushpull', true);
    board.setPin('P1.2', 'pushpull', false);
    board.advanceTo(75n * MS);
    assert.ok(board.ledBrightness('LED1') < 0.01, 'yellow off');
    assert.ok(board.ledBrightness('LED2') > 0.1, 'green on');

    // Back to red
    board.setPin('P1.2', 'pushpull', true);
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(100n * MS);
    assert.ok(board.ledBrightness('LED0') > 0.1, 'red on again');
    assert.ok(board.ledBrightness('LED2') < 0.01, 'green off');
  });
});

describe('alarm: button triggers buzzer', () => {
  it('press button → buzzer sounds, release → silence', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.2', 'P1.5'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
        { id: 'nbtn', terminals: [
          { part: 'R_PU', terminal: 'b' },
          { part: 'BTN', terminal: 'a' },
          { part: 'MCU', terminal: 'P3.2' },
        ]},
        { id: 'nbuz', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'BTN', terminal: 'b' },
          { part: 'BUZZ', terminal: 'b' },
        ]},
      ],
    );
    board.setPin('P3.2', 'input', false);
    board.setPin('P1.5', 'pushpull', false);

    // Button not pressed → pin 1 → no alarm
    board.setControl('BTN', 0);
    assert.equal(board.readPin('P3.2'), 1);
    let tone = board.buzzerTone('BUZZ');
    assert.equal(tone.on, false);

    // Button pressed → pin 0 → program starts toggling buzzer
    board.setControl('BTN', 1);
    assert.equal(board.readPin('P3.2'), 0);

    // Simulate program toggling buzzer at 1kHz
    const MS = 1_000_000n;
    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }

    tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'buzzer should sound');
    assert.ok(Math.abs(tone.hz - 1000) < 100, `freq ${tone.hz} ≈ 1kHz`);
  });
});

describe('night light: LDR controls LED', () => {
  it('dark → LED on, bright → LED off', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'LDR', kind: 'ldr', params: { rDark: 500000, rLight: 200 }, terminals: ['a', 'b'] },
        { id: 'R_SENSE', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'R_LED', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
      ],
      [
        { id: 'nv', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'LDR', terminal: 'a' },
          { part: 'R_LED', terminal: 'a' },
        ]},
        { id: 'nsense', terminals: [
          { part: 'LDR', terminal: 'b' },
          { part: 'R_SENSE', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'nled', terminals: [{ part: 'R_LED', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'npin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R_SENSE', terminal: 'b' },
        ]},
      ],
    );
    board.setPin('P1.3', 'input', false);

    // Dark: LDR high R → low voltage → program turns on LED
    board.setControl('LDR', 0);
    assert.equal(board.readPin('P1.3'), 0, 'dark → digital 0');
    board.setPin('P1.0', 'pushpull', false); // LED on
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED1') > 0.1, 'LED on at night');

    // Bright: LDR low R → high voltage → program turns off LED
    board.setControl('LDR', 1.0);
    assert.equal(board.readPin('P1.3'), 1, 'bright → digital 1');
    board.setPin('P1.0', 'pushpull', true); // LED off
    board.advanceTo(50_000_000n);
    assert.ok(board.ledBrightness('LED1') < 0.01, 'LED off in daylight');
  });
});

describe('temperature alarm: NTC triggers buzzer', () => {
  it('hot → buzzer sounds', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'NTC', kind: 'ntc', params: { rCold: 50000, rHot: 500 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3', 'P1.5'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'NTC', terminal: 'a' }] },
        { id: 'nsense', terminals: [
          { part: 'NTC', terminal: 'b' },
          { part: 'R1', terminal: 'a' },
          { part: 'MCU', terminal: 'P1.3' },
        ]},
        { id: 'nbuz', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'R1', terminal: 'b' },
          { part: 'BUZZ', terminal: 'b' },
        ]},
      ],
    );
    board.setPin('P1.3', 'input', false);
    board.setPin('P1.5', 'pushpull', false);

    // Cold: NTC high R → low voltage → below threshold → no alarm
    board.setControl('NTC', 0);
    const vCold = board.readAnalog('P1.3');
    assert.ok(vCold < 2.0, `cold: ${vCold}V is low`);

    // Hot: NTC low R → high voltage → above threshold → alarm
    board.setControl('NTC', 1.0);
    const vHot = board.readAnalog('P1.3');
    assert.ok(vHot > 3.0, `hot: ${vHot}V is high`);
    assert.equal(board.readPin('P1.3'), 1, 'hot → digital 1 → trigger alarm');

    // Toggle buzzer
    for (let i = 0; i < 10; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
    }
    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'alarm buzzing');
  });
});
