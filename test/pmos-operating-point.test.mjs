import {describe, it} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {BoardImpl} from '../src/board.js';

const TEMP_C = 27;
const PARAMS = Object.freeze({model: 'level1', vth: -1, kp: 25e-6,
  w: 100e-6, l: 1e-6, lambda: 0.01, _model: 'PM'});

function fixedBias({params = PARAMS, disconnect = null} = {}) {
  const parts = [
    {id: 'VB', kind: 'vsource', params: {volts: 10}, terminals: ['pos', 'neg']},
    {id: 'VS', kind: 'vsource', params: {volts: 8}, terminals: ['pos', 'neg']},
    {id: 'VG', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']},
    {id: 'RD', kind: 'resistor', params: {ohms: 500}, terminals: ['a', 'b']},
    {id: 'M1', kind: 'pmos', params: {...params}, terminals: ['drain', 'gate', 'source', 'bulk']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
  ];
  const nets = [
    {id: 'gnd', terminals: [
      {part: 'VB', terminal: 'neg'}, {part: 'VS', terminal: 'neg'},
      {part: 'VG', terminal: 'neg'}, {part: 'RD', terminal: 'b'},
      {part: 'G', terminal: 'gnd'},
    ]},
    {id: 'bulk', terminals: [{part: 'VB', terminal: 'pos'}, {part: 'M1', terminal: 'bulk'}]},
    {id: 'source', terminals: [{part: 'VS', terminal: 'pos'}, {part: 'M1', terminal: 'source'}]},
    {id: 'gate', terminals: [{part: 'VG', terminal: 'pos'}, {part: 'M1', terminal: 'gate'}]},
    {id: 'drain', terminals: [{part: 'RD', terminal: 'a'}, {part: 'M1', terminal: 'drain'}]},
  ];
  for (const net of nets) net.terminals = net.terminals.filter(t =>
    t.part !== 'M1' || t.terminal !== disconnect);
  const board = new BoardImpl(5);
  board.setNetlist(parts, nets);
  return board;
}

function ngspice() {
  const deck = `* self-authored explicit-bulk Level-1 PMOS operating point
.temp ${TEMP_C}
.options tnom=${TEMP_C} reltol=1e-12 abstol=1e-18 vntol=1e-15
VB bulk 0 10
VS source 0 8
VG gate 0 5
RD drain 0 500
M1 drain gate source bulk PM W=100u L=1u
.model PM PMOS(LEVEL=1 VTO=-1 KP=25u LAMBDA=0.01)
.control
set numdgt=17
op
print v(drain) @m1[id] @m1[is] @m1[ib] @vb[i] @vs[i]
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], {input: deck, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const names = ['v(drain)', '@m1[id]', '@m1[is]', '@m1[ib]', '@vb[i]', '@vs[i]'];
  return Object.fromEntries(names.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from:\n${run.stdout}`);
    return [name, Number(match[1])];
  }));
}

function bodyJunction() {
  const board = new BoardImpl(5);
  board.setNetlist([
    {id: 'VB', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']},
    {id: 'VS', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']},
    {id: 'VG', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']},
    {id: 'VD', kind: 'vsource', params: {volts: 5.55}, terminals: ['pos', 'neg']},
    {id: 'M1', kind: 'pmos', params: {...PARAMS}, terminals: ['drain', 'gate', 'source', 'bulk']},
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
  ], [
    {id: 'gnd', terminals: ['VB', 'VS', 'VG', 'VD'].map(part => ({part, terminal: 'neg'}))
      .concat({part: 'G', terminal: 'gnd'})},
    {id: 'bulk', terminals: [{part: 'VB', terminal: 'pos'}, {part: 'M1', terminal: 'bulk'}]},
    {id: 'source', terminals: [{part: 'VS', terminal: 'pos'}, {part: 'M1', terminal: 'source'}]},
    {id: 'gate', terminals: [{part: 'VG', terminal: 'pos'}, {part: 'M1', terminal: 'gate'}]},
    {id: 'drain', terminals: [{part: 'VD', terminal: 'pos'}, {part: 'M1', terminal: 'drain'}]},
  ]);
  return board;
}

function ngspiceBodyJunction() {
  const deck = `* explicit PMOS bulk-drain junction witness
.temp ${TEMP_C}
.options tnom=${TEMP_C} reltol=1e-12 abstol=1e-18 vntol=1e-15
VB bulk 0 5
VS source 0 5
VG gate 0 5
VD drain 0 5.55
M1 drain gate source bulk PM W=100u L=1u
.model PM PMOS(LEVEL=1 VTO=-1 KP=25u LAMBDA=0.01)
.control
set numdgt=17
op
print @m1[id] @m1[is] @m1[ib] @vb[i] @vd[i]
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], {input: deck, encoding: 'utf8'});
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const names = ['@m1[id]', '@m1[is]', '@m1[ib]', '@vb[i]', '@vd[i]'];
  return Object.fromEntries(names.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from:\n${run.stdout}`);
    return [name, Number(match[1])];
  }));
}

