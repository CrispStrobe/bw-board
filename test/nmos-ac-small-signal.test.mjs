import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';
import { mosGds, mosK, mosTriode, smoothVov } from '../src/mna.js';

const gnd = { id: 'G0', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...terminals) => ({ id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });
const params = Object.freeze({ model: 'level1', vth: 1, kp: 50e-6,
  w: 100e-6, l: 1e-6, lambda: 0.01, bulkAtGround: true });

function bench({ supply, load }) {
  const board = new BoardImpl(5);
  board.setNetlist([
    gnd,
    { id: 'VIN', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
    { id: 'VDD', kind: 'vsource', params: { volts: supply }, terminals: ['pos', 'neg'] },
    { id: 'RD', kind: 'resistor', params: { ohms: load }, terminals: ['a', 'b'] },
    { id: 'M1', kind: 'nmos', params: { ...params }, terminals: ['drain', 'gate', 'source'] },
  ], [
    net('gnd', ['G0', 'gnd'], ['VIN', 'neg'], ['VDD', 'neg'], ['M1', 'source']),
    net('gate', ['VIN', 'pos'], ['M1', 'gate']),
    net('vdd', ['VDD', 'pos'], ['RD', 'a']),
    net('drain', ['RD', 'b'], ['M1', 'drain']),
  ]);
  return board;
}

function signedReal(row, node) {
  const value = row.results.get(node);
  return value.mag * Math.cos(value.phaseDeg * Math.PI / 180);
}

describe('strict grounded-bulk Level-1 NMOS small-signal AC', () => {
  for (const fixture of [
    { name: 'saturation', supply: 10, load: 1000 },
    { name: 'triode', supply: 0.5, load: 100 },
  ]) it(`uses the DC Level-1 ${fixture.name} Jacobian`, () => {
    const board = bench(fixture);
    const before = board.operatingPoint();
    const vd = before.nodeVoltages.get('drain');
    const k = mosK(params);
    const [vov, dVov] = smoothVov(1);
    let gm;
    let gds;
    if (vd < vov) {
      ({ gm, gds } = mosTriode(k, vov, vd, dVov, params));
      gds += 1e-12;
    } else {
      const id0 = k * vov * vov;
      gm = 2 * k * vov * dVov * (1 + params.lambda * vd);
      gds = mosGds(params, id0, dVov);
    }
    const expected = -gm / (1 / fixture.load + gds);
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['drain'] })[0];
    assert.ok(Math.abs(signedReal(row, 'drain') - expected) < 1e-10,
      `${signedReal(row, 'drain')} vs ${expected}`);
    const after = board.operatingPoint();
    assert.deepEqual([...after.nodeVoltages], [...before.nodeVoltages],
      'small-signal analysis must not adopt or move the DC operating point');
  });

  it('retains the generic interactive MOS compatibility model', () => {
    const strict = bench({ supply: 10, load: 1000 });
    const generic = bench({ supply: 10, load: 1000 });
    generic._solveParts.find(part => part.id === 'M1').params = { vth: 1, k: 0.5 };
    const run = board => signedReal(board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['drain'] })[0], 'drain');
    assert.notEqual(run(generic), run(strict));
  });
});
