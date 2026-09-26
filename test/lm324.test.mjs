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
    assert.deepEqual(Object.keys(board.getDeviceState('U1').drives).sort(),
      ['1_out', '2_out', '3_out', '4_out']);
  });

  it('requires at least a 3 V shared supply and goes high impedance below it', () => {
    const board = fourFollowers(2.5);
    const state = board.getDeviceState('U1');
    assert.equal(state.powered, false);
    for (let ch = 1; ch <= 4; ch++) {
      assert.equal(state.inputCommonMode[ch], 'unpowered');
      assert.equal(state.drives[`${ch}_out`].rTh, 1e9);
    }
  });

  it('publishes the datasheet common-mode boundary instead of claiming precision outside it', () => {
    const board = fourFollowers(5, [1, 2, 3, 4]);
    const state = board.getDeviceState('U1');
    assert.equal(state.inputCommonMode[1], 'valid');
    assert.equal(state.inputCommonMode[3], 'valid');
    assert.equal(state.inputCommonMode[4], 'above', '4 V exceeds VCC - 1.5 V common-mode ceiling');
    assert.ok(state.drives['4_out'].vTh <= 3.5, 'out-of-range channel remains bounded by output swing');
  });
});
