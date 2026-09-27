import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos'];
const net = (id, ...terminals) => ({
  id, terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function dualFollowers({ span = 5, inputs = [1, 4], offsets = 0,
  loads = [10000, 10000], loadTo = ['gnd', 'gnd'], feedback = [true, true] } = {}) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VS', kind: 'vsource', params: { volts: span }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ad8602', params: { inputOffsetV: offsets }, terminals: TERMINALS },
  ];
  const ground = [['G', 'gnd'], ['VS', 'neg'], ['U1', 'vneg']];
  const positive = [['VS', 'pos'], ['U1', 'vpos']];
  const nets = [];
  for (let ch = 1; ch <= 2; ch++) {
    parts.push(
      { id: `VIN${ch}`, kind: 'vsource', params: { volts: inputs[ch - 1] }, terminals: ['pos', 'neg'] },
      { id: `RL${ch}`, kind: 'resistor', params: { ohms: loads[ch - 1] }, terminals: ['a', 'b'] },
    );
    ground.push([`VIN${ch}`, 'neg']);
    (loadTo[ch - 1] === 'vpos' ? positive : ground).push([`RL${ch}`, 'b']);
    if (!feedback[ch - 1]) ground.push(['U1', `${ch}_neg`]);
    nets.push(
      net(`in${ch}`, [`VIN${ch}`, 'pos'], ['U1', `${ch}_pos`]),
      net(`out${ch}`, ['U1', `${ch}_out`],
        ...(feedback[ch - 1] ? [['U1', `${ch}_neg`]] : []), [`RL${ch}`, 'a']),
    );
  }
  nets.push(net('gnd', ...ground), net('vpos', ...positive));
  board.setNetlist(parts, nets);
  return board;
}

describe('AD8602 physical dual rail-to-rail op amp', () => {
  it('separates the R-8 dual from the package-neutral source channel', () => {
    assert.deepEqual(getDevice('ad8602').terminals, TERMINALS);
    assert.deepEqual(getDevice('ad8602_channel').terminals,
      ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.notDeepEqual(getDevice('ad8602_channel').terminals, getDevice('ad8602').terminals);
    assert.equal(getSupplyCurrent('ad8602'), 0.003);
    assert.equal(getSupplyCurrent('ad8602_channel'), 0.0015);
    const board = dualFollowers();
    assert.ok(Math.abs(board.branchCurrent('VIN1', 'pos')) <= 1e-12,
      'unspecified differential resistance must remain honestly high-Z');
  });

  it('settles two independent followers through shared single-supply rails', () => {
    const board = dualFollowers({ offsets: 0 });
    board.advanceTo(10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out1') - 1) < 0.001, `${board.nodeVoltage('out1')}`);
    assert.ok(Math.abs(board.nodeVoltage('out2') - 4) < 0.001, `${board.nodeVoltage('out2')}`);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode, { 1: 'valid', 2: 'valid' });
  });

  it('requires the documented 2.7 V supply span once for both channels', () => {
    const board = dualFollowers({ span: 2.69, inputs: [1, 2] });
    board.advanceTo(1_000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    assert.deepEqual(state.inputCommonMode, { 1: 'unpowered', 2: 'unpowered' });
    assert.equal(state.drives['1_out'].rTh, 1e9);
    assert.equal(state.drives['2_out'].rTh, 1e9);
  });

  it('retains finite 80 V/mV open-loop gain', () => {
    const board = dualFollowers({ inputs: [50e-6, 1], offsets: 0, feedback: [false, true] });
    board.advanceTo(30_000n);
    assert.ok(Math.abs(board.nodeVoltage('out1') - 4) < 0.01,
      `finite-gain output ${board.nodeVoltage('out1')} V`);
  });

  it('accepts both input rails and retains the guaranteed 1 mA output envelope', () => {
    const board = dualFollowers({
      inputs: [5, 0], offsets: 0, loads: [4925, 4970], loadTo: ['gnd', 'vpos'],
    });
    board.advanceTo(30_000n);
    assert.deepEqual(board.getDeviceState('U1').inputCommonMode, { 1: 'valid', 2: 'valid' });
    assert.ok(board.nodeVoltage('out1') >= 4.924 && board.nodeVoltage('out1') <= 4.926,
      `positive loaded output ${board.nodeVoltage('out1')} V`);
    assert.ok(board.nodeVoltage('out2') >= 0.029 && board.nodeVoltage('out2') <= 0.031,
      `negative loaded output ${board.nodeVoltage('out2')} V`);
  });

  it('limits both channels to the documented 6 V/us large-signal slew', () => {
    const board = dualFollowers({ inputs: [1, 4], offsets: 0 });
    board.advanceTo(3_000n);
    const before = [board.nodeVoltage('out1'), board.nodeVoltage('out2')];
    board.setControl('VIN1', 4);
    board.setControl('VIN2', 1);
    board.advanceTo(board.timeNs + 1n);
    board.advanceTo(board.timeNs + 500n);
    const moves = [board.nodeVoltage('out1') - before[0], board.nodeVoltage('out2') - before[1]];
    for (const moved of moves) assert.ok(Math.abs(moved) > 2.5 && Math.abs(moved) <= 3.01,
      `500 ns transition moved ${moved} V`);
  });

  it('resolves a small unity-gain step on the 8.4 MHz time scale', () => {
    const board = dualFollowers({ inputs: [1, 4], offsets: 0 });
    board.advanceTo(3_000n);
    board.setControl('VIN1', 1.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 25n);
    const early = board.nodeVoltage('out1');
    assert.ok(early > 1.006 && early < 1.0095,
      `25 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 300n);
    assert.ok(Math.abs(board.nodeVoltage('out1') - 1.01) < 0.0001);
  });
});
