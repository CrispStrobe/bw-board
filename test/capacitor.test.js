/**
 * Test: capacitor RC charging.
 *
 * Circuit: VCC (5V) → 10kΩ → node → 100µF cap → GND
 *
 * RC = 10000 × 0.0001 = 1.0 seconds
 *
 * Hand-computed:
 *   V(t) = VCC × (1 − e^(−t/RC))
 *   At t = 1 RC (1.0s): V = 5 × (1 − e^(−1)) = 5 × 0.6321 = 3.161 V
 *   At t = 2 RC (2.0s): V = 5 × (1 − e^(−2)) = 5 × 0.8647 = 4.323 V
 *   At t = 5 RC (5.0s): V = 5 × (1 − e^(−5)) = 5 × 0.9933 = 4.966 V
 *   At t = 0.1 RC (0.1s): V = 5 × (1 − e^(−0.1)) = 5 × 0.0952 = 0.476 V
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

function makeRCCircuit() {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: 0.0001 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_rc', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
  ];
  return { parts, nets };
}

describe('capacitor RC charging', () => {
  it('at t = 1 RC → ~3.161 V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeRCCircuit();
    board.setNetlist(parts, nets);

    // RC = 1.0 second = 1,000,000,000 ns
    board.advanceTo(1_000_000_000n);

    const v = board.nodeVoltage('net_rc');
    assert.ok(Math.abs(v - 3.161) < 0.1,
      `V at 1RC = ${v}, expected ~3.161`);
  });

  it('at t = 2 RC → ~4.323 V', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeRCCircuit();
    board.setNetlist(parts, nets);

    board.advanceTo(2_000_000_000n);

    const v = board.nodeVoltage('net_rc');
    assert.ok(Math.abs(v - 4.323) < 0.1,
      `V at 2RC = ${v}, expected ~4.323`);
  });

  it('at t = 5 RC → ~4.966 V (nearly full)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeRCCircuit();
    board.setNetlist(parts, nets);

    board.advanceTo(5_000_000_000n);

    const v = board.nodeVoltage('net_rc');
    assert.ok(Math.abs(v - 4.966) < 0.1,
      `V at 5RC = ${v}, expected ~4.966`);
  });

  it('at t = 0.1 RC → ~0.476 V (barely started)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = makeRCCircuit();
    board.setNetlist(parts, nets);

    board.advanceTo(100_000_000n); // 0.1 seconds

    const v = board.nodeVoltage('net_rc');
    assert.ok(Math.abs(v - 0.476) < 0.1,
      `V at 0.1RC = ${v}, expected ~0.476`);
  });

  it('multiple small steps converge to same result as one big step', () => {
    // One big step
    const board1 = new BoardImpl(5.0);
    const c1 = makeRCCircuit();
    board1.setNetlist(c1.parts, c1.nets);
    board1.advanceTo(1_000_000_000n);
    const v1 = board1.nodeVoltage('net_rc');

    // Many small steps (10ms each, 100 steps = 1 second)
    const board2 = new BoardImpl(5.0);
    const c2 = makeRCCircuit();
    board2.setNetlist(c2.parts, c2.nets);
    for (let t = 10_000_000n; t <= 1_000_000_000n; t += 10_000_000n) {
      board2.advanceTo(t);
    }
    const v2 = board2.nodeVoltage('net_rc');

    // Should be very close — the exponential formula is exact per step
    assert.ok(Math.abs(v1 - v2) < 0.01,
      `single step (${v1}) vs 100 steps (${v2}) should agree`);
  });
});
