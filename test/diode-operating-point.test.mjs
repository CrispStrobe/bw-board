import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { JUNCTION_THERMAL_VOLTAGE } from '../src/mna.js';

const K_OVER_Q = 8.617333262145e-5;
const MATCHED_TEMP_C = JUNCTION_THERMAL_VOLTAGE / K_OVER_Q - 273.15;
const PARAMS = Object.freeze({ model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

function diodeBench(volts, params = PARAMS, { capacitor = false } = {}) {
  const board = new BoardImpl(5);
  const parts = [
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'D1', kind: 'diode', params: { ...params }, terminals: ['anode', 'cathode'] },
    ...(capacitor
      ? [{ id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }]
      : []),
    gnd,
  ];
  const nets = [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [
      { part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' },
      ...(capacitor ? [{ part: 'C1', terminal: 'a' }] : []),
    ] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' }, { part: 'D1', terminal: 'cathode' },
      ...(capacitor ? [{ part: 'C1', terminal: 'b' }] : []),
      { part: 'G1', terminal: 'gnd' },
    ] },
  ];
  board.setNetlist(parts, nets);
  return board;
}

function stateWitness(board) {
  return {
    timeNs: board.timeNs,
    nodeVoltages: board.nodeVoltages,
    capVoltages: board.capVoltages,
    capCurrents: board.capCurrents,
    deviceStates: board._deviceStates,
    controls: board.controls,
    cache: board._mnaCache,
    nodeVoltageValues: structuredClone(board.nodeVoltages),
    capVoltageValues: structuredClone(board.capVoltages),
    capCurrentValues: structuredClone(board.capCurrents),
    deviceStateValues: structuredClone(board._deviceStates),
    controlValues: structuredClone(board.controls),
    parts: JSON.stringify(board._solveParts),
  };
}

function assertUnchanged(board, before) {
  assert.equal(board.timeNs, before.timeNs);
  assert.equal(board.nodeVoltages, before.nodeVoltages);
  assert.equal(board.capVoltages, before.capVoltages);
  assert.equal(board.capCurrents, before.capCurrents);
  assert.equal(board._deviceStates, before.deviceStates);
  assert.equal(board.controls, before.controls);
  assert.equal(board._mnaCache, before.cache);
  assert.deepEqual(board.nodeVoltages, before.nodeVoltageValues);
  assert.deepEqual(board.capVoltages, before.capVoltageValues);
  assert.deepEqual(board.capCurrents, before.capCurrentValues);
  assert.deepEqual(board._deviceStates, before.deviceStateValues);
  assert.deepEqual(board.controls, before.controlValues);
  assert.equal(JSON.stringify(board._solveParts), before.parts);
}

