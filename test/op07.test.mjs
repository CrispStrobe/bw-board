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

function follower({ input = 1, span = 30, load = 10000, offset = 60e-6, feedback = true } = {}) {
  const half = span / 2;
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['RL', 'b']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'op07', params: { inputOffsetV: offset }, terminals: TERMINALS },
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

describe('OP07 physical precision-op-amp contract', () => {
  it('registers the data-sheet DIP-8 pins, unmodelled trim, and bounded supply budget', () => {
    assert.deepEqual(getDevice('op07').terminals, TERMINALS);
    const state = follower().getDeviceState('U1');
    assert.equal(state.offsetNull, 'unmodeled');
    assert.equal(state.inputOffsetV, 60e-6);
    assert.equal(getSupplyCurrent('op07'), 0.005);
  });

  it('retains finite 400 V/mV open-loop gain', () => {
    const board = follower({ input: 10e-6, offset: 0, feedback: false });
    board.advanceTo(30_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 4) < 0.01,
      `finite-gain output ${board.nodeVoltage('out')} V`);
  });

  it('settles a precision follower with the authored input offset', () => {
    const board = follower({ input: 1, offset: 60e-6 });
    board.advanceTo(50_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.0000575) < 5e-6,
      `expected finite-gain offset near 1.0000575 V, got ${board.nodeVoltage('out')}`);
    assert.equal(board.getDeviceState('U1').powered, true);
    assert.equal(board.getDeviceState('U1').inputCommonMode, 'valid');
  });

  it('requires its six-volt supply span and becomes high impedance below it', () => {
    const board = follower({ span: 5 });
    board.advanceTo(1_000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    assert.equal(state.inputCommonMode, 'unpowered');
    assert.equal(state.drives.out.rTh, 1e9);
  });

  it('publishes common-mode violations and bounded loaded swing in both directions', () => {
    const high = follower({ input: 14, load: 2000 });
    high.advanceTo(120_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'above');
    assert.ok(high.nodeVoltage('out') > 12.5 && high.nodeVoltage('out') < 12.7,
      `2 kOhm positive swing ${high.nodeVoltage('out')} V`);

    const low = follower({ input: -14, load: 2000 });
    low.advanceTo(120_000n);
    assert.equal(low.getDeviceState('U1').inputCommonMode, 'below');
    assert.ok(low.nodeVoltage('out') < -12.5 && low.nodeVoltage('out') > -12.7,
      `2 kOhm negative swing ${low.nodeVoltage('out')} V`);
  });

  it('limits a large-signal transition to 0.3 V/us', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(10_000n);
    board.setControl('VIN', 10);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 4_000n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 0.9 && moved <= 1.21,
      `four microseconds may move at most 1.2 V, moved ${moved}`);
    board.advanceTo(t0 + 60_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 10) < 0.01,
      `large-signal follower eventually settles, got ${board.nodeVoltage('out')}`);
  });

  it('resolves a small unity-gain step on the 0.6 MHz time scale', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(10_000n);
    board.setControl('VIN', 0.01);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 300n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 0.006 && early < 0.0075,
      `300 ns response must be in flight, got ${early}`);
    board.advanceTo(t0 + 3_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 0.01) < 0.0002,
      `3 us response must settle, got ${board.nodeVoltage('out')}`);
  });
});
