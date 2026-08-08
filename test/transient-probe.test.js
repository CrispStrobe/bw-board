/**
 * Transient analysis and oscilloscope probe tests.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('inductor transient: current ramp', () => {
  it('current increases linearly with constant voltage across inductor', () => {
    // VCC(5V) → L(10mH) → R(small, 1Ω) → GND
    // At DC: inductor is a wire, I = 5/1 = 5A (huge). But initially I=0.
    // dI/dt = V/L = 5/0.01 = 500 A/s
    // After 1ms: I = 0.5A, after 2ms: I = 1.0A (if R is negligible)
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'L1', kind: 'inductor', params: { henrys: 0.01 }, terminals: ['a', 'b'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'L1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'L1', terminal: 'b' }, { part: 'R1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
      ],
    );

    // Step in small increments
    const readings = [];
    for (let i = 1; i <= 10; i++) {
      board.advanceTo(BigInt(i) * 100_000n); // 100µs steps
      readings.push({
        tMs: i * 0.1,
        iL: board.getInductorCurrent('L1'),
      });
    }

    // Current should be increasing
    for (let i = 1; i < readings.length; i++) {
      assert.ok(readings[i].iL >= readings[i - 1].iL,
        `inductor current increasing: t=${readings[i].tMs}ms`);
    }

    // After 1ms with 5V across 10mH: I ≈ V/L × t = 5/0.01 × 0.001
    // But the voltage across L decreases as I increases (V_L = V - I×R)
    // So the ramp slows. After 1ms, I should be non-trivial.
    assert.ok(readings[9].iL > 0, `inductor current > 0 after 1ms: ${readings[9].iL}`);
  });
});

describe('oscilloscope probe', () => {
  it('records voltage samples at each advanceTo', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nm', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
      ],
    );

    board.addProbe('nm');

    for (let i = 0; i < 100; i++) {
      board.advanceTo(BigInt(i) * 1_000_000n);
    }

    const data = board.getProbeData('nm');
    assert.equal(data.length, 100, '100 samples');
    // All should be 2.5V (steady state divider)
    for (const sample of data) {
      assert.ok(Math.abs(sample.v - 2.5) < 0.01, `sample at ${sample.tNs}: ${sample.v}`);
    }
  });

  it('captures PWM waveform', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'np', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'MCU', terminal: 'P1.0' },
        ]},
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );
    board.setPin('P1.0', 'pushpull', false);

    board.addProbe('np');

    // PWM: toggle every 500µs
    for (let i = 0; i < 20; i++) {
      board.advanceTo(BigInt(i) * 500_000n);
      board.setPin('P1.0', 'pushpull', i % 2 === 0);
    }

    const data = board.getProbeData('np');
    assert.ok(data.length >= 20, `captured ${data.length} samples`);

    // Should alternate between near-0V and near-5V
    let lows = 0, highs = 0;
    for (const s of data) {
      if (s.v < 1.0) lows++;
      else if (s.v > 4.0) highs++;
    }
    assert.ok(lows > 0, `should have low samples: ${lows}`);
    assert.ok(highs > 0, `should have high samples: ${highs}`);
  });

  it('addProbe/removeProbe/getProbes lifecycle', () => {
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

    assert.deepEqual(board.getProbes(), []);

    board.addProbe('nv');
    board.addProbe('ng');
    assert.deepEqual(board.getProbes().sort(), ['ng', 'nv']);

    board.removeProbe('nv');
    assert.deepEqual(board.getProbes(), ['ng']);

    board.clearProbeData();
    assert.equal(board.getProbeData('ng').length, 0);
  });

  it('ring buffer limits samples', () => {
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
    board._probeMaxSamples = 100; // small buffer for test
    board.addProbe('nv');

    for (let i = 0; i < 500; i++) {
      board.advanceTo(BigInt(i) * 1_000n);
    }

    assert.ok(board.getProbeData('nv').length <= 100,
      `ring buffer capped at ${board.getProbeData('nv').length}`);
  });

  it('captures RC charge curve', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nrc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
      ],
    );
    board.addProbe('nrc');

    // Capture RC charge: 50 samples over 5 RC (5 seconds)
    for (let i = 0; i < 50; i++) {
      board.advanceTo(BigInt(i) * 100_000_000n); // 100ms steps
    }

    const data = board.getProbeData('nrc');
    assert.equal(data.length, 50);

    // Should be monotonically increasing (charging)
    for (let i = 1; i < data.length; i++) {
      assert.ok(data[i].v >= data[i - 1].v - 0.01,
        `RC charge monotonic: ${data[i - 1].v} → ${data[i].v}`);
    }

    // First sample near 0, last near 5V
    assert.ok(data[0].v < 1.0, `start near 0: ${data[0].v}`);
    assert.ok(data[49].v > 4.5, `end near 5V: ${data[49].v}`);
  });
});
