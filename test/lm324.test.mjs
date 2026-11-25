import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';

registerAnalogAmps();

const net = (id, ...terminals) => ({ id, terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });
const resistor = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const amp = { id: 'U1', kind: 'lm324', params: {}, terminals: [
  'vcc', 'gnd', '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out',
  '3_pos', '3_neg', '3_out', '4_pos', '4_neg', '4_out',
] };

function fourFollowers(vcc = 5, inputs = [0.5, 1, 2, 3]) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VS', kind: 'vsource', params: { volts: vcc }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] }, amp,
  ];
  const groundTerms = [['G', 'gnd'], ['VS', 'neg'], ['U1', 'gnd']];
  const supplyTerms = [['VS', 'pos'], ['U1', 'vcc']];
  const nets = [];
  for (let ch = 1; ch <= 4; ch++) {
    const expected = inputs[ch - 1];
    const top = 5 - expected; const bottom = expected;
    parts.push(resistor(`T${ch}`, top * 1000), resistor(`B${ch}`, bottom * 1000), resistor(`L${ch}`, 100000));
    supplyTerms.push([`T${ch}`, 'a']);
    groundTerms.push([`B${ch}`, 'b'], [`L${ch}`, 'b']);
    nets.push(net(`in${ch}`, [`T${ch}`, 'b'], [`B${ch}`, 'a'], ['U1', `${ch}_pos`]),
      net(`out${ch}`, ['U1', `${ch}_neg`], ['U1', `${ch}_out`], [`L${ch}`, 'a']));
  }
  nets.push(net('gnd', ...groundTerms), net('vcc', ...supplyTerms));
  board.setNetlist(parts, nets);
  board.advanceTo(1n);
  return board;
}

describe('LM324 powered quad op amp', () => {
  it('keeps four independent followers on the physical channel contract', () => {
    const board = fourFollowers();
    for (let ch = 1; ch <= 4; ch++) {
      const expected = [0.5, 1, 2, 3][ch - 1];
      assert.ok(Math.abs(board.nodeVoltage(`out${ch}`) - expected) < 0.02,
        `channel ${ch}: expected ${expected} V, got ${board.nodeVoltage(`out${ch}`)}`);
    }
    // 2026-11-23: the outputs are no longer Thévenin `drives` (the LM324 is
    // the Newton-solved macromodel in src/ground-sensing-opamp.js). The
    // physical channel contract is that each output lead carries its own
    // load current: Vout / 100 kΩ out of `${ch}_out`, less what the - input
    // (on the same node) sources itself: its bias current, Ib - Ios/2 =
    // 42.5 nA (test/opamp-input-bias.test.mjs).
    for (let ch = 1; ch <= 4; ch++) {
      const iLoad = board.nodeVoltage(`out${ch}`) / 100000 - 42.5e-9;
      assert.ok(Math.abs(board.branchCurrent('U1', `${ch}_out`) - iLoad) < 1e-9,
        `channel ${ch} output lead current`);
    }
  });

  it('requires at least a 3 V shared supply and goes high impedance below it', () => {
    const board = fourFollowers(2.5);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    for (let ch = 1; ch <= 4; ch++) {
      assert.equal(state.inputCommonMode[ch], 'unpowered');
      // High impedance: the follower's output node falls to its 100 kΩ
      // load's ground and the lead carries no current.
      assert.ok(Math.abs(board.nodeVoltage(`out${ch}`)) < 1e-3, `channel ${ch} undriven`);
      assert.ok(Math.abs(board.branchCurrent('U1', `${ch}_out`)) < 1e-9);
    }
  });

  it('publishes the datasheet common-mode boundary instead of claiming precision outside it', () => {
    const board = fourFollowers(5, [1, 2, 3, 4]);
    const state = board.getDeviceState('U1');
    assert.equal(state.inputCommonMode[1], 'valid');
    assert.equal(state.inputCommonMode[3], 'valid');
    assert.equal(state.inputCommonMode[4], 'above', '4 V exceeds VCC - 1.5 V common-mode ceiling');
    assert.ok(board.nodeVoltage('out4') <= 3.5, 'out-of-range channel remains bounded by output swing');
  });
});
