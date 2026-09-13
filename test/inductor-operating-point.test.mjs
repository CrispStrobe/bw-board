import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

function rlBench(volts = 2, params = { henrys: 0.003 }) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'L1', kind: 'inductor', params: { ...params }, terminals: ['a', 'b'] },
    gnd,
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'L1', terminal: 'a' }] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' }, { part: 'L1', terminal: 'b' },
      { part: 'G1', terminal: 'gnd' },
    ] },
  ]);
  return board;
}

function stateWitness(board) {
  return {
    timeNs: board.timeNs,
    nodeVoltages: board.nodeVoltages,
    inductorCurrents: board.inductorCurrents,
    inductorVoltages: board.inductorVoltages,
    controls: board.controls,
    cache: board._mnaCache,
    nodeVoltageValues: structuredClone(board.nodeVoltages),
    inductorCurrentValues: structuredClone(board.inductorCurrents),
    inductorVoltageValues: structuredClone(board.inductorVoltages),
    controlValues: structuredClone(board.controls),
    parts: JSON.stringify(board._solveParts),
    nets: JSON.stringify(board._solveNets),
  };
}

function assertUnchanged(board, before) {
  assert.equal(board.timeNs, before.timeNs);
  assert.equal(board.nodeVoltages, before.nodeVoltages);
  assert.equal(board.inductorCurrents, before.inductorCurrents);
  assert.equal(board.inductorVoltages, before.inductorVoltages);
  assert.equal(board.controls, before.controls);
  assert.equal(board._mnaCache, before.cache);
  assert.deepEqual(board.nodeVoltages, before.nodeVoltageValues);
  assert.deepEqual(board.inductorCurrents, before.inductorCurrentValues);
  assert.deepEqual(board.inductorVoltages, before.inductorVoltageValues);
  assert.deepEqual(board.controls, before.controlValues);
  assert.equal(JSON.stringify(board._solveParts), before.parts);
  assert.equal(JSON.stringify(board._solveNets), before.nets);
}

