import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['offset_1', 'inn', 'inp', 'vneg', 'nc', 'out', 'vpos', 'offset_8'];
const net = (id, ...terminals) => ({
  id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function follower({ input = 1, span = 30, load = 10000, offset = 10e-6, feedback = true } = {}) {
  const half = span / 2;
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['RL', 'b']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1007', params: { inputOffsetV: offset }, terminals: TERMINALS },
    { id: 'RL', kind: 'resistor', params: { ohms: load }, terminals: ['a', 'b'] },
  ], [
    net('gnd', ...ground),
    net('vpos', ['VP', 'pos'], ['U1', 'vpos']),
    net('vneg', ['VN', 'neg'], ['U1', 'vneg']),
    net('inp', ['VIN', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'out'], ...(feedback ? [['U1', 'inn']] : []), ['RL', 'a']),
  ]);
  return board;
}

describe('LT1007 physical precision-op-amp contract', () => {
  it('separates the N8 package from the source channel and keeps inputs high-Z', () => {
    assert.deepEqual(getDevice('lt1007').terminals, TERMINALS);
    assert.deepEqual(getDevice('lt1007_channel').terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
    const board = follower();
    const state = board.getDeviceState('U1');
    assert.equal(state.offsetNull, 'unmodeled');
    assert.equal(state.inputOffsetV, 10e-6);
    assert.equal(getSupplyCurrent('lt1007'), 0.005);
    assert.equal(getSupplyCurrent('lt1007_channel'), 0.005);
    assert.ok(Math.abs(board.branchCurrent('VIN', 'pos')) < 1e-9,
      'the 5 GOhm common-mode specification must not become a differential input load');
  });

  it('retains finite 20,000 V/mV open-loop gain', () => {
    const board = follower({ input: 0.5e-6, offset: 0, feedback: false });
    board.advanceTo(20_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 10) < 0.01,
      `finite-gain output ${board.nodeVoltage('out')} V`);
  });

  it('settles a precision follower with the authored input offset', () => {
    const board = follower({ input: 1, offset: 10e-6 });
    board.advanceTo(20_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.00000995) < 2e-6,
      `expected finite-gain offset near 1.00000995 V, got ${board.nodeVoltage('out')}`);
    assert.equal(board.getDeviceState('U1').inputCommonMode, 'valid');
  });

  it('requires its eight-volt supply span', () => {
    const board = follower({ span: 7 });
    board.advanceTo(1_000n);
    assert.equal(board.getDeviceState('U1').powered, false);
    assert.equal(board.getDeviceState('U1').drives.out.rTh, 1e9);
  });

  it('publishes typical common-mode limits and retains the 2-kohm loaded swing', () => {
    const high = follower({ input: 14, load: 2000 });
    high.advanceTo(5_000n);
    high.advanceTo(40_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'above');
    assert.ok(high.nodeVoltage('out') > 13.45 && high.nodeVoltage('out') < 13.6,
      `2-kohm positive swing ${high.nodeVoltage('out')} V`);
    const low = follower({ input: -14, load: 2000 });
    low.advanceTo(5_000n);
    low.advanceTo(40_000n);
    assert.equal(low.getDeviceState('U1').inputCommonMode, 'below');
    assert.ok(low.nodeVoltage('out') < -13.45 && low.nodeVoltage('out') > -13.6,
      `2-kohm negative swing ${low.nodeVoltage('out')} V`);
  });

  it('limits a large-signal transition to 2.5 V/us', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(2_000n);
    board.setControl('VIN', 10);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 1_000n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 2.2 && moved <= 2.51, `one microsecond moved ${moved} V`);
    board.advanceTo(t0 + 10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 10) < 0.01);
  });

  it('resolves a small unity-gain step on the 8 MHz time scale', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(2_000n);
    board.setControl('VIN', 0.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 25n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 0.006 && early < 0.008, `25 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 400n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 0.01) < 0.0001);
  });
});
