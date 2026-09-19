import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const NGSPICE_MATCHED_TEMP_C = 26.826895261366076;
const PARAMS = Object.freeze({ model: 'level1', vth: 1, kp: 50e-6, w: 100e-6,
  l: 1e-6, lambda: 0.01, bulkAtGround: true });

function commonSource(params = PARAMS, { disconnect = null, kind = 'nmos' } = {}) {
  const board = new BoardImpl(5);
  const nets = [
    { id: 'gnd', terminals: [
      { part: 'VDD', terminal: 'neg' }, { part: 'R2', terminal: 'b' },
      { part: 'RS', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'vdd', terminals: [
      { part: 'VDD', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
      { part: 'RD', terminal: 'a' },
    ] },
    { id: 'gate', terminals: [
      { part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' },
      { part: 'M1', terminal: 'gate' },
    ] },
    { id: 'drain', terminals: [
      { part: 'RD', terminal: 'b' }, { part: 'M1', terminal: 'drain' },
    ] },
    { id: 'source', terminals: [
      { part: 'RS', terminal: 'a' }, { part: 'M1', terminal: 'source' },
    ] },
  ].map(net => ({ ...net, terminals: net.terminals.filter(terminal =>
    terminal.part !== 'M1' || terminal.terminal !== disconnect) }));
  board.setNetlist([
    { id: 'VDD', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 11000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 6800 }, terminals: ['a', 'b'] },
    { id: 'RD', kind: 'resistor', params: { ohms: 910 }, terminals: ['a', 'b'] },
    { id: 'RS', kind: 'resistor', params: { ohms: 180 }, terminals: ['a', 'b'] },
    { id: 'M1', kind, params: { ...params }, terminals: ['drain', 'gate', 'source'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], nets);
  return board;
}

function fixedBias(params = PARAMS) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VD', kind: 'vsource', params: { volts: 0.5 }, terminals: ['pos', 'neg'] },
    { id: 'VG', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
    { id: 'M1', kind: 'nmos', params: { ...params }, terminals: ['drain', 'gate', 'source'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'VD', terminal: 'neg' }, { part: 'VG', terminal: 'neg' },
      { part: 'M1', terminal: 'source' }, { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'drain', terminals: [{ part: 'VD', terminal: 'pos' }, { part: 'M1', terminal: 'drain' }] },
    { id: 'gate', terminals: [{ part: 'VG', terminal: 'pos' }, { part: 'M1', terminal: 'gate' }] },
  ]);
  return board;
}

function cascodeStack(stages = 2) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VDD', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'RD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'gnd', terminals: [{ part: 'VDD', terminal: 'neg' }, { part: 'G1', terminal: 'gnd' }] },
    { id: 'vdd', terminals: [{ part: 'VDD', terminal: 'pos' }, { part: 'RD', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'RD', terminal: 'b' }, { part: `M${stages}`, terminal: 'drain' }] },
  ];
  for (let i = 1; i <= stages; i++) {
    parts.push({ id: `VG${i}`, kind: 'vsource', params: { volts: 1.7 + i * 0.65 },
      terminals: ['pos', 'neg'] });
    parts.push({ id: `M${i}`, kind: 'nmos', params: { ...PARAMS },
      terminals: ['drain', 'gate', 'source'] });
    nets[0].terminals.push({ part: `VG${i}`, terminal: 'neg' });
    nets.push({ id: `gate${i}`, terminals: [
      { part: `VG${i}`, terminal: 'pos' }, { part: `M${i}`, terminal: 'gate' },
    ] });
    const sourceNet = i === 1 ? nets[0] : nets.find(net => net.id === `channel${i - 1}`);
    sourceNet.terminals.push({ part: `M${i}`, terminal: 'source' });
    const drainNet = i === stages ? nets[2] : { id: `channel${i}`, terminals: [] };
    drainNet.terminals.push({ part: `M${i}`, terminal: 'drain' });
    if (i !== stages) nets.push(drainNet);
  }
  board.setNetlist(parts, nets);
  return board;
}

function wilsonMirror() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VDD', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'RREF', kind: 'resistor', params: { ohms: 12000 }, terminals: ['a', 'b'] },
    { id: 'RLOAD', kind: 'resistor', params: { ohms: 12000 }, terminals: ['a', 'b'] },
    ...[1, 2, 3].map(i => ({ id: `M${i}`, kind: 'nmos', params: { ...PARAMS },
      terminals: ['drain', 'gate', 'source'] })),
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'VDD', terminal: 'neg' }, { part: 'M1', terminal: 'source' },
      { part: 'M2', terminal: 'source' }, { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'vdd', terminals: [
      { part: 'VDD', terminal: 'pos' }, { part: 'RREF', terminal: 'a' },
      { part: 'RLOAD', terminal: 'a' },
    ] },
    { id: 'ref', terminals: [
      { part: 'RREF', terminal: 'b' }, { part: 'M1', terminal: 'drain' },
      { part: 'M1', terminal: 'gate' }, { part: 'M2', terminal: 'gate' },
      { part: 'M3', terminal: 'source' },
    ] },
    { id: 'sense', terminals: [
      { part: 'M2', terminal: 'drain' }, { part: 'M3', terminal: 'gate' },
    ] },
    { id: 'out', terminals: [
      { part: 'RLOAD', terminal: 'b' }, { part: 'M3', terminal: 'drain' },
    ] },
  ]);
  return board;
}

