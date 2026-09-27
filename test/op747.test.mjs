import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['1_neg', '1_pos', 'vpos', '2_pos', '2_neg', '2_out', '4_out',
  '4_neg', '4_pos', 'vneg', '3_pos', '3_neg', '3_out', '1_out'];
const net = (id, ...terminals) => ({
  id, terminals: terminals.map(([part, terminal]) => ({part, terminal})),
});

function fourFollowers({supply = 15, inputs = [-2, -1, 1, 2], offsets = 0, loadOhms = 10000} = {}) {
  const board = new BoardImpl(5);
  const parts = [
    {id: 'VP', kind: 'vsource', params: {volts: supply}, terminals: ['pos', 'neg']},
    {id: 'VN', kind: 'vsource', params: {volts: supply}, terminals: ['pos', 'neg']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'U1', kind: 'op747', params: {inputOffsetV: offsets}, terminals: TERMINALS},
  ];
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos']];
  const nets = [];
  for (let ch = 1; ch <= 4; ch++) {
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

describe('OP747 physical quad precision micropower op amp', () => {
  it('registers the unusual R-14 order and a separate source channel', () => {
    assert.deepEqual(getDevice('op747').terminals, TERMINALS);
    assert.deepEqual(getDevice('op747_channel').terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.notDeepEqual(getDevice('op747_channel').terminals, getDevice('op747').terminals);
    assert.equal(getSupplyCurrent('op747'), 0.0018);
    assert.equal(getSupplyCurrent('op747_channel'), 0.00045);
  });

  it('settles four independent followers through shared rails', () => {
    const board = fourFollowers({offsets: 0});
    board.advanceTo(500_000n);
    for (let ch = 1; ch <= 4; ch++) {
      const expected = [-2, -1, 1, 2][ch - 1];
      assert.ok(Math.abs(board.nodeVoltage(`out${ch}`) - expected) < 0.001,
        `channel ${ch}: ${board.nodeVoltage(`out${ch}`)} V`);
    }
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode,
      {1: 'valid', 2: 'valid', 3: 'valid', 4: 'valid'});
  });

  it('requires the documented three-volt total supply span once', () => {
    const board = fourFollowers({supply: 1.4});
    board.advanceTo(2_000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    for (let ch = 1; ch <= 4; ch++) {
      assert.equal(state.inputCommonMode[ch], 'unpowered');
      assert.equal(state.drives[`${ch}_out`].rTh, 1e9);
    }
  });

  it('retains the rail-inclusive low input and one-volt high headroom', () => {
    const board = fourFollowers({inputs: [-15, -14, 14, 14.1], offsets: 0});
    board.advanceTo(500_000n);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode,
      {1: 'valid', 2: 'valid', 3: 'valid', 4: 'above'});
  });

  it('keeps the one-milliamp output close to the specified rails', () => {
    const board = fourFollowers({inputs: [-15, -14, 14, 15], offsets: 0, loadOhms: 15000});
    for (let i = 0; i < 4; i++) board.advanceTo(board.timeNs + 100_000n);
    assert.ok(board.nodeVoltage('out1') >= -14.96 && board.nodeVoltage('out1') <= -14.80,
      `negative loaded output was ${board.nodeVoltage('out1')} V`);
    assert.ok(board.nodeVoltage('out4') >= 14.80 && board.nodeVoltage('out4') <= 14.98,
      `positive loaded output was ${board.nodeVoltage('out4')} V`);
  });

  it('limits the shared card to the specified 0.2 V/us slew', () => {
    const board = fourFollowers({inputs: [-1, -0.5, 0.5, 1], offsets: 0});
    board.advanceTo(20_000n);
    const before = board.nodeVoltage('out1');
    board.setControl('VIN1', 10);
    board.advanceTo(board.timeNs + 1n);
    board.advanceTo(board.timeNs + 5_000n);
    const moved = board.nodeVoltage('out1') - before;
    assert.ok(moved > 0.4 && moved <= 1.01, `5 us transition moved ${moved} V`);
  });
});
