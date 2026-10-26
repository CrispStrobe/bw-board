import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { JUNCTION_GMIN } from '../src/mna.js';
import { withJunctionEdgeOmitted } from './helpers/junction-dc-source-mutation.mjs';

// Measured against ngspice 42 itself.  Its internal k/q is not the modern
// CODATA quotient used by our earlier oracle conversion; this is the
// temperature at which ngspice actually evaluates Vt as the engine's declared
// 0.02585 V.  Keeping TEMP and TNOM equal prevents IS temperature rescaling.
const NGSPICE_MATCHED_TEMP_C = 26.826895261366076;
const PARAMS = Object.freeze({ model: 'shockley', is: 1e-14, beta: 100, vaf: 100 });

function activeBench(params = PARAMS, { disconnect = null, kind = 'npn', BoardType = BoardImpl } = {}) {
  const board = new BoardType(5);
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

function highCurrentBench(params) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VCC', kind: 'vsource', params: { volts: 12 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
    { id: 'RC', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
    { id: 'RE', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
    { id: 'Q1', kind: 'npn', params, terminals: ['collector', 'base', 'emitter'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
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
  ]);
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
    values: structuredClone({ nodes: board.nodeVoltages, capV: board.capVoltages,
      capI: board.capCurrents, devices: board._deviceStates, controls: board.controls }),
  };
}

function assertUnchanged(board, before) {
  for (const key of ['timeNs', 'nodeVoltages', 'capVoltages', 'capCurrents', 'deviceStates', 'controls', 'cache']) {
    assert.equal(key === 'deviceStates' ? board._deviceStates : key === 'cache' ? board._mnaCache : board[key], before[key]);
  }
  assert.equal(JSON.stringify(board._solveParts), before.parts);
  assert.deepEqual({ nodes: board.nodeVoltages, capV: board.capVoltages,
    capI: board.capCurrents, devices: board._deviceStates, controls: board.controls }, before.values);
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
      model: 'explicit-ebers-moll',
      requiredParameters: ['is', 'beta'],
      optionalParameters: ['br', 'n', 'vaf', 'ikf', 'rb', 'rc', 'cje', 'cjc', 'tf'],
      defaults: { br: 1, n: 1, vaf: 'infinite', ikf: 'infinite', rb: 0, rc: 0,
        cje: 0, cjc: 0, tf: 0 }, thermalVoltage: 0.02585,
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

  it('matches ngspice explicit RC through a real intrinsic-collector node', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const oracle = ngspice(`VCC vcc 0 12
R1 vcc base 200k
R2 base 0 15k
RCLOAD vcc collector 12k
RE emitter 0 47
Q1 collector base emitter QN
.model QN NPN(IS=1e-14 BF=100 VAF=100 RC=100)`,
    ['v(base)', 'v(collector)', 'v(emitter)', '@vcc[i]', '@q1[ib]', '@q1[ic]', '@q1[ie]']);
    const board = activeBench({ ...PARAMS, rc: 100 });
    const before = stateWitness(board); const op = board.operatingPoint();
    assert.equal(op.converged, true);
    for (const [net, name] of [['base', 'v(base)'], ['collector', 'v(collector)'], ['emitter', 'v(emitter)']]) {
      assert.ok(Math.abs(op.nodeVoltages.get(net) - oracle[name]) < 1e-8,
        `${net}: ${op.nodeVoltages.get(net)} vs ${oracle[name]}`);
    }
    const q = op.branchCurrents.get('Q1');
    for (const [terminal, name] of [['base', '@q1[ib]'], ['collector', '@q1[ic]'], ['emitter', '@q1[ie]']]) {
      assert.ok(Math.abs(q.get(terminal) - oracle[name]) < 1e-10,
        `${terminal}: ${q.get(terminal)} vs ${oracle[name]}`);
    }
    assert.ok(Math.abs(q.get('base') + q.get('collector') + q.get('emitter')) < 1e-12);
    assert.ok(Math.abs(op.branchCurrents.get('VCC').get('pos') - oracle['@vcc[i]']) < 1e-10);
    assertUnchanged(board, before);
  });

  it('matches ngspice forward high-current IKF rolloff without scaling base current', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const oracle = ngspice(`VCC vcc 0 12
R1 vcc base 10k
R2 base 0 2k
RC vcc collector 100
RE emitter 0 10
Q1 collector base emitter QN
.model QN NPN(IS=1e-14 BF=200 VAF=100 IKF=0.01)`,
    ['v(base)', 'v(collector)', 'v(emitter)', '@vcc[i]', '@q1[ib]', '@q1[ic]', '@q1[ie]']);
    const board = highCurrentBench({ model: 'shockley', is: 1e-14, beta: 200,
      vaf: 100, ikf: 0.01 });
    const before = stateWitness(board); const op = board.operatingPoint();
    assert.equal(op.converged, true);
    for (const [net, name] of [['base', 'v(base)'], ['collector', 'v(collector)'], ['emitter', 'v(emitter)']]) {
      assert.ok(Math.abs(op.nodeVoltages.get(net) - oracle[name]) < 1e-8,
        `${net}: ${op.nodeVoltages.get(net)} vs ${oracle[name]}`);
    }
    const q = op.branchCurrents.get('Q1');
    for (const [terminal, name] of [['base', '@q1[ib]'], ['collector', '@q1[ic]'], ['emitter', '@q1[ie]']]) {
      assert.ok(Math.abs(q.get(terminal) - oracle[name]) < 1e-10,
        `${terminal}: ${q.get(terminal)} vs ${oracle[name]}`);
    }
    assert.ok(Math.abs(q.get('base') + q.get('collector') + q.get('emitter')) < 1e-12);
    assert.ok(Math.abs(op.branchCurrents.get('VCC').get('pos') - oracle['@vcc[i]']) < 1e-10);
    assertUnchanged(board, before);
  });

  it('keeps omitted and explicit zero RB byte-for-behaviour identical', () => {
    assert.deepEqual(activeBench(PARAMS).operatingPoint(),
      activeBench({ ...PARAMS, rb: 0 }).operatingPoint());
  });

  it('keeps omitted and explicit zero RC byte-for-behaviour identical', () => {
    assert.deepEqual(activeBench(PARAMS).operatingPoint(),
      activeBench({ ...PARAMS, rc: 0 }).operatingPoint());
  });

  it('refuses implicit, incomplete, invalid, extra, disconnected, and PNP semantics', () => {
    const cases = [
      [{ is: 1e-14, beta: 100 }, /model must be explicitly/],
      [{ ...PARAMS, is: 0 }, /is must be an explicit finite number greater than zero/],
      [{ ...PARAMS, beta: NaN }, /beta must be an explicit finite number greater than zero/],
      [{ ...PARAMS, br: 0 }, /br must be a finite number greater than zero/],
      [{ ...PARAMS, n: -1 }, /n must be a finite number greater than zero/],
      [{ ...PARAMS, vaf: 0 }, /vaf must be a finite number greater than zero/],
      [{ ...PARAMS, ikf: 0 }, /ikf must be a finite number greater than zero/],
      [{ ...PARAMS, ikf: NaN }, /ikf must be a finite number greater than zero/],
      [{ ...PARAMS, rb: -1 }, /rb must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, rb: NaN }, /rb must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, rc: -1 }, /rc must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, rc: NaN }, /rc must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, cje: 2e-12 }, /cje, cjc and tf must be declared together/],
      [{ ...PARAMS, cje: 2e-12, cjc: 1e-12, tf: -1 },
        /tf must be a finite number greater than or equal to zero/],
      [{ ...PARAMS, cje: 2e-12, cjc: NaN, tf: 1e-9 },
        /cjc must be a finite number greater than or equal to zero/],
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

