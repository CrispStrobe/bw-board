/**
 * Test: PWM duty cycle → LED brightness.
 *
 * A push-pull pin toggling at 1 kHz with 50% duty should produce
 * ~50% of the steady-state brightness. The 20ms integration window
 * covers 20 full cycles at 1 kHz, so the average is clean.
 *
 * Active-low circuit: VCC → 1kΩ → LED → pin.
 * Pin=0 → LED on (I ≈ 2.899 mA, brightness ≈ 0.1449).
 * Pin=1 → LED off.
 * 50% duty → brightness ≈ 0.0725.
 * 25% duty (pin=0 for 250µs, pin=1 for 750µs) → brightness ≈ 0.0362.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeActiveLowCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_r_led', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'net_led_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
  ];
  return { parts, nets };
}

/**
 * Toggle a pin for N cycles at the given period and duty cycle.
 * Active-low: pin=0 means LED on.
 */
function pwmCycles(board, pin, startNs, periodNs, dutyCycle, cycles) {
  const onTimeNs = BigInt(Math.round(Number(periodNs) * dutyCycle));
  const offTimeNs = periodNs - onTimeNs;
  let t = startNs;

  for (let i = 0; i < cycles; i++) {
    // ON phase: advance time to start of period, then set pin low (LED on)
    board.advanceTo(t);
    board.setPin(pin, 'pushpull', false);
    t += onTimeNs;

    // OFF phase: advance to end of ON, then set pin high (LED off)
    board.advanceTo(t);
    board.setPin(pin, 'pushpull', true);
    t += offTimeNs;
  }

  // Final advance to record the last sample
  board.advanceTo(t);
  return t;
}

describe('PWM duty → LED brightness', () => {
  it('50% duty at 1 kHz → ~50% of steady brightness', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    // Run 30 cycles at 1 kHz (30 ms) to fill the 20ms window
    const periodNs = 1_000_000n; // 1 ms = 1 kHz
    pwmCycles(board, 'P1.0', 0n, periodNs, 0.5, 30);

    const brightness = board.ledBrightness('LED1');
    // Steady state brightness ≈ 0.1449, 50% duty → ~0.0725
    assert.ok(brightness > 0.06, `brightness ${brightness} should be > 0.06`);
    assert.ok(brightness < 0.09, `brightness ${brightness} should be < 0.09`);
  });

  it('25% duty at 1 kHz → ~25% of steady brightness', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    const periodNs = 1_000_000n;
    pwmCycles(board, 'P1.0', 0n, periodNs, 0.25, 30);

    const brightness = board.ledBrightness('LED1');
    // 25% duty → ~0.0362
    assert.ok(brightness > 0.025, `brightness ${brightness} should be > 0.025`);
    assert.ok(brightness < 0.05, `brightness ${brightness} should be < 0.05`);
  });

  it('100% duty → full steady brightness', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    // Pin always low (LED always on)
    board.setPin('P1.0', 'pushpull', false);
    board.advanceTo(30_000_000n);

    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness > 0.13, `brightness ${brightness} should be > 0.13`);
    assert.ok(brightness < 0.16, `brightness ${brightness} should be < 0.16`);
  });

  it('0% duty → zero brightness', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeActiveLowCircuit();
    board.setNetlist(parts, nets);

    // Pin always high (LED always off)
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(30_000_000n);

    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness < 0.01, `brightness ${brightness} should be ≈ 0`);
  });
});