function floatingGate() {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'VDD', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'RD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'M1', kind: 'nmos', params: { ...PARAMS }, terminals: ['drain', 'gate', 'source'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'gnd', terminals: [
      { part: 'VDD', terminal: 'neg' }, { part: 'M1', terminal: 'source' },
      { part: 'G1', terminal: 'gnd' },
    ] },
    { id: 'vdd', terminals: [{ part: 'VDD', terminal: 'pos' }, { part: 'RD', terminal: 'a' }] },
    { id: 'drain', terminals: [{ part: 'RD', terminal: 'b' }, { part: 'M1', terminal: 'drain' }] },
    { id: 'gate', terminals: [{ part: 'M1', terminal: 'gate' }] },
  ]);
  return board;
}

function ngspice(deck, names) {
  const text = `* self-authored explicit Level-1 NMOS operating point
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
  return { timeNs: board.timeNs, nodeVoltages: board.nodeVoltages, capVoltages: board.capVoltages,
    capCurrents: board.capCurrents, deviceStates: board._deviceStates, controls: board.controls,
    cache: board._mnaCache, parts: JSON.stringify(board._solveParts) };
}

function assertUnchanged(board, before) {
  assert.equal(board.timeNs, before.timeNs);
  assert.equal(board.nodeVoltages, before.nodeVoltages);
  assert.equal(board.capVoltages, before.capVoltages);
  assert.equal(board.capCurrents, before.capCurrents);
  assert.equal(board._deviceStates, before.deviceStates);
  assert.equal(board.controls, before.controls);
  assert.equal(board._mnaCache, before.cache);
  assert.equal(JSON.stringify(board._solveParts), before.parts);
}

describe('BoardImpl.operatingPoint explicit grounded-bulk Level-1 NMOS domain', () => {
  it('matches ngspice in saturation and triode with signed current and KCL', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const activeOracle = ngspice(`VDD vdd 0 9
R1 vdd gate 11k
R2 gate 0 6.8k
RD vdd drain 910
RS source 0 180
M1 drain gate source 0 NM W=100u L=1u
.model NM NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01)`,
    ['v(gate)', 'v(drain)', 'v(source)', '@m1[id]', '@vdd[i]']);
    const board = commonSource({ ...PARAMS, _model: 'NM' });
    const before = stateWitness(board);
    const active = board.operatingPoint();
    assert.equal(active.converged, true);
    assert.deepEqual(active.analysis.nmos, {
      model: 'explicit-spice-level1-grounded-bulk',
      requiredParameters: ['vth', 'kp', 'w', 'l', 'lambda', 'bulkAtGround'],
      defaults: { bulkIs: 1e-14, bulkN: 1 }, thermalVoltage: 0.02585,
      temperatureModel: 'fixed',
    });
    for (const [net, oracle] of [['gate', 'v(gate)'], ['drain', 'v(drain)'], ['source', 'v(source)']]) {
      assert.ok(Math.abs(active.nodeVoltages.get(net) - activeOracle[oracle]) < 1e-6,
        `${net}: ${active.nodeVoltages.get(net)} vs ${activeOracle[oracle]}`);
    }
    const m = active.branchCurrents.get('M1');
    assert.ok(Math.abs(m.get('drain') - activeOracle['@m1[id]']) < 1e-8,
      `drain: ${m.get('drain')} vs ${activeOracle['@m1[id]']}`);
    assert.ok(Math.abs(m.get('gate')) < 1e-15);
    assert.ok(Math.abs(m.get('drain') + m.get('gate') + m.get('source') + m.get('bulk')) < 1e-12);
    assert.ok(Math.abs(active.branchCurrents.get('VDD').get('pos') - activeOracle['@vdd[i]']) < 1e-8);
    assertUnchanged(board, before);

    const triodeOracle = ngspice(`VD drain 0 0.5
