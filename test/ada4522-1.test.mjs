import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();
const TERMINALS = ['nic_1', 'inn', 'inp', 'vneg', 'nic_5', 'out', 'vpos', 'nic_8'];
const net = (id, ...terminals) => ({ id, terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });

function follower({ input = 1, span = 5, offset = 0, feedback = true } = {}) {
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VS', 'neg'], ['VIN', 'neg'], ['U1', 'vneg']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: span }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ada4522_1', params: { inputOffsetV: offset }, terminals: TERMINALS },
  ], [
    net('gnd', ...ground), net('vpos', ['VS', 'pos'], ['U1', 'vpos']),
    net('inp', ['VIN', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'out'], ...(feedback ? [['U1', 'inn']] : [])),
  ]);
  return board;
}

describe('ADA4522-1 bounded precision op-amp contract', () => {
  it('separates the R-8 package from the package-neutral source channel', () => {
    assert.deepEqual(getDevice('ada4522_1').terminals, TERMINALS);
    assert.deepEqual(getDevice('ada4522_1_channel').terminals, ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.ok(Math.abs(getSupplyCurrent('ada4522_1') - 0.00097) < 1e-15);
    assert.ok(Math.abs(getSupplyCurrent('ada4522_1_channel') - 0.00097) < 1e-15);
  });

  it('requires the documented 4.5 V supply span', () => {
    const board = follower({ span: 4.49 });
    board.advanceTo(2_000n);
    assert.equal(board.getDeviceState('U1').powered, false);
    assert.equal(board.getDeviceState('U1').drives.out.rTh, 1e9);
  });

  it('retains minimum 125 dB gain and specified differential resistance', () => {
    const board = follower({ input: 1e-6, feedback: false });
    board.advanceTo(20_000n);
    assert.ok(board.nodeVoltage('out') > 1.77 && board.nodeVoltage('out') < 1.79,
      `finite-gain output ${board.nodeVoltage('out')} V`);
    const current = Math.abs(board.branchCurrent('VIN', 'pos'));
    assert.ok(current > 3.2e-11 && current < 3.5e-11, `${current}`);
  });

  it('keeps the guaranteed common-mode ceiling and conservative rail envelope', () => {
    const valid = follower({ input: 3.5 });
    valid.advanceTo(30_000n);
    assert.equal(valid.getDeviceState('U1').inputCommonMode, 'valid');
    assert.ok(valid.nodeVoltage('out') <= 4.650001);
    const above = follower({ input: 3.51 });
    above.advanceTo(2_000n);
    assert.equal(above.getDeviceState('U1').inputCommonMode, 'above');
  });

  it('limits large-signal movement to the slowest 0.8 V/us edge', () => {
    const board = follower({ input: 0 });
    board.advanceTo(3_000n);
    board.setControl('VIN', 3);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 1_000n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 0.7 && moved <= 0.801, `one microsecond moved ${moved} V`);
  });

  it('resolves a small unity-gain step on the 2.7 MHz scale', () => {
    const board = follower({ input: 1 });
    board.advanceTo(3_000n);
    board.setControl('VIN', 1.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 50n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 1.005 && early < 1.009, `50 ns response ${early}`);
    board.advanceTo(t0 + 1_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.01) < 0.0001);
  });
});
