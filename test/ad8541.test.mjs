import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['nc_1', 'inn', 'inp', 'vneg', 'nc_5', 'out', 'vpos', 'nc_8'];
const net = (id, ...terminals) => ({
  id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })),
});

function follower({ input = 1, span = 5, load = 10000, offset = 1e-3,
  feedback = true, loadTo = 'gnd' } = {}) {
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VS', 'neg'], ['VIN', 'neg']];
  if (loadTo === 'gnd') ground.push(['RL', 'b']);
  if (!feedback) ground.push(['U1', 'inn']);
  const positive = [['VS', 'pos'], ['U1', 'vpos']];
  if (loadTo === 'vpos') positive.push(['RL', 'b']);
  board.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: span }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'ad8541', params: { inputOffsetV: offset }, terminals: TERMINALS },
    { id: 'RL', kind: 'resistor', params: { ohms: load }, terminals: ['a', 'b'] },
  ], [
    net('gnd', ...ground, ['U1', 'vneg']),
    net('vpos', ...positive),
    net('inp', ['VIN', 'pos'], ['U1', 'inp']),
    net('out', ['U1', 'out'], ...(feedback ? [['U1', 'inn']] : []), ['RL', 'a']),
  ]);
  return board;
}

describe('AD8541 physical rail-to-rail op-amp contract', () => {
  it('separates the R-8 package from the package-neutral source channel', () => {
    assert.deepEqual(getDevice('ad8541').terminals, TERMINALS);
    assert.deepEqual(getDevice('ad8541_channel').terminals,
      ['inp', 'inn', 'vpos', 'vneg', 'out']);
    assert.equal(getSupplyCurrent('ad8541'), 0.000085);
    assert.equal(getSupplyCurrent('ad8541_channel'), 0.000085);
    const board = follower();
    assert.equal(board.getDeviceState('U1').inputOffsetV, 1e-3);
    assert.ok(Math.abs(board.branchCurrent('VIN', 'pos')) <= 1e-12,
      'unspecified differential resistance must remain honestly high-Z');
  });

  it('retains finite 40 V/mV open-loop gain', () => {
    const board = follower({ input: 100e-6, offset: 0, feedback: false });
    board.advanceTo(30_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 4) < 0.01,
      `finite-gain output ${board.nodeVoltage('out')} V`);
  });

  it('settles a follower with the typical input offset', () => {
    const board = follower();
    board.advanceTo(30_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.000975) < 5e-6,
      `expected finite-gain offset near 1.000975 V, got ${board.nodeVoltage('out')}`);
    assert.equal(board.getDeviceState('U1').inputCommonMode, 'valid');
  });

  it('requires the documented 2.7 V supply span', () => {
    const board = follower({ span: 2.69, input: 1 });
    board.advanceTo(2_000n);
    assert.equal(board.getDeviceState('U1').powered, false);
    assert.equal(board.getDeviceState('U1').drives.out.rTh, 1e9);
  });

  it('accepts both input rails and retains the guaranteed 1 mA output envelope', () => {
    const high = follower({ input: 5, offset: 0, load: 4875 });
    high.advanceTo(40_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'valid');
    assert.ok(high.nodeVoltage('out') >= 4.874 && high.nodeVoltage('out') <= 4.876,
      `positive loaded output ${high.nodeVoltage('out')} V`);
    const low = follower({ input: 0, offset: 0, load: 4875, loadTo: 'vpos' });
    low.advanceTo(40_000n);
    assert.equal(low.getDeviceState('U1').inputCommonMode, 'valid');
    assert.ok(low.nodeVoltage('out') >= 0.124 && low.nodeVoltage('out') <= 0.126,
      `negative loaded output ${low.nodeVoltage('out')} V`);
  });

  it('limits a large-signal transition to 0.92 V/us', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(3_000n);
    board.setControl('VIN', 4);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 1_000n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 0.8 && moved <= 0.921, `one microsecond moved ${moved} V`);
    board.advanceTo(t0 + 10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 4) < 0.01);
  });

  it('resolves a small unity-gain step on the 1 MHz time scale', () => {
    const board = follower({ input: 1, offset: 0 });
    board.advanceTo(3_000n);
    board.setControl('VIN', 1.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 200n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 1.006 && early < 1.0085,
      `200 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 2_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.01) < 0.0001);
  });
});
