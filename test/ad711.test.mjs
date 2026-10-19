import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'];
const net = (id, ...terminals) => ({
  id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function follower({ input = 1, span = 30, load = 10000, offset = 0.3e-3, feedback = true } = {}) {
  const half = span / 2;
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['RL', 'b']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ad711', params: { inputOffsetV: offset }, terminals: TERMINALS },
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

describe('AD711 physical BiFET precision-op-amp contract', () => {
  it('separates the N-8 package from the source channel and retains the specified input impedance', () => {
    assert.deepEqual(getDevice('ad711').terminals, TERMINALS);
    assert.deepEqual(getDevice('ad711_channel').terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
    const board = follower();
    const state = board.getDeviceState('U1');
    assert.equal(state.offsetNull, 'unmodeled');
    assert.equal(state.inputOffsetV, 0.3e-3);
    assert.equal(getSupplyCurrent('ad711'), 0.0034);
    assert.equal(getSupplyCurrent('ad711_channel'), 0.0034);
    assert.ok(Math.abs(board.branchCurrent('VIN', 'pos')) < 1e-9,
      'the explicit 3 TOhm differential impedance remains a high-impedance input');
  });

  it('retains finite 400 V/mV open-loop gain', () => {
    const board = follower({ input: 25e-6, offset: 0, feedback: false });
    board.advanceTo(20_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 10) < 0.01,
      `finite-gain output ${board.nodeVoltage('out')} V`);
  });

  it('settles a precision follower with the J-grade typical input offset', () => {
    const board = follower();
    board.advanceTo(20_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.0002975) < 3e-6,
      `expected finite-gain offset near 1.0002975 V, got ${board.nodeVoltage('out')}`);
    assert.equal(board.getDeviceState('U1').inputCommonMode, 'valid');
  });

  it('requires the documented nine-volt supply span', () => {
    const board = follower({ span: 8.9 });
    board.advanceTo(1_000n);
    assert.equal(board.getDeviceState('U1').powered, false);
    assert.equal(board.getDeviceState('U1').drives.out.rTh, 1e9);
  });

  it('publishes asymmetric common-mode and output limits', () => {
    const high = follower({ input: 14.6, load: 2000 });
    high.advanceTo(20_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'above');
    assert.ok(high.nodeVoltage('out') > 13.79 && high.nodeVoltage('out') <= 13.8,
      `positive output limit ${high.nodeVoltage('out')} V`);
    const low = follower({ input: -11.6, load: 2000 });
    low.advanceTo(20_000n);
    assert.equal(low.getDeviceState('U1').inputCommonMode, 'below');
    assert.ok(low.nodeVoltage('out') < -11.59 && low.nodeVoltage('out') > -13.11,
      `negative follower output ${low.nodeVoltage('out')} V`);
    const lowRail = follower({ input: -14, load: 2000 });
    lowRail.advanceTo(20_000n);
    assert.ok(lowRail.nodeVoltage('out') < -13.09 && lowRail.nodeVoltage('out') >= -13.1,
      `negative output limit ${lowRail.nodeVoltage('out')} V`);
  });

  it('limits a large-signal transition to 20 V/us', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(2_000n);
    board.setControl('VIN', 10);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 250n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 4.8 && moved <= 5.01, `250 ns moved ${moved} V`);
    board.advanceTo(t0 + 2_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 10) < 0.01);
  });

  it('resolves a small unity-gain step on the 4 MHz time scale', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(2_000n);
    board.setControl('VIN', 0.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 25n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 0.004 && early < 0.006, `25 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 500n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 0.01) < 0.0001);
  });
});
