import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const resistor = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

function rcBench(volts = 5) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    resistor('R1', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
    gnd,
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'C1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
  ]);
  return board;
}

function stateWitness(board) {
  return {
    timeNs: board.timeNs,
    nodeVoltages: board.nodeVoltages,
    capVoltages: board.capVoltages,
    capCurrents: board.capCurrents,
    inductorCurrents: board.inductorCurrents,
    inductorVoltages: board.inductorVoltages,
    probes: board._probes,
    ledHistory: board.ledHistory,
    deviceStates: board._deviceStates,
    controls: board.controls,
    cache: board._mnaCache,
    parts: JSON.stringify(board._solveParts),
  };
}

function assertUnchanged(board, before) {
  assert.equal(board.timeNs, before.timeNs);
  assert.equal(board.nodeVoltages, before.nodeVoltages);
  assert.equal(board.capVoltages, before.capVoltages);
  assert.equal(board.capCurrents, before.capCurrents);
  assert.equal(board.inductorCurrents, before.inductorCurrents);
  assert.equal(board.inductorVoltages, before.inductorVoltages);
  assert.equal(board._probes, before.probes);
  assert.equal(board.ledHistory, before.ledHistory);
  assert.equal(board._deviceStates, before.deviceStates);
  assert.equal(board.controls, before.controls);
  assert.equal(board._mnaCache, before.cache);
  assert.equal(JSON.stringify(board._solveParts), before.parts);
}

describe('BoardImpl.operatingPoint', () => {
  it('opens a capacitor at DC, returns signed currents, and never adopts the result', () => {
    const board = rcBench(5);
    assert.ok(board.nodeVoltage('out') < 1e-5, 'live t=0 state keeps the uncharged capacitor at 0 V');
    const before = stateWitness(board);
    let notifications = 0;
    const listener = () => { notifications++; };
    board.onChange(listener);
    const first = board.operatingPoint();
    const second = board.operatingPoint();
    board.offChange(listener);
    assert.equal(first.converged, true);
    assert.deepEqual(first.railConflicts, []);
    assert.ok(Math.abs(first.nodeVoltages.get('out') - 5) < 1e-6);
    assert.equal(first.branchCurrents.get('C1').get('a'), 0);
    assert.ok(Math.abs(first.branchCurrents.get('R1').get('a')) < 1e-9);
    assert.ok(Math.abs(first.branchCurrents.get('V1').get('pos')) < 1e-9);
    assert.equal(first.analysis.currentConvention, 'positive-into-part-terminal');
    assert.notEqual(first.nodeVoltages, second.nodeVoltages);
    assert.equal(notifications, 0);
    assertUnchanged(board, before);
  });

  it('normalizes positive and negative resistor/source currents and satisfies KCL', () => {
    for (const volts of [5, -5]) {
      const board = new BoardImpl(5);
      board.setNetlist([
        { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
        resistor('R1', 1000), gnd,
      ], [
        { id: 'n', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
        { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
      ]);
      const op = board.operatingPoint();
      const iR = op.branchCurrents.get('R1').get('a');
      const iV = op.branchCurrents.get('V1').get('pos');
      assert.ok(Math.abs(iR - volts / 1000) < 1e-9, `${volts} V resistor current`);
      assert.ok(Math.abs(iV + volts / 1000) < 2e-11, `${volts} V source current`);
      assert.ok(Math.abs(iR + iV) < 2e-11, `${volts} V node KCL`);
    }
  });

  it('normalizes an independent current source as current into its terminals', () => {
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'I1', kind: 'isource', params: { amps: 0.002 }, terminals: ['pos', 'neg'] },
      resistor('R1', 1000), gnd,
    ], [
      { id: 'n', terminals: [{ part: 'I1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'I1', terminal: 'neg' }, { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    const op = board.operatingPoint();
    assert.ok(Math.abs(op.nodeVoltages.get('n') - 2) < 1e-8);
    assert.equal(op.branchCurrents.get('I1').get('pos'), -0.002);
    assert.equal(op.branchCurrents.get('I1').get('neg'), 0.002);
    assert.ok(Math.abs(op.branchCurrents.get('R1').get('a') - 0.002) < 1e-11);
  });

  it('matches ngspice .op for the self-authored RC deck', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const deck = '* self-authored RC operating point\nV1 in 0 DC 5\nR1 in out 1k\nC1 out 0 1u\n.op\n.end\n';
    const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const match = ng.stdout.match(/out\s+([+\-0-9.e]+)/i);
    assert.ok(match, ng.stdout);
    const op = rcBench().operatingPoint();
    assert.ok(Math.abs(op.nodeVoltages.get('out') - Number(match[1])) < 1e-6);
  });

  it('returns non-convergence explicitly instead of blessing the last iterate', () => {
    const board = new BoardImpl(5);
    const source = (id, volts) => ({
      id, kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'],
    });
    board.setNetlist([source('V1', 5), source('V2', 3), gnd], [
      { id: 'n', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'V2', terminal: 'pos' }] },
      { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'V2', terminal: 'neg' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    const before = stateWitness(board);
    const op = board.operatingPoint();
    assert.equal(op.converged, false, 'contradictory ideal sources have no operating point');
    assertUnchanged(board, before);
  });

  it('refuses unsupported and DC-floating semantics without touching live state', () => {
    const cases = [
      [{ id: 'V1', kind: 'vsource', params: { wave: 'sine' }, terminals: ['pos', 'neg'] }, /time-varying/],
      [{ id: 'V1', kind: 'vsource', params: { volts: 5, iLimit: 0.1 }, terminals: ['pos', 'neg'] }, /current-limited/],
      [{ id: 'L1', kind: 'inductor', params: { henrys: 1e-3 }, terminals: ['a', 'b'] }, /unsupported part L1 \(inductor\)/],
      [{ id: 'D1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] }, /unsupported part D1 \(diode\)/],
    ];
    for (const [part, pattern] of cases) {
      const board = new BoardImpl(5);
      const terms = part.terminals;
      board.setNetlist([part, gnd], [
        { id: 'n', terminals: [{ part: part.id, terminal: terms[0] }] },
        { id: 'gnd', terminals: [{ part: part.id, terminal: terms[1] }, { part: 'G1', terminal: 'gnd' }] },
      ]);
      const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern);
      assertUnchanged(board, before);
    }

    const floating = new BoardImpl(5);
    floating.setNetlist([
      { id: 'I1', kind: 'isource', params: { amps: 1e-3 }, terminals: ['pos', 'neg'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }, gnd,
    ], [
      { id: 'float', terminals: [{ part: 'I1', terminal: 'pos' }, { part: 'C1', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'I1', terminal: 'neg' }, { part: 'C1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    const before = stateWitness(floating);
    assert.throws(() => floating.operatingPoint(), /DC-floating net float/);
    assertUnchanged(floating, before);
  });
});