function ngspicePoint(volts) {
  const deck = `* self-authored exact ideal-inductor DC bench
V1 in 0 DC ${volts}
R1 in out 1k
L1 out 0 3m
.control
set numdgt=17
op
print v(out) @l1[i] @v1[i]
.endc
.end
`;
  const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
  assert.equal(ng.status, 0, ng.stderr || ng.stdout);
  const read = expr => {
    const match = ng.stdout.match(new RegExp(`${expr}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, ng.stdout);
    return Number(match[1]);
  };
  return { out: read('v\\(out\\)'), inductor: read('@l1\\[i\\]'), source: read('@v1\\[i\\]') };
}

describe('BoardImpl.operatingPoint exact ideal-inductor snapshot', () => {
  it('matches self-authored ngspice for both polarities, signed branch currents, and KCL', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const volts of [2, -2]) {
      const expected = ngspicePoint(volts);
      const op = rlBench(volts).operatingPoint();
      const iL = op.branchCurrents.get('L1').get('a');
      const iV = op.branchCurrents.get('V1').get('pos');
      const iR = op.branchCurrents.get('R1').get('a');
      assert.equal(op.converged, true);
      assert.equal(op.nodeVoltages.get('out'), expected.out);
      assert.ok(Math.abs(iL - expected.inductor) < 1e-12);
      assert.ok(Math.abs(iV - expected.source) < 3e-12,
        'the remaining source-current delta is the engine node GMIN');
      assert.equal(Math.sign(iL), Math.sign(volts), 'positive means current into terminal a');
      assert.equal(Math.sign(iV), -Math.sign(volts), 'source delivery enters its negative terminal');
      assert.ok(Math.abs(iR - iL) < 1e-12, 'series current agrees');
      assert.ok(Math.abs(iV + iR) < 3e-12, 'input-node KCL including node GMIN');
      assert.ok(Math.abs(op.branchCurrents.get('L1').get('b') + iL) < 1e-12);
    }
  });

  it('uses an exact OP-only short and preserves nonzero transient energy and all live state', () => {
    const board = rlBench();
    board.setControl('V1', 2);
    board.advanceTo(1000n);
    assert.ok(Math.abs(board.inductorCurrents.get('L1')) > 1e-6);
    assert.ok(Math.abs(board.inductorVoltages.get('L1')) > 1e-3);
    const energyBefore = 0.5 * 0.003 * board.inductorCurrents.get('L1') ** 2;
    const before = stateWitness(board);
    const first = board.operatingPoint();
    const second = board.operatingPoint();
    assert.equal(first.nodeVoltages.get('out'), 0, 'OP uses an exact 0 V constraint, not 1 mOhm');
    assert.equal(first.analysis.inductors, 'exact-ideal-dc-short-explicit-henrys');
    assert.ok(first.analysis.supportedKinds.includes('inductor'));
    assert.notEqual(first.nodeVoltages, second.nodeVoltages);
    assertUnchanged(board, before);
    const energyAfter = 0.5 * 0.003 * board.inductorCurrents.get('L1') ** 2;
    assert.equal(energyAfter, energyBefore, 'observational OP does not adopt or erase stored energy');
  });

  it('refuses unsupported parameter semantics before lowering', () => {
    const cases = [
      [{ henrys: 0 }, /henrys must be an explicit finite number greater than zero/],
      [{ henrys: -1 }, /henrys must be an explicit finite number greater than zero/],
      [{ henrys: Infinity }, /henrys must be an explicit finite number greater than zero/],
      [{ henrys: 0.003, ic: 1 }, /parameter ic is outside/],
      [{ henrys: 0.003, rser: 0.1 }, /parameter rser is outside/],
      [{ henrys: 0.003, coupling: 'L2' }, /parameter coupling is outside/],
    ];
    for (const [params, pattern] of cases) {
      const board = rlBench(2, params);
      const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern);
      assertUnchanged(board, before);
    }
  });

  it('refuses disconnected, self-shorted, and parallel indeterminate constraints', () => {
    const disconnected = new BoardImpl(5);
    disconnected.setNetlist([
      { id: 'L1', kind: 'inductor', params: { henrys: 0.003 }, terminals: ['a', 'b'] },
      gnd,
    ], [{ id: 'gnd', terminals: [{ part: 'L1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] }]);
    assert.throws(() => disconnected.operatingPoint(), /terminal a is not connected/);

    const self = new BoardImpl(5);
    self.setNetlist([
      { id: 'L1', kind: 'inductor', params: { henrys: 0.003 }, terminals: ['a', 'b'] },
      gnd,
    ], [{ id: 'gnd', terminals: [
      { part: 'L1', terminal: 'a' }, { part: 'L1', terminal: 'b' },
      { part: 'G1', terminal: 'gnd' },
    ] }]);
    assert.throws(() => self.operatingPoint(), /self-shorted inductor L1/);

    for (const second of [
      { id: 'L2', kind: 'inductor', params: { henrys: 0.006 }, terminals: ['a', 'b'] },
      { id: 'V0', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
    ]) {
      const board = new BoardImpl(5);
      const secondTerms = second.kind === 'inductor' ? ['a', 'b'] : ['pos', 'neg'];
      board.setNetlist([
        { id: 'L1', kind: 'inductor', params: { henrys: 0.003 }, terminals: ['a', 'b'] },
        second, gnd,
      ], [
        { id: 'n', terminals: [
          { part: 'L1', terminal: 'a' }, { part: second.id, terminal: secondTerms[0] },
        ] },
        { id: 'gnd', terminals: [
          { part: 'L1', terminal: 'b' }, { part: second.id, terminal: secondTerms[1] },
          { part: 'G1', terminal: 'gnd' },
        ] },
      ]);
      assert.throws(() => board.operatingPoint(),
        new RegExp(`parallel ideal constraints L1 and ${second.id}`));
    }
  });
});
