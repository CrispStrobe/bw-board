import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';

const HAS_NGSPICE = spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status === 0;
const PARAMS = Object.freeze({ model: 'level1', vth: 1, kp: 100e-6,
  w: 1e-6, l: 1e-6, lambda: 0.02, bulkOnSource: true, _model: 'NM' });

function readNgspice(deck, names) {
  const run = spawnSync('ngspice', ['-b'], { input: `* source-tied bulk contract
.temp 27
.options tnom=27 reltol=1e-12 abstol=1e-18 vntol=1e-15
${deck}
.control
set numdgt=17
op
print ${names.join(' ')}
.endc
.end
`, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return Object.fromEntries(names.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from:\n${run.stdout}`);
    return [name, Number(match[1])];
  }));
}

function boardFor({ sourceVolts, drainVolts = null, gateVolts = null, diodeConnected = false,
  params = PARAMS }) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'VS', kind: 'vsource', params: { volts: sourceVolts }, terminals: ['pos', 'neg'] },
    { id: 'M1', kind: 'nmos', params: { ...params }, terminals: ['drain', 'gate', 'source'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  if (drainVolts !== null) parts.push({ id: 'VD', kind: 'vsource', params: { volts: drainVolts }, terminals: ['pos', 'neg'] });
  if (gateVolts !== null) parts.push({ id: 'VG', kind: 'vsource', params: { volts: gateVolts }, terminals: ['pos', 'neg'] });
  if (drainVolts !== null) parts.push({ id: 'RPROBE', kind: 'resistor', params: { ohms: 1e9 }, terminals: ['a', 'b'] });
  const ground = [{ part: 'VS', terminal: 'neg' }, { part: 'G1', terminal: 'gnd' }];
  if (drainVolts !== null) ground.push({ part: 'VD', terminal: 'neg' });
  if (drainVolts !== null) ground.push({ part: 'RPROBE', terminal: 'b' });
  if (gateVolts !== null) ground.push({ part: 'VG', terminal: 'neg' });
  const nets = [
    { id: 'gnd', terminals: ground },
    { id: 'source', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'M1', terminal: 'source' }] },
    { id: 'drain', terminals: [
      ...(drainVolts === null ? [] : [{ part: 'VD', terminal: 'pos' }]),
      ...(drainVolts === null ? [] : [{ part: 'RPROBE', terminal: 'a' }]),
      { part: 'M1', terminal: 'drain' },
      ...(diodeConnected ? [{ part: 'M1', terminal: 'gate' }] : []),
    ] },
  ];
  if (!diodeConnected) nets.push({ id: 'gate', terminals: [
    { part: 'VG', terminal: 'pos' }, { part: 'M1', terminal: 'gate' },
  ] });
  board.setNetlist(parts, nets);
  return board;
}

function stateWitness(board) {
  return { timeNs: board.timeNs, nodeVoltages: board.nodeVoltages,
    capVoltages: board.capVoltages, capCurrents: board.capCurrents,
    deviceStates: board._deviceStates, controls: board.controls,
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

describe('source-tied-bulk Level-1 NMOS operating point', () => {
  it('matches ngspice in the ordinary channel region and reports conserved signed currents', {
    skip: !HAS_NGSPICE,
  }, () => {
    const oracle = readNgspice(`VS source 0 0
VD drain 0 2
VG gate 0 3
M1 drain gate source source NM W=1u L=1u
.model NM NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02)`, ['@m1[id]']);
    const board = boardFor({ sourceVolts: 0, drainVolts: 2, gateVolts: 3 });
    const before = stateWitness(board);
    const result = board.operatingPoint();
    assert.equal(result.converged, true);
    assert.deepEqual(result.analysis.nmos, {
      model: 'explicit-spice-level1-source-tied-bulk',
      requiredParameters: ['vth', 'kp', 'w', 'l', 'lambda', 'bulkOnSource'],
      defaults: { bulkIs: 1e-14, bulkN: 1 }, thermalVoltage: 0.025864925786328753,
      temperatureModel: 'fixed',
    });
    const currents = result.branchCurrents.get('M1');
    assert.ok(Math.abs(currents.get('drain') - oracle['@m1[id]']) < 1e-9);
    assert.ok(Math.abs(currents.get('drain') + currents.get('gate') + currents.get('source')) < 1e-12);
    assert.equal(currents.has('bulk'), false, 'source-tied bulk is the external source lead');
    assertUnchanged(board, before);
  });

  it('matches the forward-biased drain-bulk junction instead of dropping its current', {
    skip: !HAS_NGSPICE,
  }, () => {
    const oracle = readNgspice(`VS source 0 5
M1 out out source source NM W=1u L=1u
.model NM NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=.02)`, ['v(out)', '@m1[id]']);
    const result = boardFor({ sourceVolts: 5, diodeConnected: true }).operatingPoint();
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.nodeVoltages.get('drain') - oracle['v(out)']) < 5e-6,
      `${result.nodeVoltages.get('drain')} vs ${oracle['v(out)']}`);
    const currents = result.branchCurrents.get('M1');
    assert.ok(Math.abs(currents.get('drain') - oracle['@m1[id]']) < 1e-8,
      `${currents.get('drain')} vs ${oracle['@m1[id]']}`);
    assert.ok(Math.abs(currents.get('drain') + currents.get('source')) < 1e-12);
  });

  it('requires exactly one proven bulk topology and keeps wider model fields refused', () => {
    for (const [params, pattern] of [
      [{ ...PARAMS, bulkOnSource: undefined }, /bulkAtGround must explicitly prove/],
      [{ ...PARAMS, bulkAtGround: true }, /bulkAtGround must explicitly prove/],
      [{ ...PARAMS, gamma: 0.4 }, /parameter gamma is outside/],
    ]) assert.throws(() => boardFor({ sourceVolts: 0, drainVolts: 2, gateVolts: 3, params }).operatingPoint(), pattern);
  });
});
