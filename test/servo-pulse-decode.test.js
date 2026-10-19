/**
 * Verify servo pulse decode: bw-blocks' PCA driver → emu8051 → board → angle.
 *
 * bw-blocks emits a 16-bit compare/match PCA servo driver that toggles P1.3
 * at ISR-computed match points. Expected pulse widths at FOSC=11.0592 MHz:
 *   0°   →  500 µs
 *   90°  → 1500 µs
 *   180° → 2500 µs
 *   Period = 20 ms
 *
 * This test feeds synthetic pin edges at the expected timings and verifies
 * the servo model decodes them to the correct angle.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerServo } from '../src/devices/servo.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerServo(); }
function teardown() { try { unregisterDevice('servo'); } catch {} }

function makeServoCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S1', kind: 'servo',
      params: { minPulseUs: 500, maxPulseUs: 2500, maxAngle: 180, slewRate: 100000 },
      terminals: ['signal', 'vcc', 'gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.3'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'S1', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'S1', terminal: 'gnd' }] },
    { id: 'net_signal', terminals: [{ part: 'MCU', terminal: 'P1.3' }, { part: 'S1', terminal: 'signal' }] },
  ];
  return { parts, nets };
}

/**
 * Generate N servo frames at a given pulse width.
 * Each frame: HIGH for pulseUs, LOW for (20000 - pulseUs).
 */
function driveServo(board, pulseUs, frames) {
  const periodUs = 20000; // 20ms = 50Hz
  let tNs = Number(board.timeNs);

  for (let f = 0; f < frames; f++) {
    // Rising edge
    board.setPin('P1.3', 'pushpull', true);
    tNs += pulseUs * 1000;
    board.advanceTo(BigInt(tNs));

    // Falling edge
    board.setPin('P1.3', 'pushpull', false);
    tNs += (periodUs - pulseUs) * 1000;
    board.advanceTo(BigInt(tNs));
  }
}

describe('servo pulse decode: synthetic edges', () => {
  it('500 µs pulse → 0°', () => {
    setup();
    try {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeServoCircuit();
      board.setNetlist(parts, nets);
      board.setPin('P1.3', 'pushpull', false);
      board.advanceTo(1_000_000n); // 1ms settle

      driveServo(board, 500, 5); // 5 frames at 500µs

      const state = board.getDeviceState('S1');
      console.log(`# 500µs pulse → target=${state.targetAngle.toFixed(1)}° actual=${state.actualAngle.toFixed(1)}°`);
      assert.ok(Math.abs(state.targetAngle - 0) < 5,
        `expected 0°, got ${state.targetAngle.toFixed(1)}°`);
    } finally { teardown(); }
  });

  it('1500 µs pulse → 90°', () => {
    setup();
    try {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeServoCircuit();
      board.setNetlist(parts, nets);
      board.setPin('P1.3', 'pushpull', false);
      board.advanceTo(1_000_000n);

      driveServo(board, 1500, 5);

      const state = board.getDeviceState('S1');
      console.log(`# 1500µs pulse → target=${state.targetAngle.toFixed(1)}° actual=${state.actualAngle.toFixed(1)}°`);
      assert.ok(Math.abs(state.targetAngle - 90) < 5,
        `expected 90°, got ${state.targetAngle.toFixed(1)}°`);
    } finally { teardown(); }
  });

  it('2500 µs pulse → 180°', () => {
    setup();
    try {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeServoCircuit();
      board.setNetlist(parts, nets);
      board.setPin('P1.3', 'pushpull', false);
      board.advanceTo(1_000_000n);

      driveServo(board, 2500, 5);

      const state = board.getDeviceState('S1');
      console.log(`# 2500µs pulse → target=${state.targetAngle.toFixed(1)}° actual=${state.actualAngle.toFixed(1)}°`);
      assert.ok(Math.abs(state.targetAngle - 180) < 5,
        `expected 180°, got ${state.targetAngle.toFixed(1)}°`);
    } finally { teardown(); }
  });

  it('period is ~20ms (50 Hz frame)', () => {
    setup();
    try {
      const board = new BoardImpl(5.0);
      const { parts, nets } = makeServoCircuit();
      board.setNetlist(parts, nets);
      board.setPin('P1.3', 'pushpull', false);
      board.advanceTo(1_000_000n);

      // Drive 10 frames, measure total time
      const t0 = Number(board.timeNs);
      driveServo(board, 1500, 10);
      const elapsed = Number(board.timeNs) - t0;
      const periodMs = elapsed / 1e6 / 10;

      console.log(`# period = ${periodMs.toFixed(2)} ms (expected 20.00)`);
      assert.ok(Math.abs(periodMs - 20) < 0.1,
        `period should be 20ms, got ${periodMs.toFixed(2)}ms`);
    } finally { teardown(); }
  });
});