const JUNCTION_PAIR_PARAMS = Object.freeze({ model: 'shockley', is: 1e-15, beta: 100, br: 1, n: 1, rb: 0, rc: 0 });
const junctionTerminal = (part, terminal) => ({ part, terminal });
function junctionTailPair(volts, BoardType = BoardImpl) {
  const board = new BoardType(5), t = junctionTerminal;
  const parts = [
    ...[['VCC', 5], ['VB', .7], ['VS', volts]].map(([id, volts]) => ({ id, kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] })),
    ...['RC1', 'RC2'].map(id => ({ id, kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] })),
    { id: 'IT', kind: 'isource', params: { amps: -1e-4 }, terminals: ['pos', 'neg'] },
    ...['Q1', 'Q2'].map(id => ({ id, kind: 'npn', params: { ...JUNCTION_PAIR_PARAMS }, terminals: ['collector', 'base', 'emitter'] })),
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'gnd', terminals: [t('VCC', 'neg'), t('VB', 'neg'), t('VS', 'neg'), t('IT', 'neg'), t('G1', 'gnd')] },
    { id: 'vcc', terminals: [t('VCC', 'pos'), t('RC1', 'a'), t('RC2', 'a')] },
    { id: 'in', terminals: [t('VS', 'pos'), t('Q1', 'base')] },
    { id: 'bref', terminals: [t('VB', 'pos'), t('Q2', 'base')] },
    { id: 'out', terminals: [t('RC1', 'b'), t('Q1', 'collector')] },
    { id: 'other', terminals: [t('RC2', 'b'), t('Q2', 'collector')] },
    { id: 'tail', terminals: [t('IT', 'pos'), t('Q1', 'emitter'), t('Q2', 'emitter')] },
  ];
  board.setNetlist(parts, nets);
  return { board, nets };
}
function junctionCollector(baseVolts, BoardType = BoardImpl) {
  const board = new BoardType(5), t = junctionTerminal;
  const nets = [
    { id: 'gnd', terminals: [t('VB', 'neg'), t('Q1', 'emitter'), t('G1', 'gnd')] },
    { id: 'base', terminals: [t('VB', 'pos'), t('Q1', 'base')] },
    { id: 'collector', terminals: [t('Q1', 'collector'), t('RLEAF', 'a')] },
    { id: 'leaf', terminals: [t('RLEAF', 'b')] },
  ];
  board.setNetlist([
    { id: 'VB', kind: 'vsource', params: { volts: baseVolts }, terminals: ['pos', 'neg'] },
    { id: 'Q1', kind: 'npn', params: { ...JUNCTION_PAIR_PARAMS }, terminals: ['collector', 'base', 'emitter'] },
    { id: 'RLEAF', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], nets);
  return { board, nets };
}
function assertNpnNetKcl(op, nets) {
  for (const net of nets) {
    let total = 0;
    for (const t of net.terminals) {
      if (t.part === 'G1') continue;
      const current = op.branchCurrents.get(t.part)?.get(t.terminal);
      assert.ok(Number.isFinite(current), `finite current ${t.part}.${t.terminal}`);
      total += current;
    }
    assert.ok(Math.abs(total) < 1e-10, `${net.id} signed terminal KCL ${total} A`);
  }
}
const junctionPairCard = '.model QP NPN(IS=1e-15 BF=100 BR=1 NF=1 NR=1 RB=0 RC=0)';

describe('explicit Ebers-Moll junction DC reference propagation', () => {
  it('solves the constant-current tail through actual base-emitter junctions without state adoption', () => {
    for (const volts of [.68, .69, .70, .71, .72]) {
      const { board, nets } = junctionTailPair(volts), before = stateWitness(board);
      const op = board.operatingPoint();
      assert.equal(op.converged, true, `${volts} V differential input`);
      for (const value of op.nodeVoltages.values()) assert.ok(Number.isFinite(value));
      assert.ok(Math.abs(op.branchCurrents.get('IT').get('pos') - 1e-4) < 1e-12,
        'native negative injection is a positive into-terminal tail sink');
      assertNpnNetKcl(op, nets);
      assertUnchanged(board, before);
    }
  });

  it('matches independent tail-pair voltages and all bipolar terminal currents', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const names = ['v(out)', 'v(other)', 'v(tail)', '@q1[ib]', '@q1[ic]', '@q1[ie]', '@q2[ib]', '@q2[ic]', '@q2[ie]'];
    for (const volts of [.68, .69, .70, .71, .72]) {
      const expected = ngspice(`.options gmin=${JUNCTION_GMIN}
VCC vcc 0 5
VB bref 0 .7
VS in 0 ${volts}
RC1 vcc out 10000
RC2 vcc other 10000
IT tail 0 100u
Q1 out in tail QP
Q2 other bref tail QP
${junctionPairCard}`, names);
      const { board, nets } = junctionTailPair(volts), op = board.operatingPoint();
      assert.equal(op.converged, true);
      // Failure-only diagnostics retain both instruments' actual numbers;
      // a bare case label cannot distinguish a model error from oracle setup.
      const comparison = JSON.stringify({ inputVolts: volts,
        nativeNodes: Object.fromEntries(op.nodeVoltages),
        nativeCurrents: Object.fromEntries([...op.branchCurrents].map(([id, values]) => [id, Object.fromEntries(values)])),
        reference: expected });
      for (const net of ['out', 'other', 'tail']) assert.ok(Math.abs(op.nodeVoltages.get(net) - expected[`v(${net})`]) < 1e-8,
        `${volts} V ${net}: ${comparison}`);
      for (const id of ['Q1', 'Q2']) for (const [terminal, vector] of [['base', 'ib'], ['collector', 'ic'], ['emitter', 'ie']]) {
        assert.ok(Math.abs(op.branchCurrents.get(id).get(terminal) - expected[`@${id.toLowerCase()}[${vector}]`]) < 1e-10,
          `${volts} V ${id}.${terminal}: ${comparison}`);
      }
      assertNpnNetKcl(op, nets);
    }
  });

  it('independently checks a collector referenced only through its base-collector junction', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const base of [.60, .65, .70]) {
      const expected = ngspice(`.options gmin=${JUNCTION_GMIN}
VB base 0 ${base}
Q1 collector base 0 QP
RLEAF collector leaf 1000
${junctionPairCard}`, ['v(collector)', 'v(leaf)', '@q1[ib]', '@q1[ic]', '@q1[ie]']);
      const { board, nets } = junctionCollector(base), before = stateWitness(board), op = board.operatingPoint();
      assert.equal(op.converged, true);
      for (const net of ['collector', 'leaf']) assert.ok(Math.abs(op.nodeVoltages.get(net) - expected[`v(${net})`]) < 1e-8,
        `${base} V ${net}`);
      for (const [terminal, vector] of [['base', 'ib'], ['collector', 'ic'], ['emitter', 'ie']]) {
        assert.ok(Math.abs(op.branchCurrents.get('Q1').get(terminal) - expected[`@q1[${vector}]`]) < 1e-10,
          `${base} V ${terminal}`);
      }
      assertNpnNetKcl(op, nets);
      assertUnchanged(board, before);
    }
  });

  it('omitting either actual NPN junction edge restores only its corresponding refusal', async () => {
    for (const [edge, fixture, refused] of [
      ['base-emitter', () => junctionTailPair(.7), /DC-floating nets? .*tail/],
      ['base-collector', () => junctionCollector(.65), /DC-floating nets? .*collector.*leaf/],
    ]) {
      assert.equal(fixture().board.operatingPoint().converged, true);
      await withJunctionEdgeOmitted(edge, async BoardType => {
        assert.equal(activeBench(PARAMS, { BoardType }).operatingPoint().converged, true,
          `${edge} mutant preserves the grounded control`);
        const { board } = edge === 'base-emitter' ? junctionTailPair(.7, BoardType) : junctionCollector(.65, BoardType);
        assert.throws(() => board.operatingPoint(), refused);
      });
    }
  });
});
