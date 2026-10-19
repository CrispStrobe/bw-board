/**
 * One terminal is one node — shared-terminal nets coalesce at setNetlist.
 *
 * Five shipped circuits (pc82-mini-roulette et al) carry a gnd pin listed
 * in two independently-derived nets. The old solver's MUTATING gnd-merge
 * repaired that by accident; the non-mutating solver preserved the drawn
 * duplication and every getNets() consumer saw a terminal on two nets,
 * with iteration order deciding which one answered (found by the
 * schematic completeness gate, adjudicated 2026-08-23).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

test('a terminal listed in two nets is coalesced, reported, and solved as one node', () => {
  // The pc82 shape: gnd_2.gnd is a member of BOTH net_7 (the rail group)
  // and net_8 (rst/en tied to ground through the same physical pin).
  const parts = [
    { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'gnd_2', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'r2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_top', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }, { part: 'r2', terminal: 'a' }] },
    { id: 'net_7', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'gnd_2', terminal: 'gnd' }] },
    { id: 'net_8', terminals: [{ part: 'r2', terminal: 'b' }, { part: 'gnd_2', terminal: 'gnd' }] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);

  // Exactly one net holds the shared terminal now.
  const holding = board.getNets().filter(n =>
    n.terminals.some(t => t.part === 'gnd_2' && t.terminal === 'gnd'));
  assert.equal(holding.length, 1,
    `gnd_2.gnd must live in exactly one net, found ${holding.length}`);
  // Deterministic: the FIRST net in input order survives.
  assert.equal(holding[0].id, 'net_7');
  // r2.b rode along into the merged net.
  assert.ok(holding[0].terminals.some(t => t.part === 'r2' && t.terminal === 'b'));

  // The repair is visible, naming the terminal and both nets.
  const w = board.getWarnings().filter(x => x.type === 'net-coalesced');
  assert.equal(w.length, 1);
  assert.ok(w[0].message.includes('gnd_2.gnd') && w[0].message.includes('net_7')
    && w[0].message.includes('net_8'), w[0].message);

  // And the solve treats it as one node: both resistors ground-referenced,
  // 5 V across 1 kΩ each.
  for (const id of ['r1', 'r2']) {
    const i = Math.abs(board.branchCurrent(id, 'a'));
    assert.ok(Math.abs(i - 5e-3) < 1e-5, `${id} carries 5 mA, got ${(i * 1e3).toFixed(3)}`);
  }
});

test('clean netlists pass through untouched, no warning', () => {
  const parts = [
    { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'a', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }] },
    { id: 'b', terminals: [{ part: 'gnd1', terminal: 'gnd' }, { part: 'r1', terminal: 'b' }] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  assert.equal(board.getNets().length, 2);
  assert.equal(board.getWarnings().filter(x => x.type === 'net-coalesced').length, 0);
});
