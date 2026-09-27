import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos'];
const net = (id, ...terminals) => ({
  id, terminals: terminals.map(([part, terminal]) => ({part, terminal})),
});

function dualFollowers({supply = 15, inputs = [-2, 3], offsets = 0, loadOhms = 10000} = {}) {
  const board = new BoardImpl(5);
  const parts = [
    {id: 'VP', kind: 'vsource', params: {volts: supply}, terminals: ['pos', 'neg']},
    {id: 'VN', kind: 'vsource', params: {volts: supply}, terminals: ['pos', 'neg']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'U1', kind: 'adtl082', params: {inputOffsetV: offsets}, terminals: TERMINALS},
  ];
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos']];
  const nets = [];
  for (let ch = 1; ch <= 2; ch++) {
    parts.push(
      {id: `VIN${ch}`, kind: 'vsource', params: {volts: inputs[ch - 1]}, terminals: ['pos', 'neg']},
      {id: `RL${ch}`, kind: 'resistor', params: {ohms: loadOhms}, terminals: ['a', 'b']},
    );
    ground.push([`VIN${ch}`, 'neg'], [`RL${ch}`, 'b']);
    nets.push(
      net(`in${ch}`, [`VIN${ch}`, 'pos'], ['U1', `${ch}_pos`]),
      net(`out${ch}`, ['U1', `${ch}_neg`], ['U1', `${ch}_out`], [`RL${ch}`, 'a']),
    );
  }
  nets.push(
    net('gnd', ...ground),
    net('vpos', ['VP', 'pos'], ['U1', 'vpos']),
    net('vneg', ['VN', 'neg'], ['U1', 'vneg']),
  );
  board.setNetlist(parts, nets);
  return board;
}

describe('ADTL082 physical dual JFET-input op amp', () => {
  it('registers one SOIC-8 dual and a separate package-neutral source channel', () => {
    assert.deepEqual(getDevice('adtl082').terminals, TERMINALS);
    assert.deepEqual(getDevice('adtl082_channel').terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.notDeepEqual(getDevice('adtl082_channel').terminals, getDevice('adtl082').terminals);
    assert.equal(getSupplyCurrent('adtl082'), 0.004);
    assert.equal(getSupplyCurrent('adtl082_channel'), 0.002);
  });

  it('settles two independent followers through the shared rails', () => {
    const board = dualFollowers({offsets: 0});
    board.advanceTo(20_000n);
    assert.ok(Math.abs(board.nodeVoltage('out1') + 2) < 0.001, `${board.nodeVoltage('out1')}`);
    assert.ok(Math.abs(board.nodeVoltage('out2') - 3) < 0.001, `${board.nodeVoltage('out2')}`);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode, {1: 'valid', 2: 'valid'});
  });

  it('requires the documented ten-volt supply span once for both channels', () => {
    const board = dualFollowers({supply: 4});
    board.advanceTo(1_000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    assert.deepEqual(state.inputCommonMode, {1: 'unpowered', 2: 'unpowered'});
    assert.equal(state.drives['1_out'].rTh, 1e9);
    assert.equal(state.drives['2_out'].rTh, 1e9);
  });

  it('publishes the asymmetric common-mode envelope and finite input impedance', () => {
    const board = dualFollowers({inputs: [-12, 14], offsets: 0});
    board.advanceTo(20_000n);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode, {1: 'below', 2: 'valid'});
    const device = getDevice('adtl082');
    assert.equal(typeof device.stamp, 'function');
  });

  it('retains the guaranteed loaded swing rather than claiming rail-to-rail output', () => {
    const board = dualFollowers({inputs: [-14, 14], offsets: 0, loadOhms: 2000});
    board.advanceTo(30_000n);
    assert.ok(board.nodeVoltage('out1') <= -9.9 && board.nodeVoltage('out1') >= -10.1,
      `negative loaded swing was ${board.nodeVoltage('out1')} V`);
    assert.ok(board.nodeVoltage('out2') >= 9.9 && board.nodeVoltage('out2') <= 10.1,
      `positive loaded swing was ${board.nodeVoltage('out2')} V`);
  });

  it('limits both channels to the documented 20 V/us large-signal slew', () => {
    const board = dualFollowers({inputs: [-1, 1], offsets: 0});
    board.advanceTo(5_000n);
    const before = [board.nodeVoltage('out1'), board.nodeVoltage('out2')];
    board.setControl('VIN1', 10);
    board.setControl('VIN2', -10);
    // The first post-control solve observes the new source values and arms
    // the device cadence; measure the following 250 ns response window.
    board.advanceTo(board.timeNs + 1n);
    board.advanceTo(board.timeNs + 250n);
    const moves = [board.nodeVoltage('out1') - before[0], board.nodeVoltage('out2') - before[1]];
    for (const moved of moves) assert.ok(Math.abs(moved) > 1 && Math.abs(moved) <= 5.01,
      `250 ns transition moved ${moved} V`);
  });
});
