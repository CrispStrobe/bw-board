import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const NGSPICE = process.env.NGSPICE || 'ngspice';

function rcl(volts = -4, capParams = { farads: 1e-6 }) {
  const board = new BoardImpl();
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: capParams, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
    { id: 'L1', kind: 'inductor', params: { henrys: 0.003 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }, { part: 'R2', terminal: 'a' }] },
    { id: 'coil', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'L1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'C1', terminal: 'b' },
      { part: 'L1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
  ]);
  return board;
}

function ngspiceFinal(volts) {
  const deck = `* self-authored non-UIC RCL transient\nV1 in 0 ${volts}\nR1 in mid 1k\nC1 mid 0 1u\nR2 mid coil 2k\nL1 coil 0 3m\n.tran 10u 100u\n.print tran v(mid) v(coil) i(l1)\n.end\n`;
  const result = spawnSync(NGSPICE, ['-n', '-b'], { input: deck, encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: process.env.HOME } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const row = result.stdout.split(/\r?\n/).map(line => line.trim().split(/\s+/))
    .find(fields => fields.length === 5 && fields[1] === '1.000000e-04');
  assert.ok(row, result.stdout);
  return { mid: Number(row[2]), coil: Number(row[3]), inductor: Number(row[4]) };
}

function state(board) {
  return {
    timeNs: board.timeNs, capVoltages: board.capVoltages,
    inductorCurrents: board.inductorCurrents, capCurrents: board.capCurrents,
    inductorVoltages: board.inductorVoltages, nodeVoltages: board.nodeVoltages,
    cache: board._mnaCache,
    values: structuredClone({ capVoltages: board.capVoltages,
      inductorCurrents: board.inductorCurrents, capCurrents: board.capCurrents,
      inductorVoltages: board.inductorVoltages, nodeVoltages: board.nodeVoltages }),
  };
}

function unchanged(board, before) {
  for (const name of ['capVoltages', 'inductorCurrents', 'capCurrents', 'inductorVoltages', 'nodeVoltages']) {
    assert.equal(board[name], before[name]); assert.deepEqual(board[name], before.values[name]);
  }
  assert.equal(board.timeNs, before.timeNs); assert.equal(board._mnaCache, before.cache);
}

test('non-UIC initialization adopts signed RCL bias and stays numerically aligned with ngspice', {
  skip: spawnSync(NGSPICE, ['--version'], { encoding: 'utf8' }).status !== 0,
}, () => {
  for (const volts of [-4, 4]) {
    const expected = ngspiceFinal(volts); const board = rcl(volts);
    const initialized = board.initializeTransientFromOperatingPoint();
    assert.equal(initialized.analysis.initialization, 'source-declared-dc-operating-point');
    assert.equal(initialized.analysis.integrationRestart, 'backward-euler');
    assert.equal(Math.sign(initialized.capacitorVoltages.get('C1')), Math.sign(volts));
    assert.equal(Math.sign(initialized.inductorCurrents.get('L1')), Math.sign(volts));
    // TERMINAL B, NOT A, AND THE RESISTOR BESIDE IT SETTLES WHY.
    //
    // `branchCurrent()` is OUT-OF-PART POSITIVE. ngspice's `i(lxxx)` is the
    // FIRST-node-to-second-node current, so for `L1 coil 0` it is the a -> b
    // current -- which under this convention is terminal B's reading and the
    // NEGATIVE of terminal A's.
    //
    // Reading 'a' here is what motivated flipping the inductor's public signs
    // inside `solveMNA`, and that flip broke net-level Kirchhoff for every
    // inductor sharing a net with another device, by exactly twice the branch
    // current. Measured, both source polarities, on this very bench:
    //
    //   volts = -4   ngspice i(l1) = -1.333330e-3
    //                L1.a = +1.333333e-3   L1.b = -1.333333e-3   -> B matches
    //                R2's a -> b current from Ohm's law = -1.333333e-3
    //                R2.a = +1.333333e-3   R2.b = -1.333333e-3   -> B matches
    //   volts = +4   the same with every sign reversed
    //   KCL at the coil net (R2.b + L1.a): 2.2e-16 mA
    //
    // The resistor's a -> b current is derived from Ohm's law across its own
    // nodes and so depends on no convention at all -- and it lands on terminal
    // B exactly as the inductor does. So the inductor was never the odd one
    // out; the terminal this test read was.
    //
    // Everything else in this test is unchanged and still holds: the signed
    // bias, the sign tracking `volts`, and agreement with ngspice to 6e-9.
    assert.equal(board.branchCurrent('L1', 'b'), initialized.inductorCurrents.get('L1'));
    board.advanceTo(100_000n);
    assert.ok(Math.abs(board.nodeVoltage('mid') - expected.mid) < 6e-6);
    assert.ok(Math.abs(board.nodeVoltage('coil') - expected.coil) < 1e-10);
    assert.ok(Math.abs(board.branchCurrent('L1', 'b') - expected.inductor) < 6e-9);
    assert.equal(Math.sign(board.branchCurrent('L1', 'b')), Math.sign(volts));
    // And the invariant that the flip broke, asserted here too so this bench
    // cannot go green on a convention that fails Kirchhoff.
    assert.ok(Math.abs(board.branchCurrent('R2', 'b') + board.branchCurrent('L1', 'a')) < 1e-9,
      'KCL at the coil net: R2.b and L1.a are the two ends of one wire');
    assert.ok(Math.abs(board.capVoltages.get('C1') - expected.mid) < 6e-6);
    assert.equal(board._lastSolveConverged, true);
  }
});

test('initializer failure is atomic for advanced, precharged, explicit-IC and malformed waveform states', () => {
  const cases = [
    board => board.advanceTo(1n),
    board => board.capVoltages.set('C1', 1),
    board => { board._solveParts.find(part => part.id === 'C1').params.ic = 1; },
    board => { const source = board._solveParts.find(part => part.id === 'V1');
      source.params.wave = 'spice-pwl'; source.params.points = [[0, 1]]; },
  ];
  for (const arrange of cases) {
    const board = rcl(); arrange(board); const before = state(board);
    assert.throws(() => board.initializeTransientFromOperatingPoint());
    unchanged(board, before);
  }
});

function parallelInductors(sourceParams = { volts: 0 }, extraParts = [], extraNets = [], connections = {}) {
  const board = new BoardImpl();
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: sourceParams, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
    { id: 'L1', kind: 'inductor', params: { henrys: 0.001 }, terminals: ['a', 'b'] },
    { id: 'L2', kind: 'inductor', params: { henrys: 0.002 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ...extraParts,
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
      ...(connections.in || [])] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' },
      { part: 'C1', terminal: 'a' }, { part: 'L1', terminal: 'a' }, { part: 'L2', terminal: 'a' },
      ...(connections.mid || [])] },
    { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' },
      { part: 'C1', terminal: 'b' }, { part: 'L1', terminal: 'b' },
      { part: 'L2', terminal: 'b' }, { part: 'G1', terminal: 'gnd' },
      ...(connections.gnd || [])] },
    ...extraNets,
  ]);
  return board;
}

