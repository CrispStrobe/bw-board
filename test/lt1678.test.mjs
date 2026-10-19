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

function dualFollowers({span = 30, inputs = [-2, 3], offsets = 0, loadOhms = 10000} = {}) {
  const half = span / 2;
  const board = new BoardImpl(5);
  const parts = [
    {id: 'VP', kind: 'vsource', params: {volts: half}, terminals: ['pos', 'neg']},
    {id: 'VN', kind: 'vsource', params: {volts: half}, terminals: ['pos', 'neg']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'U1', kind: 'lt1678', params: {inputOffsetV: offsets}, terminals: TERMINALS},
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

describe('LT1678 physical dual precision op amp', () => {
  it('separates the SOIC-8 dual from the package-neutral source channel', () => {
    assert.deepEqual(getDevice('lt1678').terminals, TERMINALS);
    assert.deepEqual(getDevice('lt1678_channel').terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.notDeepEqual(getDevice('lt1678_channel').terminals, getDevice('lt1678').terminals);
    assert.equal(getSupplyCurrent('lt1678'), 0.009);
    assert.equal(getSupplyCurrent('lt1678_channel'), 0.0045);
  });

  it('settles two independent precision followers through shared rails', () => {
    const board = dualFollowers({offsets: 0});
    board.advanceTo(10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out1') + 2) < 0.001, `${board.nodeVoltage('out1')}`);
    assert.ok(Math.abs(board.nodeVoltage('out2') - 3) < 0.001, `${board.nodeVoltage('out2')}`);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode, {1: 'valid', 2: 'valid'});
  });

  it('requires the guaranteed 3.1 V supply span once for both channels', () => {
    const board = dualFollowers({span: 3});
    board.advanceTo(1_000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    assert.deepEqual(state.inputCommonMode, {1: 'unpowered', 2: 'unpowered'});
    assert.equal(state.drives['1_out'].rTh, 1e9);
    assert.equal(state.drives['2_out'].rTh, 1e9);
  });

  it('keeps the common-mode boundary and loaded rail-to-rail output conservative', () => {
    const board = dualFollowers({inputs: [-14, 14.5], offsets: 0, loadOhms: 2000});
    for (let i = 0; i < 4; i++) board.advanceTo(board.timeNs + 2_000n);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode, {1: 'below', 2: 'above'});
    assert.ok(board.nodeVoltage('out1') < -13 && board.nodeVoltage('out1') > -14,
      `negative loaded swing ${board.nodeVoltage('out1')} V`);
    assert.ok(board.nodeVoltage('out2') > 13 && board.nodeVoltage('out2') < 14.5,
      `positive loaded swing ${board.nodeVoltage('out2')} V`);
  });

  it('limits both channels to the documented 6 V/us large-signal slew', () => {
    const board = dualFollowers({inputs: [-1, 1], offsets: 0});
    board.advanceTo(2_000n);
    const before = [board.nodeVoltage('out1'), board.nodeVoltage('out2')];
    board.setControl('VIN1', 10);
    board.setControl('VIN2', -10);
    board.advanceTo(board.timeNs + 1n);
    board.advanceTo(board.timeNs + 500n);
    const moves = [board.nodeVoltage('out1') - before[0], board.nodeVoltage('out2') - before[1]];
    for (const moved of moves) assert.ok(Math.abs(moved) > 2.5 && Math.abs(moved) <= 3.01,
      `500 ns transition moved ${moved} V`);
  });

  it('resolves a small unity-gain step on the 20 MHz time scale', () => {
    const board = dualFollowers({inputs: [0, 0], offsets: 0});
    board.advanceTo(2_000n);
    board.setControl('VIN1', 0.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 10n);
    const early = board.nodeVoltage('out1');
    assert.ok(early > 0.006 && early < 0.009, `10 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 200n);
    assert.ok(Math.abs(board.nodeVoltage('out1') - 0.01) < 0.0001);
  });
});
