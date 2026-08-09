/**
 * Scope channel tests — fixed cadence, (min,max) decimation, current channels.
 *
 * Hand-computed oracles for voltage dividers and PWM envelopes.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeLedCircuit() {
  // VCC → 1kΩ → LED → MCU pin P1.0 → (GND via pin sink)
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'net_pin', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
  ];
  return { parts, nets };
}

function makeSimpleResistor() {
  // VCC → 10kΩ → MCU pin (quasi high = 21.7kΩ pull-up to VCC)
  // Both pull to VCC, so net_pin ≈ VCC
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_pin', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
  ];
  return { parts, nets };
}

// ─── Channel lifecycle ──────────────────────────────────────────────────

describe('scope channels: lifecycle', () => {
  it('addScopeChannel returns a handle, getScopeChannels lists it', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_pin' });
    assert.equal(typeof ch, 'number');
    assert.deepEqual(board.getScopeChannels(), [ch]);
  });

  it('removeScopeChannel removes it', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_pin' });
    board.removeScopeChannel(ch);
    assert.deepEqual(board.getScopeChannels(), []);
    assert.equal(board.getScopeData(ch), null);
  });

  it('clearScopeChannels removes all', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    board.addScopeChannel({ type: 'voltage', netId: 'net_pin' });
    board.addScopeChannel({ type: 'voltage', netId: 'net_vcc' });
    board.clearScopeChannels();
    assert.deepEqual(board.getScopeChannels(), []);
  });

  it('getScopeData returns structure with typed array', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_pin', depth: 1024 });
    const data = board.getScopeData(ch);
    assert.ok(data);
    assert.ok(data.samples instanceof Float64Array);
    assert.equal(data.samples.length, 1024 * 2); // depth * 2 for min/max
    assert.equal(data.channelType, 'voltage');
    assert.equal(typeof data.sampleIntervalNs, 'bigint');
  });

  it('unwritten buffer regions are NaN, not 0', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_pin', depth: 100 });
    const data = board.getScopeData(ch);

    // Before any advanceTo, all samples should be NaN
    assert.ok(Number.isNaN(data.samples[0]), 'unwritten min should be NaN');
    assert.ok(Number.isNaN(data.samples[1]), 'unwritten max should be NaN');
    assert.ok(Number.isNaN(data.samples[198]), 'last unwritten min should be NaN');
    assert.ok(Number.isNaN(data.samples[199]), 'last unwritten max should be NaN');
  });
});

// ─── Voltage sampling at fixed cadence ──────────────────────────────────

describe('scope channels: voltage sampling', () => {
  it('samples at configured rate, not per-advanceTo', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true); // pin at ~VCC

    // 10 kHz sample rate = 100µs interval = 100_000 ns
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_pin',
      sampleRateHz: 10_000, depth: 100,
    });

    // Advance 500µs = 5 sample intervals. Should get 5 samples.
    board.advanceTo(500_000n);

    const data = board.getScopeData(ch);
    assert.equal(data.count, 5, 'exactly 5 samples at 10kHz over 500µs');
  });

  it('records correct voltage value', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_pin',
      sampleRateHz: 10_000, depth: 100,
    });

    board.advanceTo(200_000n); // 2 samples
    const data = board.getScopeData(ch);

    // Pin at VCC with 10kΩ pull-up also to VCC → net_pin ≈ 5.0V
    const min0 = data.samples[0];
    const max0 = data.samples[1];
    assert.ok(min0 >= 4.9, `min should be ~5V, got ${min0}`);
    assert.ok(max0 <= 5.1, `max should be ~5V, got ${max0}`);
  });

  it('captures min/max from PWM within a bucket', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    // Low sample rate so one bucket spans multiple pin changes
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_pin',
      sampleRateHz: 1_000, // 1kHz = 1ms per bucket
      depth: 100,
    });

    // PWM: toggle pin within one 1ms bucket
    board.setPin('P1.0', 'pushpull', true);  // high
    board.advanceTo(200_000n);                // 0.2ms
    board.setPin('P1.0', 'pushpull', false); // low — voltage drops
    board.advanceTo(500_000n);                // 0.5ms
    board.setPin('P1.0', 'pushpull', true);  // high again
    board.advanceTo(1_100_000n);              // past 1ms → flushes bucket

    const data = board.getScopeData(ch);
    assert.ok(data.count >= 1, 'at least one sample flushed');

    // The first bucket should have captured both high and low voltages
    const min0 = data.samples[0];
    const max0 = data.samples[1];
    // Push-pull high: pin ≈ VCC. Push-pull low: pin ≈ 0V (25Ω to GND vs 10kΩ to VCC)
    // min should be near 0, max should be near 5
    assert.ok(min0 < 0.5, `min should capture low voltage, got ${min0}`);
    assert.ok(max0 > 4.5, `max should capture high voltage, got ${max0}`);
  });

  it('ring buffer wraps at depth', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', true);

    const depth = 4;
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_pin',
      sampleRateHz: 10_000, depth,
    });

    // Write 6 samples into a depth-4 buffer → 2 should be overwritten
    board.advanceTo(600_000n); // 6 × 100µs

    const data = board.getScopeData(ch);
    assert.equal(data.count, 6, '6 total writes');
    // writeIndex wraps: 6 % 4 = 2
    assert.equal(data.writeIndex, 2);
  });

  it('sampleIntervalNs matches configured rate', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_pin',
      sampleRateHz: 50_000,
    });

    const data = board.getScopeData(ch);
    // 50 kHz = 20µs = 20_000 ns
    assert.equal(data.sampleIntervalNs, 20_000n);
  });
});

// ─── Current channels ───────────────────────────────────────────────────

describe('scope channels: current', () => {
  it('sampleCurrentChannels returns current for current-type channels', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLedCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false); // LED on (active-low)
    board.advanceTo(1_000_000n);

    const ch = board.addScopeChannel({
      type: 'current', partId: 'LED1', terminal: 'anode',
    });

    const results = board.sampleCurrentChannels();
    assert.ok(results.has(ch));
    const current = results.get(ch);
    assert.ok(current > 0, `LED should have positive current, got ${current}`);
  });

  it('sampleCurrentChannels does not sample voltage channels', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const vCh = board.addScopeChannel({ type: 'voltage', netId: 'net_pin' });
    const results = board.sampleCurrentChannels();
    assert.ok(!results.has(vCh), 'voltage channel not in current results');
  });

  it('current channel writes into ring buffer', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeLedCircuit();
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);

    const ch = board.addScopeChannel({
      type: 'current', partId: 'LED1', terminal: 'anode', depth: 16,
    });

    // Sample 3 times
    board.sampleCurrentChannels();
    board.sampleCurrentChannels();
    board.sampleCurrentChannels();

    const data = board.getScopeData(ch);
    assert.equal(data.count, 3);
    assert.equal(data.writeIndex, 3);
    // For current, min=max=current at each sample
    assert.equal(data.samples[0], data.samples[1], 'min=max for point sample');
  });
});

// ─── Defaults ───────────────────────────────────────────────────────────

describe('scope channels: defaults', () => {
  it('default sample rate is 100 kHz', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_pin' });
    const data = board.getScopeData(ch);
    // 100 kHz = 10µs = 10_000 ns
    assert.equal(data.sampleIntervalNs, 10_000n);
  });

  it('default depth is 8192', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeSimpleResistor();
    board.setNetlist(parts, nets);

    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_pin' });
    const data = board.getScopeData(ch);
    assert.equal(data.samples.length, 8192 * 2);
  });
});
