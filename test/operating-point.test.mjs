import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const resistor = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };

function rcBench(volts = 5) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    resistor('R1', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
    gnd,
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'C1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
  ]);
  return board;
}

function sameNetSourceBench(volts) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    resistor('R1', 1000), gnd,
  ], [
    { id: 'n', terminals: [{ part: 'R1', terminal: 'a' }] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'pos' }, { part: 'V1', terminal: 'neg' },
      { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
    ] },
  ]);
  return board;
}

function controlledBench(volts = 1, extraParts = []) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'E1', kind: 'vcvs', params: { gain: 2 },
      terminals: ['outp', 'outn', 'inp', 'inn'] },
    { id: 'G2', kind: 'vccs', params: { gm: 1e-3 },
      terminals: ['outp', 'outn', 'inp', 'inn'] },
    resistor('RE', 1000), resistor('RG', 1000),
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
    ...extraParts, gnd,
  ], [
    { id: 'ctl', terminals: [
      { part: 'V1', terminal: 'pos' },
      { part: 'E1', terminal: 'inp' }, { part: 'G2', terminal: 'inp' },
    ] },
    { id: 'eout', terminals: [
      { part: 'E1', terminal: 'outp' }, { part: 'RE', terminal: 'a' },
      { part: 'C1', terminal: 'a' },
    ] },
    { id: 'gout', terminals: [
      { part: 'G2', terminal: 'outp' }, { part: 'RG', terminal: 'a' },
    ] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' },
      { part: 'E1', terminal: 'outn' }, { part: 'E1', terminal: 'inn' },
      { part: 'G2', terminal: 'outn' }, { part: 'G2', terminal: 'inn' },
      { part: 'RE', terminal: 'b' }, { part: 'RG', terminal: 'b' },
      { part: 'C1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
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
    inductorCurrents: board.inductorCurrents,
    inductorVoltages: board.inductorVoltages,
    probes: board._probes,
    ledHistory: board.ledHistory,
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
  assert.equal(board.inductorCurrents, before.inductorCurrents);
  assert.equal(board.inductorVoltages, before.inductorVoltages);
  assert.equal(board._probes, before.probes);
  assert.equal(board.ledHistory, before.ledHistory);
  assert.equal(board._deviceStates, before.deviceStates);
  assert.equal(board.controls, before.controls);
  assert.equal(board._mnaCache, before.cache);
  assert.equal(JSON.stringify(board._solveParts), before.parts);
}

describe('BoardImpl.operatingPoint', () => {
  it('opens a capacitor at DC, returns signed currents, and never adopts the result', () => {
    const board = rcBench(5);
    assert.ok(board.nodeVoltage('out') < 1e-5, 'live t=0 state keeps the uncharged capacitor at 0 V');
    const before = stateWitness(board);
    let notifications = 0;
    const listener = () => { notifications++; };
    board.onChange(listener);
    const first = board.operatingPoint();
    const second = board.operatingPoint();
    board.offChange(listener);
    assert.equal(first.converged, true);
    assert.deepEqual(first.railConflicts, []);
    assert.ok(Math.abs(first.nodeVoltages.get('out') - 5) < 1e-6);
    assert.equal(first.branchCurrents.get('C1').get('a'), 0);
    assert.ok(Math.abs(first.branchCurrents.get('R1').get('a')) < 1e-9);
    assert.ok(Math.abs(first.branchCurrents.get('V1').get('pos')) < 1e-9);
    assert.equal(first.analysis.currentConvention, 'positive-into-part-terminal');
    assert.notEqual(first.nodeVoltages, second.nodeVoltages);
    assert.equal(notifications, 0);
    assertUnchanged(board, before);
  });

  it('normalizes positive and negative resistor/source currents and satisfies KCL', () => {
    for (const volts of [5, -5]) {
      const board = new BoardImpl(5);
      board.setNetlist([
        { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
        resistor('R1', 1000), gnd,
      ], [
        { id: 'n', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
        { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
      ]);
      const op = board.operatingPoint();
      const iR = op.branchCurrents.get('R1').get('a');
      const iV = op.branchCurrents.get('V1').get('pos');
      assert.ok(Math.abs(iR - volts / 1000) < 1e-9, `${volts} V resistor current`);
      assert.ok(Math.abs(iV + volts / 1000) < 2e-11, `${volts} V source current`);
      assert.ok(Math.abs(iR + iV) < 2e-11, `${volts} V node KCL`);
    }
  });

  it('normalizes an independent current source as current into its terminals', () => {
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'I1', kind: 'isource', params: { amps: 0.002 }, terminals: ['pos', 'neg'] },
      resistor('R1', 1000), gnd,
    ], [
      { id: 'n', terminals: [{ part: 'I1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'I1', terminal: 'neg' }, { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    const op = board.operatingPoint();
    assert.ok(Math.abs(op.nodeVoltages.get('n') - 2) < 1e-8);
    assert.equal(op.branchCurrents.get('I1').get('pos'), -0.002);
    assert.equal(op.branchCurrents.get('I1').get('neg'), 0.002);
    assert.ok(Math.abs(op.branchCurrents.get('R1').get('a') - 0.002) < 1e-11);
  });

  it('matches ngspice .op for the self-authored RC deck', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const deck = '* self-authored RC operating point\nV1 in 0 DC 5\nR1 in out 1k\nC1 out 0 1u\n.op\n.end\n';
    const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const match = ng.stdout.match(/out\s+([+\-0-9.e]+)/i);
    assert.ok(match, ng.stdout);
    const op = rcBench().operatingPoint();
    assert.ok(Math.abs(op.nodeVoltages.get('out') - Number(match[1])) < 1e-6);
  });

  it('solves ideal VCVS/VCCS with signed terminal currents, KCL, and no state adoption', () => {
    for (const volts of [1, -1]) {
      const board = controlledBench(volts);
      const before = stateWitness(board);
      const first = board.operatingPoint();
      const second = board.operatingPoint();
      assert.equal(first.converged, true);
      assert.equal(first.analysis.scope,
        'grounded-static-native-r-c-l-d-v-i-e-g-exact-ideal-l-explicit-shockley-d');
      assert.equal(first.analysis.controlledSources, 'ideal-explicit-finite-parameters-only');
      assert.ok(first.analysis.supportedKinds.includes('vcvs'));
      assert.ok(first.analysis.supportedKinds.includes('vccs'));
      assert.ok(Math.abs(first.nodeVoltages.get('eout') - 2 * volts) < 1e-10);
      assert.ok(Math.abs(first.nodeVoltages.get('gout') - volts) < 2e-9);
      assert.equal(first.branchCurrents.get('E1').get('inp'), 0);
      assert.equal(Math.abs(first.branchCurrents.get('G2').get('inp')), 0);
      assert.ok(Math.abs(first.branchCurrents.get('E1').get('outp') + 2e-3 * volts) < 5e-12);
      assert.ok(Math.abs(first.branchCurrents.get('RE').get('a') - 2e-3 * volts) < 1e-12);
      assert.ok(Math.abs(first.branchCurrents.get('E1').get('outp')
        + first.branchCurrents.get('RE').get('a')) < 5e-12, 'VCVS output KCL');
      assert.ok(Math.abs(first.branchCurrents.get('G2').get('outp') + 1e-3 * volts) < 1e-12);
      assert.ok(Math.abs(first.branchCurrents.get('RG').get('a') - 1e-3 * volts) < 2e-12);
      assert.ok(Math.abs(first.branchCurrents.get('G2').get('outp')
        + first.branchCurrents.get('RG').get('a')) < 2e-12, 'VCCS output KCL');
      assert.equal(first.branchCurrents.get('C1').get('a'), 0, 'capacitor remains DC-open');
      assert.notEqual(first.nodeVoltages, second.nodeVoltages);
      assertUnchanged(board, before);
    }
  });

  it('matches ngspice .op for ideal VCVS/VCCS polarities and source currents', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const volts of [1, -1]) {
      // bw-board defines G2 as current injected INTO outp. In SPICE's G-card
      // convention that is the reversed output-node order: 0 gout ctl 0.
      const deck = `self-authored ideal controlled sources\nV1 ctl 0 DC ${volts}\n`
        + 'E1 eout 0 ctl 0 2\nRE eout 0 1k\nG2 0 gout ctl 0 1m\nRG gout 0 1k\n'
        + '.control\nset numdgt=15\nop\nprint v(eout) v(gout) @e1[i] @g2[i]\n.endc\n.end\n';
      const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
      assert.equal(ng.status, 0, ng.stderr || ng.stdout);
      const read = (expr) => {
        const match = ng.stdout.match(new RegExp(`${expr}\\s*=\\s*([-+0-9.e]+)`, 'i'));
        assert.ok(match, ng.stdout);
        return Number(match[1]);
      };
      const op = controlledBench(volts).operatingPoint();
      assert.ok(Math.abs(op.nodeVoltages.get('eout') - read('v\\(eout\\)')) < 1e-10);
      assert.ok(Math.abs(op.nodeVoltages.get('gout') - read('v\\(gout\\)')) < 2e-9);
      assert.ok(Math.abs(op.branchCurrents.get('E1').get('outp') - read('@e1\\[i\\]')) < 1e-10);
      // @g2[i] enters SPICE G2's first output terminal, which is our outn.
      assert.ok(Math.abs(op.branchCurrents.get('G2').get('outn') - read('@g2\\[i\\]')) < 1e-10);
    }
  });

  it('returns non-convergence explicitly instead of blessing the last iterate', () => {
    const board = new BoardImpl(5);
    const source = (id, volts) => ({
      id, kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'],
    });
    board.setNetlist([source('V1', 5), source('V2', 3), gnd], [
      { id: 'n', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'V2', terminal: 'pos' }] },
      { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'V2', terminal: 'neg' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    const before = stateWitness(board);
    const op = board.operatingPoint();
    assert.equal(op.converged, false, 'contradictory ideal sources have no operating point');
    assertUnchanged(board, before);
  });

  it('returns controlled-source constraint non-convergence without mutating live state', () => {
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'V1', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
      { id: 'E1', kind: 'vcvs', params: { gain: 2 },
        terminals: ['outp', 'outn', 'inp', 'inn'] }, gnd,
    ], [
      { id: 'n', terminals: [
        { part: 'V1', terminal: 'pos' }, { part: 'E1', terminal: 'outp' },
        { part: 'E1', terminal: 'inp' },
      ] },
      { id: 'gnd', terminals: [
        { part: 'V1', terminal: 'neg' }, { part: 'E1', terminal: 'outn' },
        { part: 'E1', terminal: 'inn' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    const before = stateWitness(board);
    assert.equal(board.operatingPoint().converged, false);
    assertUnchanged(board, before);
  });

  it('refuses non-ideal, unspecified, non-finite, same-net, and disconnected controlled sources', () => {
    const cases = [
      [{ kind: 'vcvs', params: {} }, /gain must be an explicit finite number/],
      [{ kind: 'vcvs', params: { gain: Infinity } }, /gain must be an explicit finite number/],
      [{ kind: 'vccs', params: {} }, /gm must be an explicit finite number/],
      [{ kind: 'vccs', params: { gm: Number.NaN } }, /gm must be an explicit finite number/],
      [{ kind: 'vcvs', params: { gain: 2, railHigh: 5 } }, /declared railHigh/],
      [{ kind: 'vcvs', params: { gain: 2, rout: 10 } }, /declared rout/],
      [{ kind: 'vcvs', params: { gain: 2, iShort: 0.04 } }, /declared iShort/],
      [{ kind: 'vccs', params: { gm: 1e-3, iMax: 0.01 } }, /declared iMax/],
      [{ kind: 'vccs', params: { gm: 1e-3, railLow: 0 } }, /declared railLow/],
    ];
    for (const [source, pattern] of cases) {
      const board = new BoardImpl(5);
      board.setNetlist([
        { id: 'S1', kind: source.kind, params: source.params,
          terminals: ['outp', 'outn', 'inp', 'inn'] }, resistor('R1', 1000), gnd,
      ], [
        { id: 'out', terminals: [{ part: 'S1', terminal: 'outp' }, { part: 'R1', terminal: 'a' }] },
        { id: 'gnd', terminals: [
          { part: 'S1', terminal: 'outn' }, { part: 'S1', terminal: 'inp' },
          { part: 'S1', terminal: 'inn' }, { part: 'R1', terminal: 'b' },
          { part: 'G1', terminal: 'gnd' },
        ] },
      ]);
      const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern);
      assertUnchanged(board, before);
    }

    const sameNet = new BoardImpl(5);
    sameNet.setNetlist([
      { id: 'E1', kind: 'vcvs', params: { gain: 0 },
        terminals: ['outp', 'outn', 'inp', 'inn'] }, resistor('R1', 1000), gnd,
    ], [
      { id: 'n', terminals: [{ part: 'R1', terminal: 'a' }] },
      { id: 'gnd', terminals: [
        { part: 'E1', terminal: 'outp' }, { part: 'E1', terminal: 'outn' },
        { part: 'E1', terminal: 'inp' }, { part: 'E1', terminal: 'inn' },
        { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    const sameBefore = stateWitness(sameNet);
    assert.throws(() => sameNet.operatingPoint(),
      /unsupported same-net ideal VCVS output E1; outp and outn both resolve to gnd/);
    assertUnchanged(sameNet, sameBefore);

    const disconnected = new BoardImpl(5);
    disconnected.setNetlist([
      { id: 'E1', kind: 'vcvs', params: { gain: 2 },
        terminals: ['outp', 'outn', 'inp', 'inn'] }, resistor('R1', 1000), gnd,
    ], [
      { id: 'out', terminals: [{ part: 'E1', terminal: 'outp' }, { part: 'R1', terminal: 'a' }] },
      { id: 'gnd', terminals: [
        { part: 'E1', terminal: 'outn' }, { part: 'E1', terminal: 'inn' },
        { part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    const disconnectedBefore = stateWitness(disconnected);
    assert.throws(() => disconnected.operatingPoint(), /terminal inp is not connected/);
    assertUnchanged(disconnected, disconnectedBefore);
  });

  it('does not let control pins or VCCS output current anchor a floating DC network', () => {
    const floatingControl = new BoardImpl(5);
    floatingControl.setNetlist([
      { id: 'E1', kind: 'vcvs', params: { gain: 2 },
        terminals: ['outp', 'outn', 'inp', 'inn'] }, resistor('RO', 1000),
      resistor('RC', 1000), gnd,
    ], [
      { id: 'out', terminals: [{ part: 'E1', terminal: 'outp' }, { part: 'RO', terminal: 'a' }] },
      { id: 'cp', terminals: [{ part: 'E1', terminal: 'inp' }, { part: 'RC', terminal: 'a' }] },
      { id: 'cn', terminals: [{ part: 'E1', terminal: 'inn' }, { part: 'RC', terminal: 'b' }] },
      { id: 'gnd', terminals: [
        { part: 'E1', terminal: 'outn' }, { part: 'RO', terminal: 'b' },
        { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    assert.throws(() => floatingControl.operatingPoint(), /DC-floating nets cp, cn|DC-floating nets cn, cp/);

    const floatingOutput = new BoardImpl(5);
    floatingOutput.setNetlist([
      { id: 'V1', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
      { id: 'G2', kind: 'vccs', params: { gm: 1e-3 },
        terminals: ['outp', 'outn', 'inp', 'inn'] }, resistor('RO', 1000), gnd,
    ], [
      { id: 'ctl', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'G2', terminal: 'inp' }] },
      { id: 'op', terminals: [{ part: 'G2', terminal: 'outp' }, { part: 'RO', terminal: 'a' }] },
      { id: 'on', terminals: [{ part: 'G2', terminal: 'outn' }, { part: 'RO', terminal: 'b' }] },
      { id: 'gnd', terminals: [
        { part: 'V1', terminal: 'neg' }, { part: 'G2', terminal: 'inn' },
        { part: 'G1', terminal: 'gnd' },
      ] },
    ]);
    assert.throws(() => floatingOutput.operatingPoint(), /DC-floating nets op, on|DC-floating nets on, op/);
  });

  it('rejects a nonzero source shorted onto one net and preserves a zero-volt control', () => {
    const invalid = sameNetSourceBench(5);
    const invalidBefore = stateWitness(invalid);
    assert.throws(() => invalid.operatingPoint(),
      /inconsistent ideal voltage constraint V1; 5 V cannot be imposed across the same net gnd/);
    assertUnchanged(invalid, invalidBefore);

    const zero = sameNetSourceBench(0);
    const zeroBefore = stateWitness(zero);
    const op = zero.operatingPoint();
    assert.equal(op.converged, true);
    assert.equal(op.nodeVoltages.get('n'), 0);
    assertUnchanged(zero, zeroBefore);
  });

  it('refuses unsupported and DC-floating semantics without touching live state', () => {
    const cases = [
      [{ id: 'V1', kind: 'vsource', params: { wave: 'sine' }, terminals: ['pos', 'neg'] }, /time-varying/],
      [{ id: 'V1', kind: 'vsource', params: { volts: 5, iLimit: 0.1 }, terminals: ['pos', 'neg'] }, /current-limited/],
      [{ id: 'T1', kind: 'transformer', params: {}, terminals: ['p1', 'p2', 's1', 's2'] }, /unsupported part T1 \(transformer\)/],
      [{ id: 'LED1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] }, /unsupported part LED1 \(led\)/],
    ];
    for (const [part, pattern] of cases) {
      const board = new BoardImpl(5);
      const terms = part.terminals;
      board.setNetlist([part, gnd], [
        { id: 'n', terminals: [{ part: part.id, terminal: terms[0] }] },
        { id: 'gnd', terminals: [{ part: part.id, terminal: terms[1] }, { part: 'G1', terminal: 'gnd' }] },
      ]);
      const before = stateWitness(board);
      assert.throws(() => board.operatingPoint(), pattern);
      assertUnchanged(board, before);
    }

    const floating = new BoardImpl(5);
    floating.setNetlist([
      { id: 'I1', kind: 'isource', params: { amps: 1e-3 }, terminals: ['pos', 'neg'] },
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }, gnd,
    ], [
      { id: 'float', terminals: [{ part: 'I1', terminal: 'pos' }, { part: 'C1', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'I1', terminal: 'neg' }, { part: 'C1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    const before = stateWitness(floating);
    assert.throws(() => floating.operatingPoint(), /DC-floating net float/);
    assertUnchanged(floating, before);
  });
});
