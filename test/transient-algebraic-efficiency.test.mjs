import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const ground = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };

function fourierBoard(profile = 'precision-v1') {
  const board = new BoardImpl(5);
  board.configureTransientAnalysis(profile);
  const parts = [{ id: 'R1', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] }, ground];
  const nets = [{ id: 'out', terminals: [{ part: 'R1', terminal: 'a' }] },
    { id: '0', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'GND', terminal: 'gnd' }] }];
  for (let index = 1; index <= 28; index++) {
    const left = index === 1 ? 'out' : `n${index - 1}`;
    const right = index === 28 ? '0' : `n${index}`;
    parts.push({ id: `V${index}`, kind: 'vsource', params: {
      wave: 'spice-sine', offset: index === 1 ? 0.31830989 : 0,
      amplitude: (index % 2 ? 1 : -1) / (index + 1), freq: (index % 14) + 1,
      td: 0, theta: 0, phase: index <= 8 ? 90 : 0,
    }, terminals: ['pos', 'neg'] });
    const net = id => nets.find(candidate => candidate.id === id)
      || (nets.push({ id, terminals: [] }), nets.at(-1));
    net(left).terminals.push({ part: `V${index}`, terminal: 'pos' });
    net(right).terminals.push({ part: `V${index}`, terminal: 'neg' });
  }
  board.setNetlist(parts, nets);
  board.initializeTransientFromOperatingPoint();
  return board;
}

function fourierVoltageAt(tSec) {
  let value = 0;
  for (let index = 1; index <= 28; index++) {
    const offset = index === 1 ? 0.31830989 : 0;
    const amplitude = (index % 2 ? 1 : -1) / (index + 1);
    const frequency = (index % 14) + 1;
    const phase = index <= 8 ? Math.PI / 2 : 0;
    value += offset + amplitude * Math.sin(2 * Math.PI * frequency * tSec + phase);
  }
  return value;
}

describe('stateless transient execution', () => {
  it('solves a long many-source algebraic waveform once per requested endpoint', () => {
    const board = fourierBoard();
    assert.equal(board.transientAnalysisStatus().integrationMode, 'algebraic-direct');
    for (let point = 1; point <= 100; point++) board.advanceTo(BigInt(point * 60_000_000));
    const status = board.transientAnalysisStatus();
    assert.deepEqual(status.work, { attempts: 100, solves: 100, advances: 100 });
    assert.equal(status.accuracyMet, true);
    assert.equal(status.failure, null);
    assert.ok(Math.abs(board.nodeVoltage('out') - fourierVoltageAt(6)) < 1e-9,
      `direct endpoint ${board.nodeVoltage('out')} must equal independent source sum ${fourierVoltageAt(6)}`);
  });

  it('retains the adaptive path for storage and for an observable scope grid', () => {
    const reactive = fourierBoard();
    const parts = reactive.parts.map(part => ({ ...part, params: { ...part.params } }));
    const nets = reactive.nets.map(net => ({ ...net, terminals: net.terminals.map(term => ({ ...term })) }));
    parts.push({ id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] });
    nets.find(net => net.id === 'out').terminals.push({ part: 'C1', terminal: 'a' });
    nets.find(net => net.id === '0').terminals.push({ part: 'C1', terminal: 'b' });
    reactive.setNetlist(parts, nets);
    assert.equal(reactive.transientAnalysisStatus().integrationMode, 'adaptive');

    const scoped = fourierBoard();
    scoped.addScopeChannel('out', { intervalNs: 1_000_000n, capture: 'sample' });
    assert.equal(scoped.transientAnalysisStatus().integrationMode, 'adaptive');
  });
});
