/**
 * Regression: advanceTo must run device updates.
 *
 * The bug: advanceTo never called _updateDevices(), so timed device
 * transitions (relay switch delay, motor spin-up, servo travel) only
 * fired when a pin event happened to poke the network.
 *
 * The test: advance time in ONE call spanning the deadline, with NO
 * pin activity, and assert the transition happened.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerRelay } from '../src/devices/relay.js';
import { registerSensors } from '../src/devices/sensors.js';
import { registerMiscParts } from '../src/devices/misc-parts.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerRelay(); registerSensors(); registerMiscParts(); }
function teardown() {
  try { unregisterDevice('relay'); } catch {}
  try { unregisterDevice('ultrasonic'); } catch {}
  try { unregisterDevice('dc_motor_encoder'); } catch {}
  try { unregisterDevice('keypad_4x4'); } catch {}
  try { unregisterDevice('dip_switch'); } catch {}
  try { unregisterDevice('vibration_motor'); } catch {}
  try { unregisterDevice('polarized_cap'); } catch {}
}

describe('advanceTo runs device updates: relay', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('relay energises after 5ms deadline with NO pin activity', () => {
    // Circuit: VCC across relay coil (5V > 3.7V pull-in threshold).
    // Relay has 5ms switching delay.
    // After setNetlist, the coil sees 5V immediately. But the relay
    // should not energise until advanceTo crosses the 5ms deadline.
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'K1', kind: 'relay', params: { coilR: 200, pullInV: 3.7, dropOutV: 1.5, switchTimeMs: 5 },
        terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'K1', terminal: 'coil_a' },
        { part: 'R1', terminal: 'a' },
      ]},
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'K1', terminal: 'coil_b' },
      ]},
      { id: 'net_no', terminals: [
        { part: 'K1', terminal: 'no' },
        { part: 'R1', terminal: 'b' },
      ]},
      { id: 'net_com', terminals: [{ part: 'K1', terminal: 'com' }] },
      { id: 'net_nc', terminals: [{ part: 'K1', terminal: 'nc' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // At t=0: coil sees 5V but relay has 5ms delay. Not yet energised.
    const state0 = board.getDeviceState('K1');
    assert.equal(state0.energized, false, 'relay should not be energised at t=0');

    // Advance past the deadline in ONE call. No setPin, no setControl.
    board.advanceTo(10_000_000n); // 10ms > 5ms deadline

    const state10 = board.getDeviceState('K1');
    assert.equal(state10.energized, true,
      'relay MUST be energised after advanceTo(10ms) — deadline was 5ms');
  });

  it('relay with instant switching (0ms delay) energises on first advanceTo', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'K1', kind: 'relay', params: { coilR: 200, pullInV: 3.7, dropOutV: 1.5, switchTimeMs: 0 },
        terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'K1', terminal: 'coil_a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'K1', terminal: 'coil_b' }] },
      { id: 'net_com', terminals: [{ part: 'K1', terminal: 'com' }] },
      { id: 'net_nc', terminals: [{ part: 'K1', terminal: 'nc' }] },
      { id: 'net_no', terminals: [{ part: 'K1', terminal: 'no' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    board.advanceTo(1_000_000n); // 1ms

    const state = board.getDeviceState('K1');
    assert.equal(state.energized, true, 'instant relay should energise on first advanceTo');
  });
});

describe('advanceTo runs device updates: ultrasonic echo', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('echo pulse ends after distance-based timeout via advanceTo only', () => {
    // Distance = 10cm → echo = 10*58 = 580µs
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'US1', kind: 'ultrasonic', params: { distance: 10 },
        terminals: ['vcc', 'gnd', 'trig', 'echo'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'US1', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'US1', terminal: 'gnd' }] },
      { id: 'net_trig', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'US1', terminal: 'trig' }] },
      { id: 'net_echo', terminals: [{ part: 'US1', terminal: 'echo' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // Trigger pulse
    board.setPin('P1.0', 'pushpull', true);
    board.advanceTo(10_000n); // 10µs trigger
    board.setPin('P1.0', 'pushpull', false);

    // Echo should be HIGH now (measuring)
    const echoV = board.nodeVoltage('net_echo');
    assert.ok(echoV > 3.0, `echo should be HIGH during measurement, got ${echoV.toFixed(3)}V`);

    // Advance past echo duration (580µs) with NO pin activity
    board.advanceTo(700_000n); // 700µs > 580µs

    // Echo should be LOW now
    const echoV2 = board.nodeVoltage('net_echo');
    assert.ok(echoV2 < 1.0, `echo should be LOW after timeout, got ${echoV2.toFixed(3)}V`);
  });
});

describe('advanceTo sub-stepping: encoder edge counting', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('encoder counts multiple edges across a single large advanceTo', () => {
    // A motor encoder with 20 pulses/rev. If the motor spins at a speed
    // that produces edges at ~1ms intervals and we jump 50ms in one call,
    // it must count ~50 edges, not 1.
    //
    // Motor params: V=5V, R=10Ω, kV=0.01 → steady-state ω=500 rad/s.
    // With J=1e-7 (very light), it reaches near-steady in <1ms.
    // 20 ppr × 4 edges = 80 edges/rev. At 500 rad/s = ~79.6 rev/s → ~6366 edges/s.
    // In 50ms: ~318 edges. The sub-step at 1ms intervals gives 50 updates.
    // Each update advances the angle, which should produce multiple encoder slots.
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'M1', kind: 'dc_motor_encoder',
        params: { windingR: 10, kV: 0.01, J: 1e-7, pulsesPerRev: 20 },
        terminals: ['a', 'b', 'enc_a', 'enc_b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'M1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'M1', terminal: 'b' }] },
      { id: 'net_enc_a', terminals: [{ part: 'M1', terminal: 'enc_a' }] },
      { id: 'net_enc_b', terminals: [{ part: 'M1', terminal: 'enc_b' }] },
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    // One large jump: 50ms
    board.advanceTo(50_000_000n);

    const state = board.getDeviceState('M1');
    // The motor should have spun significantly. With sub-stepping at 1ms,
    // the encoder should have counted many edges (angle accumulates each step).
    // At near-steady 500 rad/s for 50ms: angle ≈ 25 radians ≈ 4 revolutions.
    // With 20 ppr × 4 edges: 4 rev × 80 edges/rev = ~320 edges (slot changes).
    // Even with startup transient, must be > 10 to prove sub-stepping worked.
    // If the bug were still present (single update), _lastSlot would advance
    // by at most 1.
    assert.ok(state.angle > 5,
      `encoder angle should be > 5 rad after 50ms at 5V, got ${state.angle.toFixed(2)} rad`);
    assert.ok(state.omega > 100,
      `motor should be spinning fast, got ω=${state.omega.toFixed(1)} rad/s`);
  });
});
