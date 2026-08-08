/**
 * Firmware-realistic trace tests: simulate the kind of pin activity
 * a real 8051 firmware produces — many rapid setPin calls at
 * clock-cycle granularity, interleaved with timer-driven events.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('firmware trace: blink at FOSC/12 timer rate', () => {
  it('1ms timer interrupt toggles LED 500 times', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Simulate: timer ISR fires every 1ms, toggles P1.0
    // FOSC=11059200, FOSC/12=921600 Hz, timer tick = 1.0851µs
    // Timer reload for 1ms: 921 ticks → 999.348µs
    const TICK_NS = 999_348n;

    board.setPin('P1.0', 'quasi', true); // start off

    for (let i = 0; i < 500; i++) {
      const t = BigInt(i) * TICK_NS;
      board.advanceTo(t);
      board.setPin('P1.0', 'quasi', i % 2 === 0);
    }
    board.advanceTo(500n * TICK_NS);

    // After 500 toggles at ~1ms each: ~250ms of 50% duty
    const b = board.ledBrightness('LED_led');
    // 50% duty → ~half of steady brightness
    assert.ok(b > 0.05, `brightness ${b} should be ~50% of steady`);
    assert.ok(b < 0.10, `brightness ${b} should be ~50% of steady`);
  });
});

describe('firmware trace: ADC + LED feedback loop', () => {
  it('pot position controls LED brightness via PWM duty', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Simulate: program reads pot, sets PWM duty proportionally
    // Pot at 75% → 3.75V → ADC ≈ 768 → 75% duty
    board.setControl('POT_pot', 0.75);
    const potV = board.readAnalog('P1.3');
    const duty = potV / 5.0; // 0.75

    const PERIOD_NS = 1_000_000n; // 1ms PWM period
    const onNs = BigInt(Math.round(Number(PERIOD_NS) * duty));

    for (let i = 0; i < 30; i++) {
      const t = BigInt(i) * PERIOD_NS;
      board.advanceTo(t);
      board.setPin('P1.0', 'quasi', false); // on
      board.advanceTo(t + onNs);
      board.setPin('P1.0', 'quasi', true); // off
    }
    board.advanceTo(30n * PERIOD_NS);

    const b = board.ledBrightness('LED_led');
    // 75% duty × steady brightness ≈ 0.75 × 0.145 ≈ 0.109
    assert.ok(b > 0.08, `75% duty brightness: ${b}`);
    assert.ok(b < 0.13, `75% duty brightness: ${b}`);
  });
});

describe('firmware trace: multi-channel simultaneous', () => {
  it('LED + buzzer + button in one simulation loop', () => {
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
        { name: 'buzzer', port: 1, bit: 5, direction: 'output', activeLow: false },
        { name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false },
      ],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', true);
    board.setPin('P1.3', 'input', false);
    board.setPin('P1.5', 'pushpull', false);
    board.setPin('P3.2', 'input', false);
    board.setControl('POT_pot', 0.5);

    const MS = 1_000_000n;

    // Simulate 100ms of firmware:
    // - LED blinks at 10Hz (50ms on, 50ms off)
    // - Buzzer toggles at 1kHz (0.5ms half-period)
    // - Button pressed at 30ms, released at 70ms
    for (let usec = 0; usec < 100000; usec += 500) {
      const t = BigInt(usec) * 1000n;
      board.advanceTo(t);

      // LED: 10Hz blink
      const ledPhase = (usec / 1000) % 100;
      board.setPin('P1.0', 'quasi', ledPhase >= 50);

      // Buzzer: 1kHz toggle
      // inferNetlist creates LED for output pins, not buzzer,
      // so this just exercises the pin toggle path
      board.setPin('P1.5', 'pushpull', (usec / 500) % 2 === 0);

      // Button: pressed 30-70ms
      const ms = usec / 1000;
      board.setControl('BTN_btn', ms >= 30 && ms < 70 ? 1 : 0);
    }
    board.advanceTo(100n * MS);

    // Verify final state
    const state = board.getRenderState();
    assert.equal(state.powered, true);
    assert.ok(state.leds.length > 0);
    assert.ok(state.controls.length > 0);
    assert.ok(state.pins.length > 0);

    // Button should be released
    assert.equal(board.readPin('P3.2'), 1, 'button released');

    // Pot should still read correctly
    assert.ok(Math.abs(board.readAnalog('P1.3') - 2.5) < 0.1, 'pot at midpoint');
  });
});

describe('firmware trace: getRenderState during simulation', () => {
  it('getRenderState is callable at any point', () => {
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);

    // Call getRenderState at multiple points during simulation
    for (let i = 0; i < 50; i++) {
      board.advanceTo(BigInt(i) * 1_000_000n);
      if (i % 2 === 0) board.setPin('P1.0', 'quasi', false);
      else board.setPin('P1.0', 'quasi', true);

      const state = board.getRenderState();
      assert.ok(!Number.isNaN(state.vcc));
      assert.ok(state.leds.every(l => !Number.isNaN(l.brightness)));
      assert.ok(state.nodeVoltages.every(n => !Number.isNaN(n.voltage)));
    }
  });
});
