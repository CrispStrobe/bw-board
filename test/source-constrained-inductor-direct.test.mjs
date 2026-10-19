import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';
import { spiceSineDerivative } from '../src/source-waveforms.js';

function bench({ flipInductor = false, flipSource = false, extra = [] } = {}) {
  const lTerms = flipInductor ? ['b', 'a'] : ['a', 'b'];
  const iTerms = flipSource ? ['pos', 'neg'] : ['neg', 'pos'];
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'L1', kind: 'inductor', params: { henrys: 1 }, terminals: ['a', 'b'] },
    { id: 'I1', kind: 'isource', params: {
      wave: 'spice-sine', offset: 0, amplitude: 1, freq: 1,
      td: 0, theta: 0, phase: 0,
    }, terminals: ['pos', 'neg'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ...extra,
  ], [
    { id: 'n', terminals: [
      { part: 'L1', terminal: lTerms[0] }, { part: 'I1', terminal: iTerms[0] },
      ...extra.map(part => ({ part: part.id, terminal: part.terminals[0] })),
    ] },
    { id: 'gnd', terminals: [
      { part: 'L1', terminal: lTerms[1] }, { part: 'I1', terminal: iTerms[1] },
      { part: 'G1', terminal: 'gnd' },
      ...extra.map(part => ({ part: part.id, terminal: part.terminals[1] })),
    ] },
  ]);
  return board;
}

describe('source-constrained ideal-inductor endpoint execution', () => {
  it('runs all of ADI row 5158 exactly without companion subtraction', () => {
    const board = bench();
    board.configureTransientAnalysis('precision-v1');
    board.initializeTransientFromOperatingPoint();
    assert.equal(board.transientAnalysisStatus().integrationMode,
      'source-constrained-inductor-direct');
    for (let index = 1; index <= 100; index++) {
      const time = index * 0.03;
      board.advanceTo(BigInt(Math.round(time * 1e9)));
      const expectedCurrent = -Math.sin(2 * Math.PI * time);
      const expectedVoltage = -2 * Math.PI * Math.cos(2 * Math.PI * time);
      assert.ok(Math.abs(board.inductorCurrents.get('L1') - expectedCurrent) < 1e-14);
      assert.ok(Math.abs(board.nodeVoltage('n') - expectedVoltage) < 1e-12);
      assert.ok(Math.abs(board.branchCurrent('L1', 'a')
        + board.branchCurrent('I1', 'neg')) < 1e-14, 'node KCL remains exact');
    }
    assert.deepEqual(board.transientAnalysisStatus().work,
      { attempts: 100, solves: 0, advances: 100 });
    assert.equal(board.transientAnalysisStatus().accuracyMet, true);
    assert.equal(board.transientAnalysisStatus().failure, null);
  });

  it('derives delayed, damped and phase-shifted SPICE SINE slopes exactly', () => {
    const params = { offset: 2, amplitude: 3, freq: 5, td: 0.2, theta: 0.7, phase: 30 };
    assert.equal(spiceSineDerivative(params, 0.1), 0);
    const elapsed = 0.17;
    const angle = 2 * Math.PI * params.freq * elapsed + params.phase * Math.PI / 180;
    const expected = params.amplitude * Math.exp(-params.theta * elapsed)
      * (2 * Math.PI * params.freq * Math.cos(angle) - params.theta * Math.sin(angle));
    assert.ok(Math.abs(spiceSineDerivative(params, params.td + elapsed) - expected) < 1e-13);
  });

  it('preserves polarity when either authored element is reversed', () => {
    for (const flipInductor of [false, true]) {
      for (const flipSource of [false, true]) {
        const board = bench({ flipInductor, flipSource });
        board.configureTransientAnalysis('precision-v1');
        board.initializeTransientFromOperatingPoint();
        board.advanceTo(100_000_000n);
        const kcl = board.branchCurrent('L1', flipInductor ? 'b' : 'a')
          + board.branchCurrent('I1', flipSource ? 'pos' : 'neg');
        assert.ok(Math.abs(kcl) < 1e-14);
        assert.ok(Math.abs(Math.abs(board.nodeVoltage('n'))
          - Math.abs(2 * Math.PI * Math.cos(0.2 * Math.PI))) < 1e-12);
      }
    }
  });

  it('does not admit a load, scope, or different waveform', () => {
    const loaded = bench({ extra: [
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ] });
    assert.equal(loaded._transientIntegrationMode(), 'adaptive');
    const scoped = bench();
    scoped.addScopeChannel({ type: 'voltage', netId: 'n', sampleRateHz: 1000 });
    assert.equal(scoped._transientIntegrationMode(), 'adaptive');
    const other = bench();
    other.parts.find(part => part.id === 'I1').params.wave = 'sine';
    other._solveParts.find(part => part.id === 'I1').params.wave = 'sine';
    assert.equal(other._transientIntegrationMode(), 'adaptive');
  });
});