function ngspicePoint(volts, params = PARAMS) {
  const deck = `* self-authored explicit Shockley diode DC bench
.temp ${MATCHED_TEMP_C}
.options tnom=${MATCHED_TEMP_C}
V1 in 0 DC ${volts}
R1 in out 1k
D1 out 0 SELF
.model SELF D(IS=${params.is} N=${params.n} RS=${params.rs})
.control
set numdgt=17
op
print v(out) @d1[id] @v1[i]
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
  return { out: read('v\\(out\\)'), diode: read('@d1\\[id\\]'), source: read('@v1\\[i\\]') };
}

describe('BoardImpl.operatingPoint explicit Shockley diode domain', () => {
  it('reports its fixed thermal-voltage contract and preserves stored state', () => {
    const board = diodeBench(2, PARAMS, { capacitor: true });
    board.setControl('V1', 2);
    board.advanceTo(1000n);
    const before = stateWitness(board);
    const first = board.operatingPoint();
    const second = board.operatingPoint();
    assert.equal(first.converged, true);
    assert.equal(first.analysis.scope,
      'grounded-static-native-r-c-d-v-i-e-g-explicit-shockley');
    assert.ok(first.analysis.supportedKinds.includes('diode'));
    assert.deepEqual(first.analysis.diodes, {
      model: 'explicit-shockley',
      parameters: ['is', 'n', 'rs'],
      thermalVoltage: 0.02585,
      temperatureModel: 'fixed',
    });
    assert.equal(first.branchCurrents.get('C1').get('a'), 0, 'capacitor remains a DC open');
    assert.notEqual(first.nodeVoltages, second.nodeVoltages);
    assertUnchanged(board, before);
  });

  it('matches self-authored ngspice forward and reverse DC points, signed currents, and KCL', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const volts of [2, -2]) {
      const expected = ngspicePoint(volts);
      const op = diodeBench(volts).operatingPoint();
      const iD = op.branchCurrents.get('D1').get('anode');
      const iV = op.branchCurrents.get('V1').get('pos');
      const iRout = -op.branchCurrents.get('R1').get('a');
      assert.equal(op.converged, true);
      assert.ok(Math.abs(op.nodeVoltages.get('out') - expected.out) < 2e-6,
        `${volts} V output`);
      assert.equal(Math.sign(iD), Math.sign(volts), `${volts} V diode-current sign`);
      assert.equal(Math.sign(iV), -Math.sign(volts), `${volts} V source-current sign`);
      const currentTolerance = volts > 0 ? 1e-8 : 3e-12;
      assert.ok(Math.abs(iD - expected.diode) < currentTolerance, `${volts} V diode current`);
      assert.ok(Math.abs(iV - expected.source) < currentTolerance, `${volts} V source current`);
      if (volts < 0) {
        assert.ok(Math.abs(iD + PARAMS.is) < 1e-18,
          'reverse diode current is its declared negative saturation current');
      }
      assert.ok(Math.abs(iD + iRout) < 1e-11, `${volts} V output-node KCL`);
      assert.ok(Math.abs(iV + op.branchCurrents.get('R1').get('a')) < 1e-11,
        `${volts} V input-node KCL`);
    }
  });

  it('has an oracle that detects wrong ideality and series-resistance mutations', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const expected = ngspicePoint(2);
    const wrongN = diodeBench(2, { ...PARAMS, n: 2.1 }).operatingPoint();
    const wrongRs = diodeBench(2, { ...PARAMS, rs: 300 }).operatingPoint();
    assert.ok(Math.abs(wrongN.nodeVoltages.get('out') - expected.out) > 0.05,
      'wrong N must be visible to the independent node-voltage oracle');
    assert.ok(Math.abs(wrongRs.nodeVoltages.get('out') - expected.out) > 0.1,
      'wrong RS must be visible to the independent node-voltage oracle');
  });

  it('refuses implicit, incomplete, non-finite, non-DC, and unknown diode semantics', () => {
    const cases = [
      [{ is: 1e-12, n: 1, rs: 0 }, /model must be explicitly 'shockley'/],
      [{ ...PARAMS, model: 'pwl' }, /model must be explicitly 'shockley'/],
      [{ ...PARAMS, is: undefined }, /is must be an explicit finite number greater than zero/],
      [{ ...PARAMS, is: 0 }, /is must be an explicit finite number greater than zero/],
      [{ ...PARAMS, n: Infinity }, /n must be an explicit finite number greater than zero/],
      [{ ...PARAMS, rs: -1 }, /rs must be an explicit finite number greater than or equal to zero/],
      [{ ...PARAMS, bv: 20 }, /parameter bv is outside/],
      [{ ...PARAMS, temperatureC: 30 }, /parameter temperatureC is outside/],
      [{ ...PARAMS, cjo: 1e-12 }, /parameter cjo is outside/],
    ];
    for (const [params, pattern] of cases) {
      const board = diodeBench(2, params);
      const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern);
      assertUnchanged(board, before);
    }
  });

  it('requires both terminal nets and does not use a diode as a DC anchor', () => {
    const disconnected = new BoardImpl(5);
    disconnected.setNetlist([
      { id: 'D1', kind: 'diode', params: { ...PARAMS }, terminals: ['anode', 'cathode'] }, gnd,
    ], [
      { id: 'gnd', terminals: [
        { part: 'D1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    assert.throws(() => disconnected.operatingPoint(), /terminal anode is not connected/);

    const floating = new BoardImpl(5);
    floating.setNetlist([
      { id: 'D1', kind: 'diode', params: { ...PARAMS }, terminals: ['anode', 'cathode'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }, gnd,
    ], [
      { id: 'float', terminals: [
        { part: 'D1', terminal: 'anode' }, { part: 'R1', terminal: 'a' },
      ] },
      { id: 'float2', terminals: [{ part: 'R1', terminal: 'b' }] },
      { id: 'gnd', terminals: [
        { part: 'D1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    assert.throws(() => floating.operatingPoint(), /DC-floating nets? .*float/);
  });

  it('reports a contradictory-source non-solution without adopting its diode iterate', () => {
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'V1', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
      { id: 'V2', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
      { id: 'D1', kind: 'diode', params: { ...PARAMS }, terminals: ['anode', 'cathode'] },
      gnd,
    ], [
      { id: 'n', terminals: [
        { part: 'V1', terminal: 'pos' }, { part: 'V2', terminal: 'pos' },
        { part: 'D1', terminal: 'anode' },
      ] },
      { id: 'gnd', terminals: [
        { part: 'V1', terminal: 'neg' }, { part: 'V2', terminal: 'neg' },
        { part: 'D1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    const before = stateWitness(board);
    assert.equal(board.operatingPoint().converged, false);
    assertUnchanged(board, before);
  });
});
