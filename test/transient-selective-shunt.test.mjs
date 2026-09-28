import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';
import { solveMNA } from '../src/mna.js';

function row5158() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'L1', kind: 'inductor', params: { henrys: 1 }, terminals: ['a', 'b'] },
    { id: 'I1', kind: 'isource', params: {
      wave: 'spice-sine', offset: 0, amplitude: 1, freq: 1,
      td: 0, theta: 0, phase: 0,
    }, terminals: ['pos', 'neg'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n', terminals: [
      { part: 'L1', terminal: 'a' }, { part: 'I1', terminal: 'neg' },
    ] },
    { id: 'gnd', terminals: [
      { part: 'L1', terminal: 'b' }, { part: 'I1', terminal: 'pos' },
      { part: 'G1', terminal: 'gnd' },
    ] },
  ]);
  return board;
}

describe('transient matrix-derived selective node shunts', () => {
  it('does not turn GMIN into a physical 1 ps time constant on ADI row 5158', () => {
    const board = row5158();
    board.configureTransientAnalysis('precision-v1');
    board.initializeTransientFromOperatingPoint();
    board.advanceTo(30_000_000n);
    const expectedVoltage = -2 * Math.PI * Math.cos(2 * Math.PI * 0.03);
    const expectedCurrent = -Math.sin(2 * Math.PI * 0.03);
    assert.equal(board.transientAnalysisStatus().accuracyMet, true);
    assert.ok(Math.abs(board.nodeVoltage('n') - expectedVoltage) < 3e-5,
      `${board.nodeVoltage('n')} V vs exact ${expectedVoltage} V`);
    assert.ok(Math.abs(board.inductorCurrents.get('L1') - expectedCurrent) < 1e-12,
      `${board.inductorCurrents.get('L1')} A vs exact ${expectedCurrent} A`);
    assert.ok(board.transientAnalysisStatus().work.attempts < 1000);
  });

  it('keeps GMIN on a genuinely undetermined transient row', () => {
    const parts = [
      { id: 'I1', kind: 'isource', params: { amps: 1e-3 }, terminals: ['pos', 'neg'] },
      { id: 'J1', kind: 'header', params: {}, terminals: ['p'] },
      { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'floating', terminals: [
        { part: 'I1', terminal: 'pos' }, { part: 'J1', terminal: 'p' },
      ] },
      { id: 'gnd', terminals: [
        { part: 'I1', terminal: 'neg' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ];
    const result = solveMNA(parts, nets, new Map(), new Map(), 5, {
      transient: { dtSec: 1e-6, method: 'be', capVoltages: new Map(),
        inductorCurrents: new Map(), capCurrents: new Map(), inductorVoltages: new Map() },
    });
    assert.equal(result.converged, true);
    assert.ok(Number.isFinite(result.nodeVoltages.get('floating')));
    assert.ok(Math.abs(result.nodeVoltages.get('floating')) > 1e8,
      'the numerical shunt remains load-bearing on the otherwise empty row');
  });
});
