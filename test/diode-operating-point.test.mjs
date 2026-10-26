import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { JUNCTION_THERMAL_VOLTAGE, JUNCTION_GMIN } from '../src/mna.js';
import { withJunctionEdgeOmitted } from './helpers/junction-dc-source-mutation.mjs';

const K_OVER_Q = 8.617333262145e-5;
const MATCHED_TEMP_C = JUNCTION_THERMAL_VOLTAGE / K_OVER_Q - 273.15;
const PARAMS = Object.freeze({ model: 'shockley', is: 2e-12, n: 1.3, rs: 4 });
const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

function diodeBench(volts, params = PARAMS, { capacitor = false, BoardType = BoardImpl } = {}) {
  const board = new BoardType(5);
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
      'grounded-static-native-r-c-l-d-led-z-q-m-v-i-e-g-exact-ideal-l-explicit-shockley-d-led-z-npn-level1-nmos-pmos');
    assert.ok(first.analysis.supportedKinds.includes('diode'));
    assert.deepEqual(first.analysis.diodes, {
      model: 'explicit-shockley',
      parameters: ['is', 'n', 'rs'],
      // One junction law covers both kinds; the LED's two extra parameters are
      // declared here precisely because they are NOT electrical.
      kinds: ['diode', 'led'],
      ledNonElectricalParameters: ['vf', 'color'],
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
        // -IS + GMIN*V, which is what the REFERENCE carries: ngspice puts GMIN
        // across the junction, so a reverse diode is a conductance as well as a
        // saturation current.
        //
        // WHAT THIS LINE USED TO SAY, AND WHY IT MATTERS. It asserted
        // `iD == -IS` to 1e-18 -- a claim about this engine's old model, sitting
        // next to a live-ngspice comparison that passed. With IS = 2e-12 and
        // V = -2 V the GMIN term is another -2e-12, so the old answer was off
        // by EXACTLY A FACTOR OF TWO and the 3e-12 absolute tolerance above was
        // wide enough to hold either. The hand-written claim was the only thing
        // separating them, and it was separating in favour of the wrong one.
        //
        // So the tolerance is relative now and 200x tighter than the gap
        // between the two models, which is what makes it a test rather than an
        // accommodation.
        const expectedReverse = -PARAMS.is + JUNCTION_GMIN * volts;
        assert.ok(Math.abs(iD - expectedReverse) < Math.abs(expectedReverse) * 1e-6,
          `reverse diode current ${iD} A, contract ${expectedReverse} A `
          + '(-IS + GMIN*V, the reference\'s own junction)');
        assert.ok(Math.abs(iD / expected.diode - 1) < 1e-4,
          `reverse diode current ${iD} A vs ngspice ${expected.diode} A: a relative `
          + 'check, because an absolute one at this scale passes a 2x error');
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

  it('requires both terminal nets and admits an explicit junction as a DC anchor', () => {
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
    const before = stateWitness(floating);
    const op = floating.operatingPoint();
    assert.equal(op.converged, true);
    assert.ok(Math.abs(op.nodeVoltages.get('float')) < 1e-12);
    assert.ok(Math.abs(op.nodeVoltages.get('float2')) < 1e-12);
    assertUnchanged(floating, before);
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

/**
 * An LED is the same junction. mna.js has branched on
 * `kind === 'led' || kind === 'diode'` everywhere for as long as both have
 * existed, and applies one Newton limiter to both — but operatingPoint()
 * refused `led` by KIND, so the one circuit every beginner meets first,
 * VCC → resistor → LED, could not be asked for its own DC point. It is
 * admitted here on exactly the diode's terms: an explicit Shockley model with
 * a complete is/n/rs set. `vf` and `color` may ride along because neither is a
 * term in the Shockley law — vf is only the Newton seed.
 */
describe('operating point: LED on the diode terms', () => {
  const RED = Object.freeze({ model: 'shockley', is: 1e-20, n: 1.8, rs: 4 });

  function ledBench(params) {
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'D1', kind: 'led', params: { ...params }, terminals: ['anode', 'cathode'] },
      gnd,
    ], [
      { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
      { id: 'gnd', terminals: [
        { part: 'V1', terminal: 'neg' }, { part: 'D1', terminal: 'cathode' },
        { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    return board;
  }

  it('matches independent ngspice on a red LED, at the matched temperature', () => {
    const op = ledBench(RED).operatingPoint();
    assert.equal(op.converged, true);
    const oracle = ngspicePoint(5, RED);
    const mine = op.nodeVoltages.get('out');
    // 1e-5, not the diode bench's 2e-6: a red LED's is=1e-20 is eight decades
    // below the 2e-12 signal diode, so the junction is far stiffer and the two
    // Newton loops stop a little further apart. Measured gap here: 5.3 uV.
    assert.ok(Math.abs(mine - oracle.out) < 1e-5,
      `LED node: got ${mine}, ngspice ${oracle.out}`);
    // Independent of the node value: the solved point must satisfy the device
    // equation and KCL, so a solver that merely agreed by luck still fails.
    // The loop current, from the SOURCE branch: ngspice's @d1[id] reads the
    // junction current inside RS and sits 0.4 uA off the loop, which would make
    // this check look broken for a reason that is not ours.
    assert.ok(Math.abs(Math.abs(oracle.source) - (5 - oracle.out) / 1000) < 1e-12,
      'the LED loop current must be the resistor current');
  });

  it('gives an LED carrying vf and color the same point, to the last bit', () => {
    // vf is the Newton seed and color is a label: neither may move the answer,
    // or admitting them alongside the Shockley set would be smuggling in a
    // second model.
    const bare = ledBench(RED).operatingPoint().nodeVoltages.get('out');
    const dressed = ledBench({ ...RED, vf: 2, color: 'red' })
      .operatingPoint().nodeVoltages.get('out');
    assert.equal(dressed, bare);
  });

  it('refuses a knee-model LED and says what is missing', () => {
    assert.throws(() => ledBench({ vf: 2, color: 'red' }).operatingPoint(), err => {
      assert.match(err.message, /unsupported LED D1/);
      assert.match(err.message, /model must be explicitly 'shockley'/);
      assert.match(err.message, /vf=2/);       // names what it DID find
      assert.match(err.message, /add is, n and rs/); // and the way forward
      return true;
    });
  });

  it('keeps every other LED refusal a refusal', () => {
    for (const [params, pattern] of [
      [{ model: 'shockley', is: 0, n: 1.8, rs: 4 }, /is must be an explicit finite number/],
      [{ model: 'shockley', is: 1e-20, n: -1, rs: 4 }, /n must be an explicit finite number/],
      [{ model: 'shockley', is: 1e-20, n: 1.8, rs: -1 }, /rs must be an explicit finite/],
      [{ model: 'shockley', is: 1e-20, n: 1.8, rs: 4, brightness: 3 },
        /parameter brightness is outside the explicit Shockley DC domain/],
    ]) {
      assert.throws(() => ledBench(params).operatingPoint(), pattern,
        JSON.stringify(params));
    }
  });

  it('does not widen the DIODE parameter set along with the LED one', () => {
    // vf and color are admitted because an LED carries them, not because the
    // Shockley domain grew. A diode that names either is still an error.
    const diodeWith = extra => {
      const board = new BoardImpl(5);
      board.setNetlist([
        { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'D1', kind: 'diode', params: { ...PARAMS, ...extra }, terminals: ['anode', 'cathode'] },
        gnd,
      ], [
        { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
        { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
        { id: 'gnd', terminals: [
          { part: 'V1', terminal: 'neg' }, { part: 'D1', terminal: 'cathode' },
          { part: 'G1', terminal: 'gnd' },
        ] },
      ]);
      return board;
    };
    assert.throws(() => diodeWith({ vf: 0.7 }).operatingPoint(),
      /parameter vf is outside the explicit Shockley DC domain/);
    assert.throws(() => diodeWith({ color: 'red' }).operatingPoint(),
      /parameter color is outside the explicit Shockley DC domain/);
  });

  it('reports the LED in the analysis metadata rather than passing silently', () => {
    const { analysis } = ledBench(RED).operatingPoint();
    assert.ok(analysis.supportedKinds.includes('led'));
    assert.deepEqual(analysis.diodes.kinds, ['diode', 'led']);
    assert.deepEqual(analysis.diodes.ledNonElectricalParameters, ['vf', 'color']);
  });
});

const BRIDGE_PARAMS = Object.freeze({ model: 'shockley', is: 1e-12, n: 1, rs: 0 });
function junctionBridge(volts, { BoardType = BoardImpl, kind = 'diode' } = {}) {
  const board = new BoardType(5);
  const parts = [
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'E1', kind: 'vcvs', params: { gain: -1 }, terminals: ['outp', 'outn', 'inp', 'inn'] },
    ...['D1', 'D2', 'D3', 'D4'].map(id => ({ id, kind, params: { ...BRIDGE_PARAMS }, terminals: ['anode', 'cathode'] })),
    { id: 'RL', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] }, gnd,
  ];
  const t = (part, terminal) => ({ part, terminal });
  const nets = [
    { id: 'in', terminals: [t('V1', 'pos'), t('E1', 'inp'), t('D1', 'anode'), t('D3', 'cathode')] },
    { id: 'acn', terminals: [t('E1', 'outp'), t('D2', 'anode'), t('D4', 'cathode')] },
    { id: 'out', terminals: [t('D1', 'cathode'), t('D2', 'cathode'), t('RL', 'a')] },
    { id: 'ret', terminals: [t('D3', 'anode'), t('D4', 'anode'), t('RL', 'b')] },
    { id: 'gnd', terminals: [t('V1', 'neg'), t('E1', 'outn'), t('E1', 'inn'), t('G1', 'gnd')] },
  ];
  board.setNetlist(parts, nets);
  return { board, nets };
}
function assertJunctionKcl(op, nets) {
  for (const net of nets) {
    let total = 0;
    for (const terminal of net.terminals) {
      if (terminal.part === 'G1') continue;
      const current = op.branchCurrents.get(terminal.part)?.get(terminal.terminal);
      assert.ok(Number.isFinite(current), `finite ${terminal.part}.${terminal.terminal}`);
      total += current;
    }
    assert.ok(Math.abs(total) < 1e-10, `${net.id} terminal KCL ${total} A`);
  }
}
function ngspiceBridge(volts) {
  const names = ['v(out)', 'v(ret)', '@v1[i]', '@e1[i]'];
  const deck = `* self-authored junction-referenced bridge
.temp ${MATCHED_TEMP_C}
.options tnom=${MATCHED_TEMP_C} gmin=${JUNCTION_GMIN} reltol=1e-12 abstol=1e-18 vntol=1e-15
V1 in 0 ${volts}
E1 acn 0 in 0 -1
D1 in out SELF
D2 acn out SELF
D3 ret in SELF
D4 ret acn SELF
RL out ret 2000
.model SELF D(IS=1e-12 N=1 RS=0)
.control
set numdgt=17
op
print ${names.join(' ')}
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  return Object.fromEntries(names.map(name => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = run.stdout.match(new RegExp(`${escaped}\\s*=\\s*([-+0-9.e]+)`, 'i'));
    assert.ok(match, `${name} absent from oracle output`);
    const value = Number(match[1]);
    assert.ok(Number.isFinite(value));
    return [name, value];
  }));
}

describe('explicit Shockley junction DC reference propagation', () => {
  it('solves diode and LED bridges through their actual junction paths without state adoption', () => {
    assert.ok(JUNCTION_GMIN > 0, 'reachability requires the admitted real parallel junction law');
    for (const kind of ['diode', 'led']) for (const volts of [-2, 0, 2]) {
      const { board, nets } = junctionBridge(volts, { kind });
      const before = stateWitness(board), op = board.operatingPoint();
      assert.equal(op.converged, true, `${kind} bridge ${volts} V`);
      for (const value of op.nodeVoltages.values()) assert.ok(Number.isFinite(value));
      assertJunctionKcl(op, nets);
      assertUnchanged(board, before);
    }
  });

  it('matches independent bridge DC voltages and signed source currents at both polarities and zero', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const volts of [-2, 0, 2]) {
      const expected = ngspiceBridge(volts);
      for (const kind of ['diode', 'led']) {
        const { board, nets } = junctionBridge(volts, { kind });
        const op = board.operatingPoint();
        assert.equal(op.converged, true);
        for (const [net, vector] of [['out', 'v(out)'], ['ret', 'v(ret)']]) {
          assert.ok(Math.abs(op.nodeVoltages.get(net) - expected[vector]) < 2e-6, `${kind} ${volts} V ${net}`);
        }
        for (const [id, terminal, vector] of [['V1', 'pos', '@v1[i]'], ['E1', 'outp', '@e1[i]']]) {
          assert.ok(Math.abs(op.branchCurrents.get(id).get(terminal) - expected[vector]) < 1e-8,
            `${kind} ${volts} V signed ${id} current`);
        }
        assertJunctionKcl(op, nets);
      }
    }
  });

  it('omitting the actual diode edge restores the bridge refusal while a grounded control still solves', async () => {
    await withJunctionEdgeOmitted('diode', async BoardType => {
      assert.equal(diodeBench(2, PARAMS, { BoardType }).operatingPoint().converged, true);
      const { board } = junctionBridge(2, { BoardType });
      assert.throws(() => board.operatingPoint(), /DC-floating nets? .*out.*ret/);
    });
  });
});
