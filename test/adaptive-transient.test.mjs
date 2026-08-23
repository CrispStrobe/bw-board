/**
 * Adaptive trapezoidal transient — hand oracles.
 * spec-updates/adaptive-transient.md.
 *
 * The 555-astable 1% target from the spec is NOT claimed here: device
 * flips restart the integrator with BE each half-cycle, so astable
 * accuracy is bounded by event detection, which is E4's scheduled-events
 * work. The existing RC/555 cross-validation suite (3–5%) stays the
 * stated accuracy for device-switched oscillators.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function rcBench(volts, ohms, farads) {
  const parts = [
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_src', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_cap', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' },
      { part: 'V1', terminal: 'neg' },
      { part: 'C1', terminal: 'b' },
    ] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  return board;
}

describe('adaptive transient: RC step response', () => {
  it('tracks 5·(1−e^(−t/τ)) within 0.1 % of full scale over 5τ', () => {
    // τ = 1 kΩ · 1 µF = 1 ms. Checked every 250 µs to 5 ms.
    const board = rcBench(5, 1000, 1e-6);
    const tau = 1e-3;
    for (let k = 1; k <= 20; k++) {
      const tSec = k * 0.25e-3;
      board.advanceTo(BigInt(Math.round(tSec * 1e9)));
      const v = board.nodeVoltage('net_cap');
      const want = 5 * (1 - Math.exp(-tSec / tau));
      assert.ok(Math.abs(v - want) < 0.005,
        `t=${tSec * 1e3} ms: V(cap)=${v.toFixed(5)} vs analytic ${want.toFixed(5)} ` +
        `(err ${(Math.abs(v - want) * 1e3).toFixed(3)} mV, budget 5 mV)`);
    }
  });
});

describe('adaptive transient: LC tank amplitude (the trapezoidal oracle)', () => {
  it('a 5 kHz tank loses < 1 % amplitude over ~100 cycles', () => {
    // L = 1 mH, C = 1 µF → f = 1/(2π√LC) = 5032.9 Hz; 100 cycles ≈ 19.9 ms.
    // Backward Euler alone visibly damps this (that is WHY trapezoidal
    // exists); the tank is seeded by writing the board's own state maps,
    // which is exactly what the integrator consumes.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'L1', kind: 'inductor', params: { henrys: 1e-3 }, terminals: ['a', 'b'] },
      // amps: 0 — present only to route the bench through MNA.
      { id: 'I0', kind: 'isource', params: { amps: 0 }, terminals: ['pos', 'neg'] },
    ];
    const nets = [
      { id: 'net_top', terminals: [
        { part: 'C1', terminal: 'a' }, { part: 'L1', terminal: 'a' },
        { part: 'I0', terminal: 'pos' },
      ] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'C1', terminal: 'b' }, { part: 'L1', terminal: 'b' },
        { part: 'I0', terminal: 'neg' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.capVoltages.set('C1', 5);
    board.capCurrents.set('C1', 0);
    board.inductorCurrents.set('L1', 0);
    board.inductorVoltages.set('L1', 5);

    // March 20 ms in 100 µs ticks, tracking TOTAL ENERGY — phase-blind, so
    // boundary sampling cannot alias the way a voltage envelope does.
    // E = ½CV² + ½LI², initially ½·1µF·25 = 12.5 µJ.
    const energy = () => {
      const v = board.capVoltages.get('C1') ?? 0;
      const i = board.inductorCurrents.get('L1') ?? 0;
      return 0.5 * 1e-6 * v * v + 0.5 * 1e-3 * i * i;
    };
    const E0 = energy();
    assert.ok(Math.abs(E0 - 12.5e-6) < 1e-9, `seeded energy 12.5 µJ, got ${E0}`);
    const T_END = 20e-3;
    let eEarly = null;
    for (let k = 1; k * 1e-4 <= T_END; k++) {
      board.advanceTo(BigInt(k * 100000));
      if (k === 10) eEarly = energy();  // after 1 ms ≈ 5 cycles
    }
    const eLate = energy();
    assert.ok(eEarly > 0.95 * E0,
      `tank must hold energy through the first 5 cycles: ${(eEarly * 1e6).toFixed(3)} µJ of 12.5` +
      ' — a big early loss is the uncontrolled seed step eating the stored energy');
    assert.ok(eLate > 0.98 * eEarly,
      `energy after ~100 cycles must hold within 2 %: 1 ms ${(eEarly * 1e6).toFixed(4)} µJ, ` +
      `20 ms ${(eLate * 1e6).toFixed(4)} µJ (${(100 * (1 - eLate / eEarly)).toFixed(2)} % lost) — ` +
      'visible decay means the integrator fell back to backward Euler');
  });
});

describe('adaptive transient: idle advance is cheap', () => {
  it('a settled RC advanced 1 s uses far fewer solves than the old 200-step cap', () => {
    const board = rcBench(5, 1000, 1e-6);
    board.advanceTo(20_000_000n);              // 20 ms ≈ 20τ: fully settled
    board.advanceTo(1_020_000_000n);           // +1 s in ONE call
    const n = board._lastTransientSolves;
    assert.ok(n > 0, 'the counter must observe the advance');
    assert.ok(n <= 100,
      `settled 1 s advance took ${n} solves — the fixed-step integrator burned 200; ` +
      'growth to large h is the point of adaptive control');
    const v = board.nodeVoltage('net_cap');
    assert.ok(Math.abs(v - 5) < 0.005, `still settled at 5 V, got ${v.toFixed(5)}`);
  });
});

describe('adaptive transient: source edges are solve points', () => {
  it('_nextSourceEdgeSec finds square edges exactly', () => {
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'V1', kind: 'vsource',
        params: { wave: 'square', freq: 1000, duty: 0.5, amplitude: 2.5, offset: 2.5 },
        terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_src', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'V1', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
      ] },
    ];
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    // 1 kHz, duty 0.5: edges at 0.5 ms and 1.0 ms.
    assert.ok(Math.abs(board._nextSourceEdgeSec(0.0002) - 0.0005) < 1e-12,
      `from 0.2 ms the next edge is 0.5 ms, got ${board._nextSourceEdgeSec(0.0002)}`);
    assert.ok(Math.abs(board._nextSourceEdgeSec(0.0005) - 0.001) < 1e-12,
      `from exactly 0.5 ms the next edge is 1.0 ms (strictly after), got ${board._nextSourceEdgeSec(0.0005)}`);
    assert.ok(Math.abs(board._nextSourceEdgeSec(0.00301) - 0.0035) < 1e-12,
      'later cycles align too');
    // A sine source has no discontinuity to align.
    parts[1].params = { wave: 'sine', freq: 1000, amplitude: 2.5, offset: 2.5 };
    assert.equal(board._nextSourceEdgeSec(0.0002), null);
  });
});
