/**
 * Multi-pin scripted traces: realistic multi-channel programs with
 * interleaved pin events and assertions at specific times.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { runTrace } from '../src/scripted-mcu.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('trace: LED blink pattern', () => {
  it('alternating blink: LED1 on while LED2 off and vice versa', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'led2', port: 1, bit: 1, direction: 'output', activeLow: true },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Both start off (quasi high)
    board.setPin('P1.0', 'quasi', true);
    board.setPin('P1.1', 'quasi', true);

    const MS = 1_000_000n;
    const failures = runTrace(board, [
      // LED1 on, LED2 off
      { t: 10n * MS, setPin: ['P1.0', 'quasi', false] },
      { t: 35n * MS, expect: { ledBrightness: ['LED_led1', 0.145, 0.02] } },
      { t: 36n * MS, expect: { ledBrightness: ['LED_led2', 0, 0.01] } },

      // Swap: LED1 off, LED2 on
      { t: 37n * MS, setPin: ['P1.0', 'quasi', true] },
      { t: 38n * MS, setPin: ['P1.1', 'quasi', false] },
      { t: 60n * MS, expect: { ledBrightness: ['LED_led1', 0, 0.01] } },
      { t: 61n * MS, expect: { ledBrightness: ['LED_led2', 0.145, 0.02] } },

      // Both on
      { t: 62n * MS, setPin: ['P1.0', 'quasi', false] },
      { t: 85n * MS, expect: { ledBrightness: ['LED_led1', 0.145, 0.02] } },
      { t: 86n * MS, expect: { ledBrightness: ['LED_led2', 0.145, 0.02] } },

      // Both off
      { t: 87n * MS, setPin: ['P1.0', 'quasi', true] },
      { t: 88n * MS, setPin: ['P1.1', 'quasi', true] },
      { t: 110n * MS, expect: { ledBrightness: ['LED_led1', 0, 0.01] } },
      { t: 111n * MS, expect: { ledBrightness: ['LED_led2', 0, 0.01] } },
    ]);

    assert.equal(failures.length, 0,
      failures.map(f => `${f.field}: exp=${f.expected} got=${f.actual}`).join(', '));
  });
});

describe('trace: pot controls buzzer frequency', () => {
  it('different pot positions → different conceptual frequencies', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Sweep pot from 0 to 1 and verify ADC readings
    const readings = [];
    for (let i = 0; i <= 10; i++) {
      const pos = i / 10;
      board.setControl('POT_pot', pos);
      readings.push({ pos, v: board.readAnalog('P1.3') });
    }

    // Verify linearity
    for (const r of readings) {
      const expected = 5.0 * r.pos;
      assert.ok(Math.abs(r.v - expected) < 0.01,
        `pos=${r.pos}: ${r.v} ≈ ${expected}`);
    }

    // Verify monotonicity
    for (let i = 1; i < readings.length; i++) {
      assert.ok(readings[i].v >= readings[i - 1].v,
        `monotonic: ${readings[i - 1].v} ≤ ${readings[i].v}`);
    }
  });
});

describe('trace: button interrupt pattern', () => {
  it('LED stays on until button press, then off', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', true); // LED off initially
    board.setPin('P3.2', 'input', false); // button input

    const MS = 1_000_000n;
    const failures = runTrace(board, [
      // Turn LED on
      { t: 1n * MS, setPin: ['P1.0', 'quasi', false] },
      { t: 25n * MS, expect: { ledBrightness: ['LED_led', 0.145, 0.02] } },

      // Button not pressed → pin = 1
      { t: 26n * MS, expect: { readPin: ['P3.2', 1] } },

      // Press button → pin = 0
      // (The trace itself can't set controls, but we test the readPin assertion)
    ]);

    assert.equal(failures.length, 0,
      failures.map(f => `${f.field}: exp=${f.expected} got=${f.actual}`).join(', '));

    // Now press button outside the trace
    board.setControl('BTN_btn', 1);
    assert.equal(board.readPin('P3.2'), 0, 'button pressed');

    // Program responds: turn off LED
    board.setPin('P1.0', 'quasi', true);
    board.advanceTo(50n * MS);
    assert.ok(board.ledBrightness('LED_led') < 0.01, 'LED off after button');
  });
});

describe('trace: PWM with varying duty', () => {
  it('ramp from 0% to 100% duty', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      ],
    );

    const PERIOD = 1_000_000n; // 1ms
    const steadyB = 0.1449; // steady-state brightness
    let prevBrightness = -1;

    // Run 5 duty levels: 20%, 40%, 60%, 80%, 100%
    for (const dutyPct of [20, 40, 60, 80, 100]) {
      const duty = dutyPct / 100;
      const onNs = BigInt(Math.round(1_000_000 * duty));
      const baseT = BigInt(dutyPct) * 30n * PERIOD; // offset each batch

      // 30 cycles at this duty
      for (let i = 0; i < 30; i++) {
        const t = baseT + BigInt(i) * PERIOD;
        board.advanceTo(t);
        board.setPin('P1.0', 'pushpull', false);
        board.advanceTo(t + onNs);
        board.setPin('P1.0', 'pushpull', true);
      }
      board.advanceTo(baseT + 30n * PERIOD);

      const b = board.ledBrightness('LED1');
      const expectedB = duty * steadyB;

      assert.ok(Math.abs(b - expectedB) < 0.03,
        `${dutyPct}% duty: brightness ${b.toFixed(4)} ≈ ${expectedB.toFixed(4)}`);

      // Each step should be brighter than the last
      assert.ok(b > prevBrightness,
        `${dutyPct}% (${b.toFixed(4)}) > previous (${prevBrightness.toFixed(4)})`);
      prevBrightness = b;
    }
  });
});
