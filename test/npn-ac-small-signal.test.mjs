import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';

const net = (id, ...terminals) => ({ id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });
const exactParams = Object.freeze({ model: 'shockley', is: 3e-9, beta: 200,
  vaf: 130, rb: 10 });

function bench(params = exactParams) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'G0', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'VCC', kind: 'vsource', params: { volts: 12 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 0.75 }, terminals: ['pos', 'neg'] },
    { id: 'RC', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
    { id: 'RE', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'Q1', kind: 'npn', params: { ...params }, terminals: ['collector', 'base', 'emitter'] },
  ], [
    net('gnd', ['G0', 'gnd'], ['VCC', 'neg'], ['VIN', 'neg'], ['RE', 'b']),
    net('vcc', ['VCC', 'pos'], ['RC', 'a']),
    net('base', ['VIN', 'pos'], ['Q1', 'base']),
    net('collector', ['RC', 'b'], ['Q1', 'collector']),
    net('emitter', ['RE', 'a'], ['Q1', 'emitter']),
  ]);
  return board;
}

function signedReal(row, node) {
  const value = row.results.get(node);
  return value.mag * Math.cos(value.phaseDeg * Math.PI / 180);
}

describe('strict explicit Ebers-Moll NPN small-signal AC', () => {
  it('matches the independent ngspice two-junction, Early-effect and RB Jacobian', () => {
    // Self-authored ngspice 42 deck at TEMP=TNOM=26.826895261366076 C,
    // selected so its thermal voltage is this engine's declared 0.02585 V:
    // VCC=12, VIN DC .75 AC 1, RC=3k, RE=1k and
    // .model QN NPN(IS=3n BF=200 VAF=130 RB=10).
    const expected = new Map([
      ['base', 1],
      ['collector', -2.81964946107703],
      ['emitter', 0.9443053619883761],
    ]);
    const board = bench();
    const before = board.operatingPoint();
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: [...expected.keys()] })[0];
    for (const [node, oracle] of expected) {
      const actual = signedReal(row, node);
      assert.ok(Math.abs(actual - oracle) < 2e-8,
        `${node}: ${actual} vs ngspice ${oracle}`);
    }
    const after = board.operatingPoint();
    assert.deepEqual([...after.nodeVoltages], [...before.nodeVoltages],
      'small-signal analysis must not adopt or move the DC operating point');
  });

  it('retains the generic interactive NPN compatibility model', () => {
    const exact = bench();
    const generic = bench({ beta: 200, vbe: 0.7 });
    const run = board => signedReal(board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['collector'] })[0], 'collector');
    assert.notEqual(run(generic), run(exact));
  });
});
