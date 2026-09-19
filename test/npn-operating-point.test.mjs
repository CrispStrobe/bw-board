import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

// Measured against ngspice 42 itself.  Its internal k/q is not the modern
// CODATA quotient used by our earlier oracle conversion; this is the
// temperature at which ngspice actually evaluates Vt as the engine's declared
// 0.02585 V.  Keeping TEMP and TNOM equal prevents IS temperature rescaling.
const NGSPICE_MATCHED_TEMP_C = 26.826895261366076;
const PARAMS = Object.freeze({ model: 'shockley', is: 1e-14, beta: 100, vaf: 100 });

function activeBench(params = PARAMS, { disconnect = null, kind = 'npn' } = {}) {
  const board = new BoardImpl(5);
  const nets = [
    { id: 'gnd', terminals: [
      { part: 'VCC', terminal: 'neg' }, { part: 'R2', terminal: 'b' },
      { part: 'RE', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'vcc', terminals: [
      { part: 'VCC', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
      { part: 'RC', terminal: 'a' },
    ] },
    { id: 'base', terminals: [
      { part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' },
      { part: 'Q1', terminal: 'base' },
    ] },
    { id: 'collector', terminals: [
      { part: 'RC', terminal: 'b' }, { part: 'Q1', terminal: 'collector' },
    ] },
    { id: 'emitter', terminals: [
      { part: 'RE', terminal: 'a' }, { part: 'Q1', terminal: 'emitter' },
    ] },
  ].map(net => ({ ...net, terminals: net.terminals.filter(terminal =>
    terminal.part !== 'Q1' || terminal.terminal !== disconnect) }));
  board.setNetlist([
    { id: 'VCC', kind: 'vsource', params: { volts: 12 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 200000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 15000 }, terminals: ['a', 'b'] },
    { id: 'RC', kind: 'resistor', params: { ohms: 12000 }, terminals: ['a', 'b'] },
    { id: 'RE', kind: 'resistor', params: { ohms: 47 }, terminals: ['a', 'b'] },
    { id: 'Q1', kind, params: { ...params }, terminals: ['collector', 'base', 'emitter'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], nets);
  return board;
}

function saturatedBench() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'RB', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'RC', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
    { id: 'Q1', kind: 'npn', params: { model: 'shockley', is: 1e-14, beta: 200 },
      terminals: ['collector', 'base', 'emitter'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' }, { part: 'Q1', terminal: 'emitter' },
      { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'v', terminals: [
      { part: 'V1', terminal: 'pos' }, { part: 'RB', terminal: 'a' }, { part: 'RC', terminal: 'a' },
    ] },
    { id: 'base', terminals: [{ part: 'RB', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
    { id: 'collector', terminals: [{ part: 'RC', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
  ]);
  return board;
}

function baseResistanceBench(rb = 10) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VCC', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 3.3 }, terminals: ['pos', 'neg'] },
    { id: 'RB', kind: 'resistor', params: { ohms: 30000 }, terminals: ['a', 'b'] },
    { id: 'RL', kind: 'resistor', params: { ohms: 8200 }, terminals: ['a', 'b'] },
    { id: 'Q1', kind: 'npn',
      params: { model: 'shockley', is: 3e-9, beta: 200, vaf: 130, rb },
      terminals: ['collector', 'base', 'emitter'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'VCC', terminal: 'neg' }, { part: 'VIN', terminal: 'neg' },
      { part: 'Q1', terminal: 'emitter' }, { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'vcc', terminals: [
      { part: 'VCC', terminal: 'pos' }, { part: 'RL', terminal: 'a' },
    ] },
    { id: 'in', terminals: [
      { part: 'VIN', terminal: 'pos' }, { part: 'RB', terminal: 'a' },
    ] },
    { id: 'base', terminals: [
      { part: 'RB', terminal: 'b' }, { part: 'Q1', terminal: 'base' },
    ] },
    { id: 'collector', terminals: [
      { part: 'RL', terminal: 'b' }, { part: 'Q1', terminal: 'collector' },
    ] },
  ]);
  return board;
}

function ngspice(deck, names) {
  const text = `* self-authored explicit NPN operating point
.temp ${NGSPICE_MATCHED_TEMP_C}
.options tnom=${NGSPICE_MATCHED_TEMP_C} reltol=1e-12 abstol=1e-18 vntol=1e-15
${deck}
.control
set numdgt=17
op
print ${names.join(' ')}
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], { input: text, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return Object.fromEntries(names.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from:\n${run.stdout}`);
    return [name, Number(match[1])];
  }));
}

function stateWitness(board) {
  return {
    timeNs: board.timeNs, nodeVoltages: board.nodeVoltages, capVoltages: board.capVoltages,
    capCurrents: board.capCurrents, deviceStates: board._deviceStates, controls: board.controls,
    cache: board._mnaCache, parts: JSON.stringify(board._solveParts),
  };
}

function assertUnchanged(board, before) {
  for (const key of ['timeNs', 'nodeVoltages', 'capVoltages', 'capCurrents', 'deviceStates', 'controls', 'cache']) {
    assert.equal(key === 'deviceStates' ? board._deviceStates : key === 'cache' ? board._mnaCache : board[key], before[key]);
  }
  assert.equal(JSON.stringify(board._solveParts), before.parts);
}

describe('BoardImpl.operatingPoint explicit NPN domain', () => {
  it('matches ngspice in active and saturated operation with signed terminal KCL', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const activeOracle = ngspice(`VCC vcc 0 12
R1 vcc base 200k
R2 base 0 15k
RC vcc collector 12k
RE emitter 0 47
Q1 collector base emitter QN
.model QN NPN(IS=1e-14 BF=100 VAF=100)`,
    ['v(base)', 'v(collector)', 'v(emitter)', '@vcc[i]', '@q1[ib]', '@q1[ic]', '@q1[ie]']);
    const board = activeBench({ ...PARAMS, _model: 'QN' });
    const before = stateWitness(board); const active = board.operatingPoint();
    assert.equal(active.converged, true);
    assert.deepEqual(active.analysis.npn, {
      model: 'explicit-ebers-moll-with-forward-early-effect',
      requiredParameters: ['is', 'beta'], optionalParameters: ['br', 'n', 'vaf', 'rb'],
      defaults: { br: 1, n: 1, vaf: 'infinite', rb: 0 }, thermalVoltage: 0.02585,
      temperatureModel: 'fixed',
    });
    for (const [net, oracle] of [['base', 'v(base)'], ['collector', 'v(collector)'], ['emitter', 'v(emitter)']]) {
      assert.ok(Math.abs(active.nodeVoltages.get(net) - activeOracle[oracle]) < 1e-8,
        `${net}: ${active.nodeVoltages.get(net)} vs ${activeOracle[oracle]}`);
    }
    const q = active.branchCurrents.get('Q1');
    for (const [terminal, oracle] of [['base', '@q1[ib]'], ['collector', '@q1[ic]'], ['emitter', '@q1[ie]']]) {
      assert.ok(Math.abs(q.get(terminal) - activeOracle[oracle]) < 1e-10,
        `${terminal}: ${q.get(terminal)} vs ${activeOracle[oracle]}`);
    }
    assert.ok(Math.abs(q.get('base') + q.get('collector') + q.get('emitter')) < 1e-12);
    assert.ok(Math.abs(active.branchCurrents.get('VCC').get('pos') - activeOracle['@vcc[i]']) < 1e-10);
    assertUnchanged(board, before);

    const saturatedOracle = ngspice(`V1 v 0 5
RB v base 1k
RC v collector 10
Q1 collector base 0 QN
.model QN NPN(IS=1e-14 BF=200)`, ['v(base)', 'v(collector)', '@q1[ib]', '@q1[ic]', '@q1[ie]']);
    const saturated = saturatedBench().operatingPoint(); const sq = saturated.branchCurrents.get('Q1');
    assert.ok(Math.abs(saturated.nodeVoltages.get('base') - saturatedOracle['v(base)']) < 1e-8);
    assert.ok(Math.abs(saturated.nodeVoltages.get('collector') - saturatedOracle['v(collector)']) < 1e-8);
    for (const [terminal, oracle] of [['base', '@q1[ib]'], ['collector', '@q1[ic]'], ['emitter', '@q1[ie]']]) {
      assert.ok(Math.abs(sq.get(terminal) - saturatedOracle[oracle]) < 1e-10);
    }
  });

  it('matches ngspice explicit RB through a real intrinsic-base node', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const oracle = ngspice(`VCC vcc 0 9
VIN in 0 3.3
RB in base 30k
RL vcc collector 8.2k
Q1 collector base 0 QN
.model QN NPN(IS=3n BF=200 VAF=130 RB=10)`,
    ['v(base)', 'v(collector)', '@vin[i]', '@vcc[i]', '@q1[ib]', '@q1[ic]', '@q1[ie]']);
    const board = baseResistanceBench();
    const before = stateWitness(board);
    const op = board.operatingPoint();
    assert.equal(op.converged, true);
    for (const [net, name] of [['base', 'v(base)'], ['collector', 'v(collector)']]) {
      assert.ok(Math.abs(op.nodeVoltages.get(net) - oracle[name]) < 1e-8,
        `${net}: ${op.nodeVoltages.get(net)} vs ${oracle[name]}`);
    }
    assert.equal([...op.nodeVoltages.keys()].some(key => key.includes('intrinsic-base')), false);
    const q = op.branchCurrents.get('Q1');
    for (const [terminal, name] of [['base', '@q1[ib]'], ['collector', '@q1[ic]'], ['emitter', '@q1[ie]']]) {
      assert.ok(Math.abs(q.get(terminal) - oracle[name]) < 1e-10,
        `${terminal}: ${q.get(terminal)} vs ${oracle[name]}`);
    }
    assert.ok(Math.abs(q.get('base') + q.get('collector') + q.get('emitter')) < 1e-15);
    assert.ok(Math.abs(q.get('base') - (3.3 - op.nodeVoltages.get('base')) / 30000) < 1e-12);
    assert.ok(Math.abs(op.branchCurrents.get('VIN').get('pos') - oracle['@vin[i]']) < 1e-10);
    assert.ok(Math.abs(op.branchCurrents.get('VCC').get('pos') - oracle['@vcc[i]']) < 1e-10);
    assertUnchanged(board, before);
  });

  it('keeps omitted and explicit zero RB byte-for-behaviour identical', () => {
    assert.deepEqual(activeBench(PARAMS).operatingPoint(),
      activeBench({ ...PARAMS, rb: 0 }).operatingPoint());
  });

  it('refuses implicit, incomplete, invalid, extra, disconnected, and PNP semantics', () => {
    const cases = [
      [{ is: 1e-14, beta: 100 }, /model must be explicitly/],
      [{ ...PARAMS, is: 0 }, /is must be an explicit finite number greater than zero/],
      [{ ...PARAMS, beta: NaN }, /beta must be an explicit finite number greater than zero/],
      [{ ...PARAMS, br: 0 }, /br must be a finite number greater than zero/],
      [{ ...PARAMS, n: -1 }, /n must be a finite number greater than zero/],
      [{ ...PARAMS, vaf: 0 }, /vaf must be a finite number greater than zero/],
      [{ ...PARAMS, rb: -1 }, /rb must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, rb: NaN }, /rb must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, ikf: 0.3 }, /parameter ikf is outside/],
      [{ ...PARAMS, _model: '' }, /_model must be a non-empty inert source-model name/],
    ];
    for (const [params, pattern] of cases) {
      const board = activeBench(params); const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern); assertUnchanged(board, before);
    }
    assert.throws(() => activeBench(PARAMS, { disconnect: 'collector' }).operatingPoint(),
      /terminal collector is not connected/);
    assert.throws(() => activeBench(PARAMS, { kind: 'pnp' }).operatingPoint(),
      /unsupported part Q1 \(pnp\)/);
  });
});
