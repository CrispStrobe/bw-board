/**
 * Timing precision and nanosecond-scale tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeActiveLowLED() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
  ];
  return { parts, nets };
}

describe('timing: nanosecond precision', () => {
  it('bigint time values work at nanosecond scale', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    // 1 CPU cycle at 11.0592 MHz ≈ 90.4 ns
    const CYCLE_NS = 90n;

    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(CYCLE_NS);

    // Even at nanosecond scale, LED current should be computed
    const b = board.ledBrightness('LED1');
    // At such a tiny time, the window integration should still work
    assert.ok(b >= 0, 'brightness should be non-negative at nanosecond scale');
  });

  it('large time values (hours) do not overflow', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    // 1 hour in nanoseconds
    const ONE_HOUR_NS = 3_600_000_000_000n;

    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(ONE_HOUR_NS);

    const b = board.ledBrightness('LED1');
    assert.ok(b > 0.13, `LED should be on after 1 hour: ${b}`);
  });

  it('time reversal does not crash (but is a no-op for RC)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowLED();
    board.setNetlist(parts, nets);

    board.advanceTo(1_000_000n);
    board.advanceTo(500_000n); // time goes backward

    // Should not crash, RC integration skips backward steps
    const b = board.ledBrightness('LED1');
    assert.equal(typeof b, 'number');
  });
});

describe('timing: buzzer frequency precision', () => {
  it('timer-0 overflow at FOSC/12 → exact 1ms tick → 500 Hz buzz', () => {
    // At FOSC=11059200 Hz, FOSC/12 = 921600 Hz
    // Timer reload for 1ms: 65536 - 921 = 64615
    // Actual period: 921 / 921600 = 0.000999348... s ≈ 999.348 µs
    // Buzzer toggling every overflow: freq = 1 / (2 * 0.000999348) ≈ 500.33 Hz
    const TICK_NS = 999_348n; // 999.348 µs in ns

    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.5'] },
    ];
    const nets = [
      { id: 'nb', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BUZZ', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // Toggle pin every TICK_NS (simulating timer overflow handler)
    let t = 0n;
    for (let i = 0; i < 20; i++) {
      board.advanceTo(t);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
      t += TICK_NS;
    }

    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on, 'buzzer should be on');
    // Expected: 1 / (2 * 999348e-9) ≈ 500.33 Hz
    assert.ok(Math.abs(tone.hz - 500.33) < 2,
      `buzzer freq ${tone.hz} should be ≈ 500.33 Hz (timer-accurate)`);
  });

  it('faster toggle → higher frequency', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'BUZZ', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.5'] },
    ];
    const nets = [
      { id: 'nb', terminals: [{ part: 'MCU', terminal: 'P1.5' }, { part: 'BUZZ', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BUZZ', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // Toggle every 100µs → 5 kHz
    let t = 0n;
    for (let i = 0; i < 20; i++) {
      board.advanceTo(t);
      board.setPin('P1.5', 'pushpull', i % 2 === 0);
      t += 100_000n;
    }

    const tone = board.buzzerTone('BUZZ');
    assert.ok(tone.on);
    assert.ok(Math.abs(tone.hz - 5000) < 100, `freq ${tone.hz} should be ~5000 Hz`);
  });
});

describe('timing: RC capacitor precision', () => {
  it('fast RC (1µs time constant) settles in nanoseconds', () => {
    // R=10Ω, C=100nF → RC = 1µs
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0000001 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // After 5 RC = 5µs = 5000ns, should be nearly charged
    board.advanceTo(5_000n);
    const v = board.nodeVoltage('nrc');
    assert.ok(v > 4.9, `cap voltage ${v} should be ≈ 5V after 5 RC`);
  });

  it('slow RC (10s time constant) takes minutes', () => {
    // R=100kΩ, C=100µF → RC = 10s
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // After 1 RC = 10s, should be at ~63%
    board.advanceTo(10_000_000_000n);
    const v = board.nodeVoltage('nrc');
    assert.ok(Math.abs(v - 3.161) < 0.2, `cap voltage ${v} should be ~3.16V at 1RC`);

    // After 1s (0.1 RC), barely started
    const board2 = new BoardImpl(5.0);
    board2.setNetlist(parts, nets);
    board2.advanceTo(1_000_000_000n);
    const v2 = board2.nodeVoltage('nrc');
    assert.ok(v2 < 0.6, `cap voltage ${v2} should be < 0.6V at 0.1RC`);
  });
});

describe('timing: nodeVoltage instrument', () => {
  it('reports VCC and GND correctly', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    assert.equal(board.nodeVoltage('nv'), 5.0);
    assert.equal(board.nodeVoltage('ng'), 0);
  });

  it('tracks pin-driven node voltage changes', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'nm', terminals: [
        { part: 'R1', terminal: 'b' },
        { part: 'R2', terminal: 'a' },
        { part: 'MCU', terminal: 'P1.0' },
      ]},
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];
    board.setNetlist(parts, nets);

    // Input mode: divider gives 2.5V
    board.setPin('P1.0', 'input', false);
    assert.ok(Math.abs(board.nodeVoltage('nm') - 2.5) < 0.01);

    // Push-pull low: pin pulls to GND
    board.setPin('P1.0', 'pushpull', false);
    const vLow = board.nodeVoltage('nm');
    // Norton: VCC/10k from R1 side, 0V/25Ω from pin, 0V/10k from R2
    // I = 5/10000 = 0.5mA, G = 1/10k + 1/10k + 1/25 = 0.0402, V = 0.5mA/0.0402 ≈ 0.0124V
    assert.ok(vLow < 0.05, `push-pull low: ${vLow} should be near 0V`);

    // Push-pull high: pin pulls to VCC
    board.setPin('P1.0', 'pushpull', true);
    const vHigh = board.nodeVoltage('nm');
    assert.ok(vHigh > 4.95, `push-pull high: ${vHigh} should be near 5V`);
  });
});