VG gate 0 2
M1 drain gate 0 0 NM W=100u L=1u
.model NM NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01)`, ['@m1[id]']);
    const triode = fixedBias().operatingPoint();
    assert.ok(Math.abs(triode.branchCurrents.get('M1').get('drain') - triodeOracle['@m1[id]']) < 1e-8);
  });

  it('refuses implicit, incomplete, invalid, extra, unproved-bulk, disconnected, and PMOS semantics', () => {
    const cases = [
      [{ ...PARAMS, model: undefined }, /model must be explicitly/],
      [{ ...PARAMS, vth: NaN }, /vth must be an explicit finite number/],
      [{ ...PARAMS, kp: 0 }, /kp must be an explicit finite number greater than zero/],
      [{ ...PARAMS, w: -1 }, /w must be an explicit finite number greater than zero/],
      [{ ...PARAMS, l: 0 }, /l must be an explicit finite number greater than zero/],
      [{ ...PARAMS, lambda: -1 }, /lambda must be an explicit finite number greater than or equal to zero/],
      [{ ...PARAMS, bulkAtGround: false }, /bulkAtGround must explicitly prove/],
      [{ ...PARAMS, gamma: 0.5 }, /parameter gamma is outside/],
      [{ ...PARAMS, _model: '' }, /_model must be a non-empty inert source-model name/],
    ];
    for (const [params, pattern] of cases) {
      const board = commonSource(params); const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern); assertUnchanged(board, before);
    }
    assert.throws(() => commonSource(PARAMS, { disconnect: 'drain' }).operatingPoint(),
      /terminal drain is not connected/);
    assert.throws(() => commonSource(PARAMS, { kind: 'pmos' }).operatingPoint(),
      /unsupported part M1 \(pmos\)/);
  });

  it('recognizes the always-stamped drain/source path without making a MOS gate conductive', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const two = cascodeStack(2).operatingPoint();
    const twoOracle = ngspice(`VDD vdd 0 9
RD vdd out 10k
VG1 gate1 0 2.35
VG2 gate2 0 3
M1 channel1 gate1 0 0 NM W=100u L=1u
M2 out gate2 channel1 0 NM W=100u L=1u
.model NM NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01)`, ['v(out)', 'v(channel1)']);
    assert.ok(Math.abs(two.nodeVoltages.get('out') - twoOracle['v(out)']) < 1e-6);
    assert.ok(Math.abs(two.nodeVoltages.get('channel1') - twoOracle['v(channel1)']) < 1e-6);

    const three = cascodeStack(3).operatingPoint();
    const threeOracle = ngspice(`VDD vdd 0 9
RD vdd out 10k
VG1 gate1 0 2.35
VG2 gate2 0 3
VG3 gate3 0 3.65
M1 channel1 gate1 0 0 NM W=100u L=1u
M2 channel2 gate2 channel1 0 NM W=100u L=1u
M3 out gate3 channel2 0 NM W=100u L=1u
.model NM NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01)`, ['v(out)', 'v(channel1)', 'v(channel2)']);
    for (const net of ['out', 'channel1', 'channel2']) {
      assert.ok(Math.abs(three.nodeVoltages.get(net) - threeOracle[`v(${net})`]) < 1e-6);
    }

    const wilson = wilsonMirror().operatingPoint();
    const wilsonOracle = ngspice(`VDD vdd 0 9
RREF vdd ref 12k
RLOAD vdd out 12k
M1 ref ref 0 0 NM W=100u L=1u
M2 sense ref 0 0 NM W=100u L=1u
M3 out sense ref 0 NM W=100u L=1u
.model NM NMOS(Level=1 VTO=1 KP=50u LAMBDA=0.01)`, ['v(ref)', 'v(sense)', 'v(out)']);
    for (const net of ['ref', 'sense', 'out']) {
      assert.ok(Math.abs(wilson.nodeVoltages.get(net) - wilsonOracle[`v(${net})`]) < 1e-6);
    }

    assert.throws(() => floatingGate().operatingPoint(), /DC-floating net gate/);
  });
});
