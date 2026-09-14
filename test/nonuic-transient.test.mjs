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
    assert.equal(board.branchCurrent('L1', 'a'), initialized.inductorCurrents.get('L1'));
    board.advanceTo(100_000n);
    assert.ok(Math.abs(board.nodeVoltage('mid') - expected.mid) < 6e-6);
    assert.ok(Math.abs(board.nodeVoltage('coil') - expected.coil) < 1e-10);
    assert.ok(Math.abs(board.branchCurrent('L1', 'a') - expected.inductor) < 6e-9);
    assert.equal(Math.sign(board.branchCurrent('L1', 'a')), Math.sign(volts));
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
