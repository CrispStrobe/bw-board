import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice } from '../src/devices.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';
import { getSupplyCurrent } from '../src/current-ratings.js';

registerAnalogAmps();

const TERMINALS = ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'];
const net = (id, ...terminals) => ({ id, terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });

function follower({ input = 1, span = 30, load = 10000, offset = 0, feedback = true } = {}) {
  const half = span / 2;
  const board = new BoardImpl(5);
  const ground = [['G', 'gnd'], ['VP', 'neg'], ['VN', 'pos'], ['VIN', 'neg'], ['RL', 'b']];
  if (!feedback) ground.push(['U1', 'inn']);
  board.setNetlist([
    { id: 'VP', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VN', kind: 'vsource', params: { volts: half }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: input }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind: 'lm741', params: { inputOffsetV: offset }, terminals: TERMINALS },
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

describe('LM741 physical and electrical contract', () => {
  it('registers the datasheet DIP-8 pins, including explicit null and NC pins', () => {
    assert.deepEqual(getDevice('lm741').terminals, TERMINALS);
    const state = follower().getDeviceState('U1');
    assert.equal(state.offsetNull, 'unmodeled');
    assert.equal(getSupplyCurrent('lm741'), 0.0017);
  });

  it('uses finite 200 V/mV open-loop gain instead of an ideal comparator', () => {
    const board = follower({ input: 20e-6, offset: 0, feedback: false });
    board.advanceTo(20_000n);
    // The feedback controller compensates output resistance until the actual
    // output, not merely the hidden Thevenin source, is 20 uV * 200,000 = 4 V.
    assert.ok(Math.abs(board.nodeVoltage('out') - 4) < 0.01,
      `finite-gain output ${board.nodeVoltage('out')} V`);
  });

  it('settles a dual-supply follower with finite gain and input offset', () => {
    const board = follower({ input: 1, offset: 0.001 });
    board.advanceTo(40_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 1.001) < 0.002,
      `expected about 1.001 V, got ${board.nodeVoltage('out')}`);
    assert.equal(board.getDeviceState('U1').powered, true);
    assert.equal(board.getDeviceState('U1').inputCommonMode, 'valid');
  });

  it('requires both rails and goes high impedance below a 10 V span', () => {
    const board = follower({ span: 8 });
    board.advanceTo(1000n);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    assert.equal(state.inputCommonMode, 'unpowered');
    assert.equal(state.drives.out.rTh, 1e9);
  });

  it('publishes common-mode violations and loaded positive/negative swing', () => {
    const high = follower({ input: 13, load: 2000 });
    high.advanceTo(80_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'above');
    assert.ok(high.nodeVoltage('out') <= 10.1 && high.nodeVoltage('out') >= 9.8,
      `2 kOhm positive swing ${high.nodeVoltage('out')} V; drive ${high.getDeviceState('U1').drives.out.vTh}, `
      + `prev ${JSON.stringify(high.getDeviceState('U1')._prev)}, `
      + `last ${String(high.getDeviceState('U1')._lastUpdateNs)}, wake ${String(high.getDeviceState('U1')._wakeNs)}`);

    const reversalStart = high.timeNs;
    high.setControl('VIN', -13);
    high.advanceTo(reversalStart + 60_000n);
    assert.equal(high.getDeviceState('U1').inputCommonMode, 'below');
    assert.ok(high.nodeVoltage('out') >= -10.1 && high.nodeVoltage('out') <= -9.8,
      `full positive-to-negative reversal reaches loaded swing, got ${high.nodeVoltage('out')} V`);
  });

  it('limits a large-signal transition to the 0.5 V/us slew contract', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(10_000n);
    assert.ok(Math.abs(board.nodeVoltage('out')) < 1e-6,
      `zero-input baseline is ${board.nodeVoltage('out')} V`);
    board.setControl('VIN', 10);
    const t0 = board.timeNs;
    const v0 = board.nodeVoltage('out');
    board.advanceTo(t0 + 2_000n);
    const moved = board.nodeVoltage('out') - v0;
    assert.ok(moved > 0.75 && moved <= 1.01,
      `two microseconds may move at most 1 V, moved ${moved}`);
    board.advanceTo(t0 + 30_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 10) < 0.01,
      `large-signal follower eventually settles, got ${board.nodeVoltage('out')}`);
  });

  it('resolves a small unity-gain step on the 1 MHz-class time scale', () => {
    const board = follower({ input: 0, offset: 0 });
    board.advanceTo(10_000n);
    board.setControl('VIN', 0.01);
    assert.ok(Math.abs(board.nodeVoltage('inp') - 0.01) < 1e-9,
      `controlled input is ${board.nodeVoltage('inp')} V`);
    const t0 = board.timeNs;
    board.advanceTo(t0 + 300n);
    const early = board.nodeVoltage('out');
    assert.ok(early > 0.0075 && early < 0.009,
      `300 ns response must be in flight, got ${early}; state `
      + `${JSON.stringify({ drive: board.getDeviceState('U1').drives.out, prev: board.getDeviceState('U1')._prev, beta: board.getDeviceState('U1')._beta })}`);
    board.advanceTo(t0 + 2_000n);
    assert.ok(Math.abs(board.nodeVoltage('out') - 0.01) < 0.0002,
      `2 us response must settle, got ${board.nodeVoltage('out')}`);
  });
});