describe('BoardImpl.operatingPoint explicit-bulk Level-1 PMOS domain', () => {
  it('matches ngspice and returns both body-junction currents through the real bulk rail', {
    skip: spawnSync('ngspice', ['--version'], {encoding: 'utf8'}).status !== 0,
  }, () => {
    const oracle = ngspice();
    const op = fixedBias().operatingPoint();
    assert.equal(op.converged, true);
    assert.deepEqual(op.analysis.pmos, {
      model: 'explicit-spice-level1-explicit-bulk-terminal',
      requiredParameters: ['vth', 'kp', 'w', 'l', 'lambda'],
      requiredTerminals: ['gate', 'drain', 'source', 'bulk'],
      defaults: {bulkIs: 1e-14, bulkN: 1}, thermalVoltage: 0.025864925786328753,
      temperatureModel: 'fixed',
    });
    assert.ok(Math.abs(op.nodeVoltages.get('drain') - oracle['v(drain)']) < 1e-6);
    const m = op.branchCurrents.get('M1');
    for (const [terminal, name] of [['drain', '@m1[id]'], ['source', '@m1[is]'], ['bulk', '@m1[ib]']]) {
      // ngspice's PMOS @m1 terminal values use the model's source-to-drain
      // polarity; the Board OP contract is uniformly positive INTO a named
      // terminal, hence the deliberate inversion for all three device leads.
      assert.ok(Math.abs(m.get(terminal) + oracle[name]) < 1e-8,
        `${terminal}: ${m.get(terminal)} vs ${-oracle[name]}`);
    }
    assert.ok(Math.abs(m.get('gate')) < 1e-15);
    assert.ok(Math.abs([...m.values()].reduce((a, b) => a + b, 0)) < 1e-12);
    assert.ok(Math.abs(op.branchCurrents.get('VB').get('pos') - oracle['@vb[i]']) < 1e-8);
    assert.ok(Math.abs(op.branchCurrents.get('VS').get('pos') - oracle['@vs[i]']) < 1e-8);
  });

  it('refuses an absent bulk and every semantic broadening of the measured domain', () => {
    assert.throws(() => fixedBias({disconnect: 'bulk'}).operatingPoint(),
      /terminal bulk is not connected/);
    for (const [params, pattern] of [
      [{...PARAMS, model: undefined}, /model must be explicitly/],
      [{...PARAMS, vth: NaN}, /vth must be an explicit finite number/],
      [{...PARAMS, kp: 0}, /kp must be an explicit finite number greater than zero/],
      [{...PARAMS, w: 0}, /w must be an explicit finite number greater than zero/],
      [{...PARAMS, l: -1}, /l must be an explicit finite number greater than zero/],
      [{...PARAMS, lambda: -1}, /lambda must be an explicit finite number greater than or equal to zero/],
      [{...PARAMS, gamma: 0.5}, /parameter gamma is outside/],
      [{...PARAMS, bulkAtGround: true}, /parameter bulkAtGround is outside/],
      [{...PARAMS, _model: ''}, /_model must be a non-empty inert source-model name/],
    ]) assert.throws(() => fixedBias({params}).operatingPoint(), pattern);
  });

  it('stamps a forward bulk-drain junction into the explicit rail, not an implicit reference', {
    skip: spawnSync('ngspice', ['--version'], {encoding: 'utf8'}).status !== 0,
  }, () => {
    const oracle = ngspiceBodyJunction();
    const op = bodyJunction().operatingPoint();
    const m = op.branchCurrents.get('M1');
    for (const [terminal, name] of [['drain', '@m1[id]'], ['source', '@m1[is]'], ['bulk', '@m1[ib]']]) {
      assert.ok(Math.abs(m.get(terminal) + oracle[name]) < 1e-8,
        `${terminal}: ${m.get(terminal)} vs ${-oracle[name]}`);
    }
    assert.ok(Math.abs(m.get('bulk')) > 1e-6, 'witness must carry a load-bearing bulk current');
    assert.ok(Math.abs(op.branchCurrents.get('VB').get('pos') - oracle['@vb[i]']) < 1e-8);
    assert.ok(Math.abs(op.branchCurrents.get('VD').get('pos') - oracle['@vd[i]']) < 1e-8);
  });
});
