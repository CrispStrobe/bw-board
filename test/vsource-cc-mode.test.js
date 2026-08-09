/**
 * Vsource current-limit (CC mode) tests.
 *
 * Conditions from the coordinator:
 * 1. Supply at 5V into a load under the limit stays at 5V (CV mode)
 * 2. Into a short, it clamps at iLimit with voltage falling
 * 3. The transition point itself is asserted
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

describe('vsource CC mode: current limiting', () => {
  it('load under limit: voltage stays at nominal (CV mode)', () => {
    // 5V supply, 1A limit, 100Ω load → I = 0.05A < 1A → stays at 5V
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'PS', kind: 'vsource', params: { volts: 5, iLimit: 1.0 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'PS', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'PS', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_pos');
    // Should be 5V (CV mode — current 50mA is well under 1A limit)
    assert.ok(Math.abs(v - 5.0) < 0.1,
      `CV mode: voltage should be 5V, got ${v.toFixed(3)}V`);
  });

  it('short circuit: voltage drops to clamp current at iLimit', () => {
    // 5V supply, 0.1A limit, 1Ω load → unclamped I = 5A >> 0.1A
    // Clamped: V = iLimit * R = 0.1 * 1 = 0.1V
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'PS', kind: 'vsource', params: { volts: 5, iLimit: 0.1 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'PS', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'PS', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_pos');
    const i = board.branchCurrent('PS', 'pos');

    // Current should be clamped near 0.1A
    assert.ok(Math.abs(i) < 0.15,
      `CC mode: current should be ~0.1A, got ${Math.abs(i).toFixed(4)}A`);
    // Voltage should have dropped from 5V
    assert.ok(v < 1.0,
      `CC mode: voltage should drop below 1V, got ${v.toFixed(3)}V`);
  });

  it('transition point: just under limit stays at 5V, just over triggers CC', () => {
    // 5V supply, 0.5A limit.
    // 10Ω load → I = 0.5A = exactly at limit → should be at or near 5V
    const partsAt = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'PS', kind: 'vsource', params: { volts: 5, iLimit: 0.5 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
    ];
    const netsAt = [
      { id: 'net_pos', terminals: [{ part: 'PS', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'PS', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const boardAt = new BoardImpl(5.0);
    boardAt.setNetlist(partsAt, netsAt);
    const vAt = boardAt.nodeVoltage('net_pos');
    // At exactly the limit: V=5V gives I=0.5A = limit. Should still be CV.
    assert.ok(vAt > 4.0,
      `at limit: voltage should be near 5V (CV), got ${vAt.toFixed(3)}V`);

    // 5Ω load → unclamped I = 1A > 0.5A → CC mode
    const partsOver = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'PS', kind: 'vsource', params: { volts: 5, iLimit: 0.5 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 5 }, terminals: ['a', 'b'] },
    ];
    const netsOver = [
      { id: 'net_pos', terminals: [{ part: 'PS', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'PS', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const boardOver = new BoardImpl(5.0);
    boardOver.setNetlist(partsOver, netsOver);
    const vOver = boardOver.nodeVoltage('net_pos');
    const iOver = boardOver.branchCurrent('PS', 'pos');

    // Over limit: should clamp to 0.5A, voltage = 0.5 * 5 = 2.5V
    assert.ok(Math.abs(iOver) < 0.6,
      `over limit: current should be clamped ~0.5A, got ${Math.abs(iOver).toFixed(4)}A`);
    assert.ok(vOver < 4.0,
      `over limit: voltage should drop from 5V, got ${vOver.toFixed(3)}V`);
  });

  it('no iLimit param: behaves as normal vsource (no clamping)', () => {
    // 5V supply, NO limit, 1Ω load → I = 5A (no clamping)
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'PS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'net_pos', terminals: [{ part: 'PS', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'net_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' },
        { part: 'PS', terminal: 'neg' },
        { part: 'R1', terminal: 'b' },
      ]},
    ];

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);

    const v = board.nodeVoltage('net_pos');
    assert.ok(Math.abs(v - 5.0) < 0.1, `no limit: stays at 5V, got ${v.toFixed(3)}V`);
  });
});
