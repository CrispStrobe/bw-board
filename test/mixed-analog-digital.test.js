/**
 * Mixed analog/digital circuit tests: circuits where analog and digital
 * signals interact, testing readPin vs readAnalog thresholds.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('analog/digital threshold', () => {
  it('voltage sweep crosses digital threshold exactly', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);

    // Sweep and find the threshold
    let lastDigital = 0;
    let crossingPos = -1;

    for (let i = 0; i <= 100; i++) {
      const pos = i / 100;
      board.setControl('POT', pos);
      const digital = board.readPin('P1.3');
      const analog = board.readAnalog('P1.3');

      if (digital !== lastDigital && i > 0) {
        crossingPos = pos;
      }
      lastDigital = digital;

      // Analog and digital must be consistent
      if (analog > 1.5) {
        assert.equal(digital, 1, `pos=${pos}: analog=${analog} > 1.5 → digital=1`);
      } else {
        assert.equal(digital, 0, `pos=${pos}: analog=${analog} ≤ 1.5 → digital=0`);
      }
    }

    // Crossing should happen around 0.30 (1.5V / 5V)
    assert.ok(crossingPos > 0.28 && crossingPos < 0.32,
      `threshold crossing at pos=${crossingPos} ≈ 0.30`);
  });
});

describe('analog read during PWM', () => {
  it('pot voltage readable while LED is PWM-ing', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
      ],
      [
        { id: 'nv', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
          { part: 'POT', terminal: 'a' },
        ]},
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);
    board.setControl('POT', 0.6);

    // PWM the LED while reading the pot
    for (let i = 0; i < 20; i++) {
      const t = BigInt(i) * 1_000_000n;
      board.advanceTo(t);
      board.setPin('P1.0', 'pushpull', i % 2 === 0);

      // Pot should always read correctly regardless of LED state
      const v = board.readAnalog('P1.3');
      assert.ok(Math.abs(v - 3.0) < 0.1,
        `frame ${i}: pot voltage ${v} ≈ 3.0V (LED state doesn't affect pot)`);
    }
  });
});

describe('digital output affects analog read on same port', () => {
  it('driving one pin does not affect ADC on another', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'POT', terminal: 'a' }, { part: 'R1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
        { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
        { id: 'np', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] },
      ],
    );
    board.setPin('P1.3', 'input', false);
    board.setControl('POT', 0.5);

    // P1.0 toggles, P1.3 reads pot
    board.setPin('P1.0', 'pushpull', false);
    const v1 = board.readAnalog('P1.3');

    board.setPin('P1.0', 'pushpull', true);
    const v2 = board.readAnalog('P1.3');

    // Both should be 2.5V — P1.0's state doesn't affect P1.3's net
    assert.ok(Math.abs(v1 - 2.5) < 0.01, `P1.0 low: pot=${v1}`);
    assert.ok(Math.abs(v2 - 2.5) < 0.01, `P1.0 high: pot=${v2}`);
  });
});

describe('button debounce with capacitor', () => {
  it('RC filter on button slows the transition', () => {
    // VCC → R_pu(10k) → node → button → GND
    // node → R_filter(1k) → C(1µF) → GND, MCU reads C voltage
    // RC = 1k × 1µF = 1ms
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R_PU', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'BTN', kind: 'button', params: {}, terminals: ['a', 'b'] },
        { id: 'R_F', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.000001 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P3.2'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R_PU', terminal: 'a' }] },
        { id: 'nbtn', terminals: [
          { part: 'R_PU', terminal: 'b' },
          { part: 'BTN', terminal: 'a' },
          { part: 'R_F', terminal: 'a' },
        ]},
        { id: 'nrc', terminals: [
          { part: 'R_F', terminal: 'b' },
          { part: 'C1', terminal: 'a' },
          { part: 'MCU', terminal: 'P3.2' },
        ]},
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'BTN', terminal: 'b' },
          { part: 'C1', terminal: 'b' },
        ]},
      ],
    );
    board.setPin('P3.2', 'input', false);
    board.setControl('BTN', 0); // not pressed

    // Wait for cap to charge to VCC through R_PU + R_F
    board.advanceTo(100_000_000n); // 100ms — well past 5RC
    assert.equal(board.readPin('P3.2'), 1, 'cap charged → pin high');

    // Press button → node drops to GND → cap discharges through R_F
    board.setControl('BTN', 1);

    // Immediately: cap still has charge → pin still high
    const vImmediate = board.readAnalog('P3.2');

    // After 5ms (5RC): cap discharged
    board.advanceTo(105_000_000n);
    const vAfter = board.readAnalog('P3.2');
    assert.ok(vAfter < 0.5, `after 5ms: cap discharged to ${vAfter}`);
    assert.equal(board.readPin('P3.2'), 0, 'cap discharged → pin low');
  });
});
