/**
 * 555 timer device model tests.
 *
 * Oracle: astable mode — R1=10kΩ, R2=10kΩ, C=10µF.
 * Charge time: t1 = 0.693 * (R1+R2) * C = 0.693 * 20000 * 10e-6 = 138.6ms
 * Discharge time: t2 = 0.693 * R2 * C = 0.693 * 10000 * 10e-6 = 69.3ms
 * Period: T = 207.9ms, Frequency: 4.81 Hz, Duty: 66.7%
 *
 * Cap voltage oscillates between 1/3 VCC (1.667V) and 2/3 VCC (3.333V).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerTimer555 } from '../src/devices/timer-555.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerTimer555(); }
function teardown() { try { unregisterDevice('timer_555'); } catch {} }

/**
 * Classic 555 astable: VCC → R1 → discharge/threshold → R2 → cap → GND.
 * Trigger tied to threshold. Output on the output pin.
 */
function makeAstableCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'timer_555', params: { rOut: 50 },
      terminals: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 }, terminals: ['a', 'b'] },
    { id: 'R_LOAD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ];

  const nets = [
    { id: 'net_vcc', terminals: [
      { part: 'VCC', terminal: 'vcc' },
      { part: 'U1', terminal: 'vcc' },
      { part: 'R1', terminal: 'a' },
      { part: 'U1', terminal: 'reset' }, // reset tied HIGH
    ]},
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' },
      { part: 'U1', terminal: 'gnd' },
      { part: 'C1', terminal: 'b' },
      { part: 'R_LOAD', terminal: 'b' },
    ]},
    // R1 output → discharge pin + R2 input
    { id: 'net_disch', terminals: [
      { part: 'R1', terminal: 'b' },
      { part: 'U1', terminal: 'discharge' },
      { part: 'R2', terminal: 'a' },
    ]},
    // R2 output → threshold + trigger + cap
    { id: 'net_cap', terminals: [
      { part: 'R2', terminal: 'b' },
      { part: 'U1', terminal: 'threshold' },
      { part: 'U1', terminal: 'trigger' },
      { part: 'C1', terminal: 'a' },
    ]},
    // Control pin: leave floating (internal divider sets 2/3 VCC)
    { id: 'net_ctrl', terminals: [
      { part: 'U1', terminal: 'control' },
    ]},
    // Output through load resistor
    { id: 'net_out', terminals: [
      { part: 'U1', terminal: 'output' },
      { part: 'R_LOAD', terminal: 'a' },
    ]},
  ];

  return { parts, nets };
}

describe('555 timer: astable oscillator', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('oscillates — output toggles multiple times over 1 second', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeAstableCircuit();
    board.setNetlist(parts, nets);

    // Run for 1 second in 1ms steps
    let flips = 0;
    let lastOut = board.nodeVoltage('net_out') > 2.5 ? 1 : 0;

    for (let ms = 1; ms <= 1000; ms++) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
      const out = board.nodeVoltage('net_out') > 2.5 ? 1 : 0;
      if (out !== lastOut) { flips++; lastOut = out; }
    }

    // Expected: ~4.81 Hz = ~9.6 flips/sec over 1 second.
    // Sub-step quantization and startup transient lose some.
    // Must oscillate — 0 flips or 1 flip is the failure mode.
    assert.ok(flips >= 4, `expected oscillation (>=4 flips), got ${flips}`);
    assert.ok(flips <= 20, `too many flips (${flips}) — possible instability`);
  });

  it('cap voltage stays between thresholds once oscillating', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeAstableCircuit();
    board.setNetlist(parts, nets);

    // Skip startup (first 500ms) then check the cap voltage range
    for (let ms = 1; ms <= 500; ms++) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
    }

    let vMin = 5, vMax = 0;
    for (let ms = 501; ms <= 1000; ms++) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
      const vc = board.nodeVoltage('net_cap');
      if (vc < vMin) vMin = vc;
      if (vc > vMax) vMax = vc;
    }

    // Cap should oscillate between ~1/3 VCC (1.667) and ~2/3 VCC (3.333).
    // Allow some tolerance for sub-step quantization.
    assert.ok(vMin > 1.0, `cap vMin should be > 1V (near 1/3 VCC), got ${vMin.toFixed(3)}`);
    assert.ok(vMin < 2.5, `cap vMin should be < 2.5V, got ${vMin.toFixed(3)}`);
    assert.ok(vMax > 2.5, `cap vMax should be > 2.5V, got ${vMax.toFixed(3)}`);
    assert.ok(vMax < 4.5, `cap vMax should be < 4.5V (near 2/3 VCC), got ${vMax.toFixed(3)}`);
  });

  it('frequency within 2x of theoretical 4.81 Hz', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeAstableCircuit();
    board.setNetlist(parts, nets);

    // Count full cycles over 2 seconds
    let flips = 0;
    let lastOut = 0;
    const startMs = 200; // skip startup

    for (let ms = 1; ms <= 2000; ms++) {
      board.advanceTo(BigInt(ms) * 1_000_000n);
      const out = board.nodeVoltage('net_out') > 2.5 ? 1 : 0;
      if (ms >= startMs && out !== lastOut) flips++;
      lastOut = out;
    }

    // Each full cycle = 2 flips. Over 1.8s (2000-200ms): ~4.81 Hz * 1.8 = 8.66 cycles = ~17 flips.
    // Tolerance: 2x either direction (quantization, startup effects).
    const measuredHz = (flips / 2) / 1.8;
    assert.ok(measuredHz > 2.0,
      `frequency should be > 2 Hz (theoretical 4.81), got ${measuredHz.toFixed(2)} Hz (${flips} flips)`);
    assert.ok(measuredHz < 12.0,
      `frequency should be < 12 Hz, got ${measuredHz.toFixed(2)} Hz`);
  });
});

describe('555 timer: monostable basics', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('output starts LOW with trigger above threshold', () => {
    // Simple setup: trigger held HIGH, threshold at 0 (cap discharged)
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'U1', kind: 'timer_555', params: { rOut: 50 },
        terminals: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'] },
      { id: 'R_LOAD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_vcc', terminals: [
        { part: 'VCC', terminal: 'vcc' },
        { part: 'U1', terminal: 'vcc' },
        { part: 'U1', terminal: 'reset' },
        { part: 'U1', terminal: 'trigger' }, // trigger HIGH — not triggered
      ]},
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'U1', terminal: 'gnd' },
        { part: 'U1', terminal: 'threshold' }, // threshold at 0V
        { part: 'U1', terminal: 'discharge' },
        { part: 'R_LOAD', terminal: 'b' },
      ]},
      { id: 'net_ctrl', terminals: [{ part: 'U1', terminal: 'control' }] },
      { id: 'net_out', terminals: [
        { part: 'U1', terminal: 'output' },
        { part: 'R_LOAD', terminal: 'a' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(1_000_000n);

    // With trigger HIGH and threshold at 0 (< 2/3 VCC), the flip-flop
    // should be in its initial state (LOW output from init).
    const vOut = board.nodeVoltage('net_out');
    assert.ok(vOut < 1.0, `output should be LOW (trigger not active), got ${vOut.toFixed(3)}V`);
  });
});
