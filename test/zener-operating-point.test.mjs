import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { JUNCTION_THERMAL_VOLTAGE } from '../src/mna.js';

const K_OVER_Q = 8.617333262145e-5;
const MATCHED_TEMP_C = JUNCTION_THERMAL_VOLTAGE / K_OVER_Q - 273.15;
const PARAMS = Object.freeze({
  model: 'shockley', is: 1e-14, n: 1, rs: 0, vz: 8.2, ibv: 1e-3,
});
const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

function zenerBench(volts, params = PARAMS, { reverse = false, capacitor = false } = {}) {
  const board = new BoardImpl(5);
  const highTerminal = reverse ? 'cathode' : 'anode';
  const lowTerminal = reverse ? 'anode' : 'cathode';
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'Z1', kind: 'zener', params: { ...params }, terminals: ['anode', 'cathode'] },
    ...(capacitor
      ? [{ id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }]
      : []),
    gnd,
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [
      { part: 'R1', terminal: 'b' }, { part: 'Z1', terminal: highTerminal },
      ...(capacitor ? [{ part: 'C1', terminal: 'a' }] : []),
    ] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' }, { part: 'Z1', terminal: lowTerminal },
      ...(capacitor ? [{ part: 'C1', terminal: 'b' }] : []),
      { part: 'G1', terminal: 'gnd' },
    ] },
  ]);
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
  assert.equal(JSON.stringify(board._solveParts), before.parts);
}

function ngspicePoint(volts, reverse) {
  const nodes = reverse ? '0 out' : 'out 0';
  const deck = `* self-authored explicit Shockley zener DC bench
.temp ${MATCHED_TEMP_C}
.options tnom=${MATCHED_TEMP_C}
V1 in 0 DC ${volts}
R1 in out 1k
D1 ${nodes} SELF
.model SELF D(IS=${PARAMS.is} N=${PARAMS.n} RS=${PARAMS.rs} BV=${PARAMS.vz} IBV=${PARAMS.ibv})
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
  return {
    out: read('v\\(out\\)'),
    deviceCurrent: read('@d1\\[id\\]'),
    sourceCurrent: read('@v1\\[i\\]'),
  };
}

describe('BoardImpl.operatingPoint explicit Shockley zener domain', () => {
  it('reports the exact model contract and does not adopt the result', () => {
    const board = zenerBench(2, PARAMS, { capacitor: true });
    board.advanceTo(1000n);
    const before = stateWitness(board);
    const first = board.operatingPoint();
    const second = board.operatingPoint();
    assert.equal(first.converged, true);
    assert.ok(first.analysis.supportedKinds.includes('zener'));
    assert.deepEqual(first.analysis.zeners, {
      model: 'explicit-shockley-with-breakdown',
      parameters: ['is', 'n', 'rs', 'vz', 'ibv'],
      thermalVoltage: 0.02585,
      temperatureModel: 'fixed',
    });
    assert.equal(first.branchCurrents.get('C1').get('a'), 0);
    assert.notEqual(first.nodeVoltages, second.nodeVoltages);
    assertUnchanged(board, before);
  });

  it('matches ngspice in forward conduction and reverse breakdown, including current sign', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const [volts, reverse] of [[2, false], [12, true]]) {
      const expected = ngspicePoint(volts, reverse);
      const op = zenerBench(volts, PARAMS, { reverse }).operatingPoint();
      const current = op.branchCurrents.get('Z1').get('anode');
      assert.equal(op.converged, true);
      assert.ok(Math.abs(op.nodeVoltages.get('out') - expected.out) < 3e-4,
        `${reverse ? 'reverse' : 'forward'} V(out)`);
      // ngspice's @d1[id] includes its internal breakdown bookkeeping and is
      // not KCL-equal to the external branch in reverse operation. The source
      // current is the independently solved, observable series current.
      const expectedBranch = reverse ? expected.sourceCurrent : -expected.sourceCurrent;
      assert.ok(Math.abs(current - expectedBranch) < 2e-7,
        `${reverse ? 'reverse' : 'forward'} current ${current} vs ${expectedBranch}`);
      assert.ok(!reverse || Math.abs(expected.deviceCurrent - expected.sourceCurrent) > 1e-6,
        'reverse oracle must distinguish internal diode bookkeeping from branch current');
      const resistorIntoOut = -op.branchCurrents.get('R1').get('a');
      const zenerAtOut = op.branchCurrents.get('Z1').get(reverse ? 'cathode' : 'anode');
      assert.ok(Math.abs(resistorIntoOut + zenerAtOut) < 2e-10, 'output-node KCL');
    }
  });

  it('keeps the legacy no-model forward knee while the explicit card uses Shockley', () => {
    const explicit = zenerBench(2).nodeVoltage('out');
    const legacy = zenerBench(2, { vf: 0.7, vz: 8.2, ibv: 0 }).nodeVoltage('out');
    assert.ok(Math.abs(explicit - legacy) > 0.02,
      `independent model witness must distinguish explicit ${explicit} from legacy ${legacy}`);
    assert.ok(Math.abs(legacy - 0.712871287) < 1e-6,
      `legacy gallery knee moved: ${legacy}`);
  });

  it('refuses implicit, incomplete, invalid, extra, and disconnected zener semantics', () => {
    const cases = [
      [{ is: 1e-14, n: 1, rs: 0, vz: 8.2, ibv: 1e-3 }, /model must be explicitly 'shockley'/],
      [{ ...PARAMS, model: 'pwl' }, /model must be explicitly 'shockley'/],
      [{ ...PARAMS, is: undefined }, /is must be an explicit finite number greater than zero/],
      [{ ...PARAMS, n: 0 }, /n must be an explicit finite number greater than zero/],
      [{ ...PARAMS, rs: -1 }, /rs must be an explicit finite number greater than or equal to zero/],
      [{ ...PARAMS, vz: Infinity }, /vz must be an explicit finite number greater than zero/],
      [{ ...PARAMS, ibv: 0 }, /ibv must be an explicit finite number greater than zero/],
      [{ ...PARAMS, rz: 5 }, /parameter rz is outside/],
    ];
    for (const [params, pattern] of cases) {
      const board = zenerBench(2, params);
      const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern);
      assertUnchanged(board, before);
    }

    const disconnected = new BoardImpl(5);
    disconnected.setNetlist([
      { id: 'Z1', kind: 'zener', params: { ...PARAMS }, terminals: ['anode', 'cathode'] }, gnd,
    ], [{ id: 'gnd', terminals: [
      { part: 'Z1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' },
    ] }]);
    assert.throws(() => disconnected.operatingPoint(), /terminal anode is not connected/);
  });
});
