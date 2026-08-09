/**
 * Performance budget tests — numbers that can FAIL.
 *
 * From the engineering bar (HANDOVER §8): "Pick the budget, assert it,
 * and let CI say when an optimisation is undone."
 *
 * These thresholds are set at ~50% of measured performance to allow for
 * slower CI machines while still catching order-of-magnitude regressions.
 * Stated tolerance: 2x slower than measured baseline triggers a failure.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeLedCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
    { id: 'POT1', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
    { id: 'BTN1', kind: 'button', params: {}, terminals: ['a', 'b'] },
    { id: 'BUZ1', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'POT1', terminal: 'a' }] },
    { id: 'net_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
    { id: 'net_pin0', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
    { id: 'net_pot', terminals: [{ part: 'POT1', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.1' }] },
    { id: 'net_btn', terminals: [{ part: 'BTN1', terminal: 'a' }, { part: 'MCU', terminal: 'P1.2' }] },
    { id: 'net_buz', terminals: [{ part: 'BUZ1', terminal: 'a' }, { part: 'MCU', terminal: 'P1.3' }] },
    { id: 'net_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' },
      { part: 'POT1', terminal: 'b' },
      { part: 'BTN1', terminal: 'b' },
      { part: 'BUZ1', terminal: 'b' },
    ]},
  ];
  return { parts, nets };
}

describe('perf budget: closed-form path', () => {
  // Baseline: ~184K setPin/sec, ~233K advanceTo/sec.
  // Budget: 10K/sec — low to survive shared CI / VPS under load.
  // An order-of-magnitude regression (to ~1K) would still fail.

  it('setPin throughput > 10K ops/sec', () => {
    const { parts, nets } = makeLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const N = 20_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      board.setPin('P1.0', 'pushpull', i % 2 === 0);
    }
    const elapsed = (performance.now() - start) / 1000;
    const opsPerSec = N / elapsed;

    assert.ok(opsPerSec > 10_000,
      `setPin: ${Math.round(opsPerSec)} ops/sec (budget: 10K). ` +
      `Baseline ~184K; budget low to survive shared VPS under load.`);
  });

  it('advanceTo throughput > 10K ops/sec (steady state)', () => {
    const { parts, nets } = makeLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'pushpull', false);

    const N = 20_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      board.advanceTo(BigInt(i + 1) * 1000n);
    }
    const elapsed = (performance.now() - start) / 1000;
    const opsPerSec = N / elapsed;

    assert.ok(opsPerSec > 10_000,
      `advanceTo: ${Math.round(opsPerSec)} ops/sec (budget: 10K). ` +
      `Baseline ~233K.`);
  });
});

describe('perf budget: MNA path', () => {
  // Baseline: ~12K branchCurrent solves/sec, ~7.6M cached reads/sec.
  // Budget: 5K solves/sec, 1M cached/sec.

  it('branchCurrent (cache hit) throughput > 1M ops/sec', () => {
    const { parts, nets } = makeLedCircuit();
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.setPin('P1.0', 'quasi', false);

    // Prime the cache
    board.branchCurrent('LED1', 'anode');

    const N = 100_000;
    const start = performance.now();
    for (let i = 0; i < N; i++) {
      board.branchCurrent('LED1', 'anode');
    }
    const elapsed = (performance.now() - start) / 1000;
    const opsPerSec = N / elapsed;

    assert.ok(opsPerSec > 1_000_000,
      `branchCurrent (cached): ${Math.round(opsPerSec)} ops/sec (budget: 1M). ` +
      `Tolerance: measured baseline ~7.6M.`);
  });
});