function sourceFreeSi7li3835() {
  const board = new BoardImpl();
  board.setNetlist([
    { id: 'C1', kind: 'capacitor', params: { farads: 5e-5 }, terminals: ['a', 'b'] },
    { id: 'L1', kind: 'inductor', params: { henrys: 100 }, terminals: ['a', 'b'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'N001', terminals: [{ part: 'C1', terminal: 'a' }, { part: 'R1', terminal: 'b' }] },
    { id: 'N002', terminals: [{ part: 'L1', terminal: 'a' }, { part: 'R2', terminal: 'b' }] },
    { id: 'V2', terminals: [{ part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }] },
    { id: '0', terminals: [{ part: 'C1', terminal: 'b' }, { part: 'L1', terminal: 'b' },
      { part: 'G1', terminal: 'gnd' }] },
  ]);
  return board;
}

test('successful OP certifies the exact source-free Si7li row 3835 as quiescent', () => {
  const board = sourceFreeSi7li3835();
  const point = board.operatingPoint();
  assert.equal(point.converged, true, 'the ordinary OP path succeeds; no fallback is involved');
  const initialized = board.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
  assert.equal(initialized.analysis.initialization, 'source-declared-quiescent-zero-state');
  assert.equal(initialized.analysis.quiescent, true);
  assert.deepEqual(Object.fromEntries(initialized.nodeVoltages), { 0: 0, N001: 0, N002: 0, V2: 0 });
  assert.deepEqual([...initialized.capacitorVoltages], [['C1', 0]]);
  assert.deepEqual([...initialized.inductorCurrents], [['L1', 0]]);
  assert.deepEqual(board._transientAnalysisWork, { attempts: 0, solves: 0, advances: 0 });
});

test('successful OP quiescence requires the actual returned state to be exactly zero', () => {
  const board = sourceFreeSi7li3835();
  const operatingPoint = board.operatingPoint.bind(board);
  board.operatingPoint = options => {
    const point = operatingPoint(options);
    point.branchCurrents.get('R1').set('a', 1);
    return point;
  };
  const initialized = board.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
  assert.equal(initialized.analysis.initialization, 'source-declared-dc-operating-point');
  assert.equal(initialized.analysis.quiescent, false,
    'a topology proof cannot conceal a nonzero solver result');
  assert.equal(initialized.nodeVoltages.get('N001'), 0);
});

test('biased and time-varying successful operating points are never certified quiescent', () => {
  const biased = rcl(1).initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
  assert.equal(biased.analysis.quiescent, false);
  const waveformBoard = rcl(0);
  Object.assign(waveformBoard._solveParts.find(part => part.id === 'V1').params,
    { wave: 'sine', freq: 1000, amplitude: 1, offset: 0 });
  const waveform = waveformBoard.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
  assert.equal(waveform.analysis.quiescent, false);
  assert.equal(waveform.analysis.initialization, 'source-declared-waveform-time-zero-operating-point');
});

test('explicit proven-zero fallback starts parallel ideal inductors without broadening public OP', () => {
  const board = parallelInductors();
  assert.throws(() => board.operatingPoint(), /individual branch currents are indeterminate/);
  assert.throws(() => board.initializeTransientFromOperatingPoint(), /individual branch currents are indeterminate/,
    'the no-options path remains the strict operating-point path');
  const initialized = board.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
  assert.equal(initialized.analysis.initialization, 'source-declared-quiescent-zero-state');
  assert.equal(initialized.analysis.quiescent, true);
  assert.deepEqual([...initialized.inductorCurrents], [['L1', 0], ['L2', 0]]);
  assert.deepEqual([...initialized.nodeVoltages.values()], [0, 0, 0]);
  board.advanceTo(1000n);
  assert.equal(board.nodeVoltage('mid'), 0);
  assert.equal(board.inductorCurrents.get('L1'), 0);
  assert.equal(board.inductorCurrents.get('L2'), 0);
  assert.equal(board._lastSolveConverged, true);
});

test('a waveform that is zero only at t=0 gets zero state but never a quiescent claim', () => {
  const board = parallelInductors({ volts: 0, wave: 'sine', freq: 1000, amplitude: 1, offset: 0 });
  const initialized = board.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' });
  assert.equal(initialized.analysis.initialization, 'source-declared-waveform-time-zero-zero-state');
  assert.equal(initialized.analysis.quiescent, false);
  board.advanceTo(250_000n);
  assert.ok(board.nodeVoltage('in') > 0.9, 'the later waveform is live rather than frozen at its t=0 value');
});

test('proven-zero fallback refuses nonzero, floating, redundant-ideal and explicit-IC cases atomically', () => {
  const nonzero = parallelInductors({ volts: 1 });
  const floating = parallelInductors({ volts: 0 },
    [{ id: 'RF', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
    [{ id: 'fa', terminals: [{ part: 'RF', terminal: 'a' }] },
      { id: 'fb', terminals: [{ part: 'RF', terminal: 'b' }] }]);
  const loop = parallelInductors({ volts: 0 },
    [{ id: 'V2', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] }], [],
    { in: [{ part: 'V2', terminal: 'pos' }], gnd: [{ part: 'V2', terminal: 'neg' }] });
  const explicit = parallelInductors();
  explicit._solveParts.find(part => part.id === 'L1').params.ic = 0;
  const unsupported = parallelInductors({ volts: 0 },
    [{ id: 'D1', kind: 'diode', params: { model: 'shockley', is: 1e-12, n: 1, rs: 0 },
      terminals: ['anode', 'cathode'] }], [],
    { mid: [{ part: 'D1', terminal: 'anode' }], gnd: [{ part: 'D1', terminal: 'cathode' }] });
  for (const board of [nonzero, floating, loop, explicit, unsupported]) {
    const before = state(board);
    assert.throws(() => board.initializeTransientFromOperatingPoint({ fallback: 'proven-zero-state' }));
    unchanged(board, before);
  }
  assert.throws(() => parallelInductors().initializeTransientFromOperatingPoint({ fallback: 'guess' }),
    /unknown fallback guess/);
});
