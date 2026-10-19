import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const near = (actual, expected, tolerance, label) => assert.ok(
  Math.abs(actual - expected) <= tolerance,
  `${label}: ${actual} versus ${expected} (±${tolerance})`,
);

function divider() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'RT', kind: 'resistor', params: { ohms: 10e6 }, terminals: ['a', 'b'] },
    { id: 'RB', kind: 'resistor', params: { ohms: 10e6 }, terminals: ['a', 'b'] },
  ], [
    { id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RT', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'RT', terminal: 'b' }, { part: 'RB', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'RB', terminal: 'b' }, { part: 'GND', terminal: 'gnd' }] },
  ]);
  return board;
}

test('ideal observation remains non-loading and an explicit reference is differential', () => {
  const board = divider();
  const absolute = board.addScopeChannel({
    type: 'voltage', netId: 'mid', sampleRateHz: 10_000, depth: 8, capture: 'sample',
  });
  const differential = board.addScopeChannel({
    type: 'voltage', netId: 'vcc', referenceNetId: 'mid',
    sampleRateHz: 10_000, depth: 8, capture: 'sample',
  });
  near(board.nodeVoltage('mid'), 2.5, 1e-9, 'ideal channel does not move divider');
  board.advanceTo(200_000n);
  near(board.getScopeData(absolute).samples[0], 2.5, 1e-9, 'absolute sample');
  near(board.getScopeData(differential).samples[0], 2.5, 1e-9, 'tip minus reference');
});

test('finite 10x and 1x resistance load the actual node and removal restores it', () => {
  const board = divider();
  const publicParts = board.getParts().map(part => part.id);
  const publicNets = board.getNets().map(net => ({
    id: net.id, terminals: net.terminals.map(t => `${t.part}.${t.terminal}`),
  }));
  const tenX = board.addScopeChannel({
    type: 'voltage', netId: 'mid', referenceNetId: 'gnd', inputOhms: 10e6,
  });
  // 10 MΩ bottom resistor || 10 MΩ probe = 5 MΩ; 5 V * 5/(10+5).
  near(board.nodeVoltage('mid'), 5 / 3, 1e-9, '10x resistance loading');
  assert.deepEqual(board.getParts().map(part => part.id), publicParts,
    'virtual probe elements never become authored parts');
  assert.deepEqual(board.getNets().map(net => ({
    id: net.id, terminals: net.terminals.map(t => `${t.part}.${t.terminal}`),
  })), publicNets, 'virtual probe terminals never enter public topology');
  board.removeScopeChannel(tenX);
  near(board.nodeVoltage('mid'), 2.5, 1e-9, 'removing probe removes its load');

  const oneX = board.addScopeChannel({
    type: 'voltage', netId: 'mid', referenceNetId: 'gnd', inputOhms: 1e6,
  });
  const bottom = 1 / (1 / 10e6 + 1 / 1e6);
  near(board.nodeVoltage('mid'), 5 * bottom / (10e6 + bottom), 1e-9, '1x resistance loading');
  board.clearScopeChannels();
  assert.equal(board.getScopeData(oneX), null);
  near(board.nodeVoltage('mid'), 2.5, 1e-9, 'clearing channels removes every load');
});

test('the reference lead owns the return path rather than silently assuming ground', () => {
  const board = divider();
  const loaded = board.addScopeChannel({
    type: 'voltage', netId: 'vcc', referenceNetId: 'mid', inputOhms: 10e6,
  });
  // The probe is now another 10 MΩ from VCC to mid: 5 MΩ above, 10 MΩ below.
  near(board.nodeVoltage('mid'), 10 / 3, 1e-9, 'reference lead changes the loaded branch');
  board.advanceTo(20_000n);
  near(board.getScopeData(loaded).samples[0], 5 / 3, 1e-9, 'channel records tip minus its reference');
});

test('probe capacitance is first-class storage and rounds a source edge', () => {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'SRC', kind: 'vsource', params: {
      wave: 'pulse', amplitude: 5, offset: 0, freq: 100, duty: 0.5,
    }, terminals: ['pos', 'neg'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1e6 }, terminals: ['a', 'b'] },
  ], [
    { id: 'src', terminals: [{ part: 'SRC', terminal: 'pos' }, { part: 'R', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R', terminal: 'b' }] },
    { id: 'gnd', terminals: [{ part: 'SRC', terminal: 'neg' }, { part: 'GND', terminal: 'gnd' }] },
  ]);
  board.addScopeChannel({
    type: 'voltage', netId: 'out', referenceNetId: 'gnd',
    inputFarads: 100e-12, sampleRateHz: 1_000_000, depth: 512, capture: 'sample',
  });
  board.advanceTo(100_000n);
  // 1 MΩ × 100 pF = 100 µs. A 5 V step reaches 1-e^-1 of final value.
  near(board.nodeVoltage('out'), 5 * (1 - Math.exp(-1)), 0.03, '100 us RC edge');
});

test('loaded probes fail closed on invalid topology or values', () => {
  const board = divider();
  assert.throws(() => board.addScopeChannel({
    type: 'voltage', netId: 'mid', inputOhms: 10e6,
  }), /referenceNetId/);
  assert.throws(() => board.addScopeChannel({
    type: 'voltage', netId: 'mid', referenceNetId: 'missing', inputOhms: 10e6,
  }), /reference net.*does not exist/);
  assert.throws(() => board.addScopeChannel({
    type: 'voltage', netId: 'missing', referenceNetId: 'gnd', inputOhms: 10e6,
  }), /tip net.*does not exist/);
  assert.throws(() => board.addScopeChannel({
    type: 'voltage', netId: 'mid', referenceNetId: 'mid', inputOhms: 10e6,
  }), /must be different/);
  for (const inputOhms of [0, -1, Infinity, NaN]) {
    assert.throws(() => board.addScopeChannel({
      type: 'voltage', netId: 'mid', referenceNetId: 'gnd', inputOhms,
    }), /inputOhms/);
  }
  for (const inputFarads of [-1, Infinity, NaN]) {
    assert.throws(() => board.addScopeChannel({
      type: 'voltage', netId: 'mid', referenceNetId: 'gnd', inputFarads,
    }), /inputFarads/);
  }
});
