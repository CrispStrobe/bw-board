import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = [
  '1_out', '1_neg', '1_pos', 'vpos', '2_pos', '2_neg', '2_out',
  '3_out', '3_neg', '3_pos', 'vneg', '4_pos', '4_neg', '4_out',
];
const net = (id, ...terminals) => ({
  id, terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function fourFollowers({supply = 5, inputs = [0, 0.5, 1.5, 3], offsets = 0} = {}) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VS', kind: 'vsource', params: { volts: supply }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lt1014', params: { inputOffsetV: offsets }, terminals: TERMINALS },
  ];
  const ground = [['G', 'gnd'], ['VS', 'neg'], ['U1', 'vneg']];
  const positive = [['VS', 'pos'], ['U1', 'vpos']];
  const nets = [];
  for (let ch = 1; ch <= 4; ch++) {
    parts.push(
      { id: `VIN${ch}`, kind: 'vsource', params: { volts: inputs[ch - 1] }, terminals: ['pos', 'neg'] },
      { id: `RL${ch}`, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    );
    ground.push([`VIN${ch}`, 'neg'], [`RL${ch}`, 'b']);
    nets.push(
      net(`in${ch}`, [`VIN${ch}`, 'pos'], ['U1', `${ch}_pos`]),
      net(`out${ch}`, ['U1', `${ch}_neg`], ['U1', `${ch}_out`], [`RL${ch}`, 'a']),
    );
  }
  nets.push(net('gnd', ...ground), net('vpos', ...positive));
  board.setNetlist(parts, nets);
  return board;
}

describe('LT1014 physical quad precision op amp', () => {
  it('registers one 14-pin package with four channels and shared rails', () => {
    assert.deepEqual(getDevice('lt1014').terminals, TERMINALS);
    assert.equal(getSupplyCurrent('lt1014'), 0.0022);
    const state = fourFollowers().getDeviceState('U1');
    assert.deepEqual(Object.keys(state.drives), ['1_out', '2_out', '3_out', '4_out']);
    assert.deepEqual(state.inputOffsetV, {1: 0, 2: 0, 3: 0, 4: 0});
  });

  it('separates the official source symbol channel from physical package identity', () => {
    assert.deepEqual(getDevice('lt1014_channel').terminals,
      ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.equal(getSupplyCurrent('lt1014_channel'), 0.00055,
      'a logical imported channel carries one amplifier share, not a whole package');
    assert.notDeepEqual(getDevice('lt1014_channel').terminals, getDevice('lt1014').terminals,
      'a five-terminal source symbol cannot impersonate the 14-pin quad');
  });

  it('settles four independent followers through the one shared supply', () => {
    const board = fourFollowers();
    board.advanceTo(80_000n);
    for (let ch = 1; ch <= 4; ch++) {
      const expected = [0.015, 0.5, 1.5, 3][ch - 1];
      assert.ok(Math.abs(board.nodeVoltage(`out${ch}`) - expected) < 0.001,
        `channel ${ch}: expected ${expected}, got ${board.nodeVoltage(`out${ch}`)}`);
    }
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode,
      {1: 'valid', 2: 'valid', 3: 'valid', 4: 'valid'});
  });

  it('requires the shared supply once, rather than powering channels independently', () => {
    const board = fourFollowers({supply: 3.5});
    board.advanceTo(2_000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    for (let ch = 1; ch <= 4; ch++) {
      assert.equal(state.inputCommonMode[ch], 'unpowered');
      assert.equal(state.drives[`${ch}_out`].rTh, 1e9);
    }
  });

  it('retains four bounded offsets and the single-supply ground/high limits', () => {
    const board = fourFollowers({inputs: [0, 0.5, 3.5, 5], offsets: [0, 90e-6, 0, 0]});
    board.advanceTo(80_000n);
    const state = board.getDeviceState('U1');
    assert.ok(board.nodeVoltage('out1') > 0.014 && board.nodeVoltage('out1') < 0.016);
    assert.ok(Math.abs(board.nodeVoltage('out2') - 0.50009) < 5e-6);
    assert.equal(state.inputCommonMode[3], 'valid');
    assert.equal(state.inputCommonMode[4], 'above');
    assert.ok(board.nodeVoltage('out4') > 3.95 && board.nodeVoltage('out4') <= 4.001);
  });

  it('limits all channels by the documented 0.4 V/us large-signal slew', () => {
    const board = fourFollowers({inputs: [0.1, 0.2, 0.3, 0.4]});
    board.advanceTo(20_000n);
    const before = [1, 2, 3, 4].map(ch => board.nodeVoltage(`out${ch}`));
    for (let ch = 1; ch <= 4; ch++) board.setControl(`VIN${ch}`, 3);
    board.advanceTo(board.timeNs + 2_000n);
    for (let ch = 1; ch <= 4; ch++) {
      const moved = board.nodeVoltage(`out${ch}`) - before[ch - 1];
      assert.ok(moved > 0.5 && moved <= 0.81, `channel ${ch} moved ${moved} V`);
    }
  });
});
