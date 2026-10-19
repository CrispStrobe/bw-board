import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'iset'];
const net = (id, ...terminals) => ({
  id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function follower({ input = 1, supply = 5, load = 10000, offset = 80e-6, feedback = true } = {}) {
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VS', 'neg'], ['VIN', 'neg'], ['RL', 'b'], ['U1', 'vneg']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: supply }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1006', params: { inputOffsetV: offset }, terminals: TERMINALS },
    { id: 'RL', kind: 'resistor', params: { ohms: load }, terminals: ['a', 'b'] },
  ], [
    net('gnd', ...ground),
    net('vpos', ['VS', 'pos'], ['U1', 'vpos']),
    net('inp', ['VIN', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'out'], ...(feedback ? [['U1', 'inn']] : []), ['RL', 'a']),
  ]);
  return board;
}

describe('LT1006 S8 precision single-supply contract', () => {
  it('registers all physical pins, the unmodelled current-set pin, and the bounded supply budget', () => {
    assert.deepEqual(getDevice('lt1006').terminals, TERMINALS);
    const state = follower().getDeviceState('U1');
    assert.equal(state.offsetNull, 'unmodeled');
    assert.equal(state.supplyCurrentSet, 'unmodeled');
    assert.equal(state.inputOffsetV, 80e-6);
    assert.equal(getSupplyCurrent('lt1006'), 0.00057);
  });

  it('settles a 5 V single-supply follower with its bounded S8 offset', () => {
    const board = follower();
    board.advanceTo(80_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.00008) < 5e-6,
      `expected about 1.00008 V, got ${board.nodeVoltage('out')}`);
    assert.equal(board.getDeviceState('U1').powered, true);
    assert.equal(board.getDeviceState('U1').inputCommonMode, 'valid');
  });

  it('requires the documented minimum supply and becomes high impedance below it', () => {
    const board = follower({ supply: 2.5 });
    board.advanceTo(1000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    assert.equal(state.inputCommonMode, 'unpowered');
    assert.equal(state.drives.out.rTh, 1e9);
  });

  it('keeps the negative-rail and positive-rail limits deliberately asymmetric', () => {
    const low = follower({ input: 0, offset: 0 });
    low.advanceTo(40_000n);
    assert.equal(low.getDeviceState('U1').inputCommonMode, 'valid');
    assert.ok(low.nodeVoltage('out') > 0.014 && low.nodeVoltage('out') < 0.016,
      `ground-referred output ${low.nodeVoltage('out')} V`);

    const high = follower({ input: 5, load: 600, offset: 0 });
    high.advanceTo(80_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'above');
    assert.ok(high.nodeVoltage('out') > 3.35 && high.nodeVoltage('out') < 3.5,
      `600 ohm positive swing ${high.nodeVoltage('out')} V`);
  });

  it('retains finite open-loop gain instead of becoming an ideal comparator', () => {
    const board = follower({ input: 1e-6, offset: 0, feedback: false });
    board.advanceTo(40_000n);
    assert.ok(board.nodeVoltage('out') > 1.95 && board.nodeVoltage('out') < 2.01,
      `finite-gain output ${board.nodeVoltage('out')} V`);
  });

  it('limits a large-signal transition to 0.4 V/us', () => {
    const board = follower({ input: 0.1, offset: 0 });
    board.advanceTo(20_000n);
    board.setControl('VIN', 3);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 2_000n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 0.55 && moved <= 0.81,
      `two microseconds may move at most 0.8 V, moved ${moved}`);
  });

  it('resolves a small unity-gain step on its 0.7 MHz-class time scale', () => {
    const board = follower({ input: 0.02, offset: 0 });
    board.advanceTo(20_000n);
    board.setControl('VIN', 0.03);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 300n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 0.026 && early < 0.029,
      `300 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 3_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 0.03) < 0.0002,
      `3 us response must settle, got ${board.nodeVoltage('out')}`);
  });
});
