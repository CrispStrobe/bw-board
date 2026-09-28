import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { sourceVoltage } from '../src/mna.js';
import { nextSpicePulseCorner } from '../src/source-waveforms.js';

const pulse = (overrides = {}) => ({
  wave: 'spice-pulse',
  v1: -2,
  v2: 4,
  td: 2e-3,
  tr: 1e-3,
  tf: 2e-3,
  pw: 2e-3,
  per: 10e-3,
  ...overrides,
});
const source = params => ({ id: 'V1', kind: 'vsource', params, terminals: ['pos', 'neg'] });

function rcBoard(params) {
  const board = new BoardImpl(5);
  board.setNetlist([
    source(params),
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'src', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' }, { part: 'C1', terminal: 'b' },
      { part: 'G1', terminal: 'gnd' },
    ] },
  ]);
  return board;
}

function zeroWidthCurrentBoard() {
  const board = new BoardImpl(5);
  board.configureTransientAnalysis('precision-v1', { maxStepSec: 0.01 });
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'I1', kind: 'isource', params: { wave: 'spice-pulse',
      v1: 20e-6, v2: 200e-6, td: 0, tr: 4, tf: 1, pw: 0, per: 5 },
      terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 24e3 }, terminals: ['a', 'b'] },
    { id: 'R4', kind: 'resistor', params: { ohms: 1e6 }, terminals: ['a', 'b'] },
    { id: 'C2', kind: 'capacitor', params: { farads: 14e-12 }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    // Board current-source `pos` is the node current enters. This is the
    // engine-normalised form of SPICE `I1 N001 out ...`.
    { id: 'N001', terminals: [{ part: 'V1', terminal: 'pos' },
      { part: 'I1', terminal: 'neg' }] },
    { id: 'out', terminals: [{ part: 'I1', terminal: 'pos' },
      { part: 'R1', terminal: 'a' }, { part: 'R4', terminal: 'a' },
      { part: 'C2', terminal: 'a' }] },
    { id: '0', terminals: [{ part: 'V1', terminal: 'neg' },
      { part: 'R1', terminal: 'b' }, { part: 'R4', terminal: 'b' },
      { part: 'C2', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
  ]);
  return board;
}

describe('exact seven-argument SPICE PULSE voltage source', () => {
  it('preserves delay, unequal slopes, negative swing, and period repetition', () => {
    const p = pulse();
    const at = t => sourceVoltage(source(p), t, 5);
    assert.equal(at(0), -2);
    assert.equal(at(2e-3), -2);
    assert.ok(Math.abs(at(2.5e-3) - 1) < 1e-12, 'halfway up the 1 ms rise');
    assert.equal(at(3e-3), 4);
    assert.equal(at(5e-3), 4);
    assert.ok(Math.abs(at(6e-3) - 1) < 1e-12, 'halfway down the 2 ms fall');
    assert.equal(at(7e-3), -2);
    assert.equal(at(12e-3), -2);
    assert.ok(Math.abs(at(12.5e-3) - 1) < 1e-12, 'the next period repeats the same rise');

    const negative = pulse({ v1: 3, v2: -5 });
    assert.ok(Math.abs(sourceVoltage(source(negative), 2.5e-3, 5) - (-1)) < 1e-12,
      'V2 below V1 is a falling authored rise, not an absolute amplitude');
  });

  it('treats zero PW as a held default width and aligns its period restart', () => {
    const p = pulse({ td: 1, tr: 2, pw: 0, tf: 3, per: 10 });
    const at = t => sourceVoltage(source(p), t, 5);
    assert.equal(at(1), -2);
    assert.equal(at(2), 1, 'the finite rise remains authored');
    assert.equal(at(3), 4);
    assert.equal(at(10.999), 4, 'zero PW holds V2 through the cycle');
    assert.equal(at(11), 4, 'the exact reset solve point exposes the left limit');
    assert.ok(Math.abs(at(11.001) - (-1.997)) < 1e-12,
      'the far side restarts the finite rise from V1');
    assert.equal(at(13), 4);

    assert.equal(nextSpicePulseCorner(p, 0), 1);
    assert.equal(nextSpicePulseCorner(p, 1), 3);
    assert.equal(nextSpicePulseCorner(p, 3), 11,
      'the nonexistent fall contributes no corner');
    assert.equal(nextSpicePulseCorner(p, 11), 13,
      'the next rise end follows the period restart');
  });

  it('completes the imported zero-PW current-source RC across two periods', () => {
    const board = zeroWidthCurrentBoard();
    const samples = [0.1, 2.5, 4.9, 5.1, 7.5, 9.9];
    const observed = [];
    for (const t of samples) {
      board.advanceTo(BigInt(Math.round(t * 1e9)));
      observed.push(board.nodeVoltage('out'));
    }
    assert.ok(observed[2] > 4.68, `the first held plateau reaches V2 (${observed[2]})`);
    assert.ok(observed[3] > 0.57 && observed[3] < 0.58,
      `the period restart returns to the next finite rise (${observed[3]})`);
    assert.ok(observed[5] > 4.68, `the second held plateau repeats (${observed[5]})`);
    const status = board.transientAnalysisStatus();
    assert.equal(status.accuracyMet, true);
    assert.equal(status.failure, null);
    assert.ok(status.work.attempts < 5000,
      `the unchanged precision budget should contain both periods (${status.work.attempts})`);
  });

  it('matches ngspice off-edge on the imported zero-PW current-source RC', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const samples = [0.1, 2.5, 4.9, 5.1, 7.5, 9.9];
    const measures = samples.map((t, index) =>
      `.meas tran out${index} FIND v(out) AT=${t}`).join('\n');
    const deck = `imported zero-width PULSE current-source RC
V1 N001 0 5
I1 N001 out PULSE(20u 200u 0 4 1 0 5)
R1 out 0 24k
R4 out 0 1Meg
C2 out 0 14p
.tran 0.01 10 0 0.01
${measures}
.end
`;
    const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const measured = new Map();
    for (const match of ng.stdout.matchAll(/^\s*out(\d+)\s*=\s*([-+0-9.e]+)/gmi)) {
      measured.set(Number(match[1]), Number(match[2]));
    }
    assert.equal(measured.size, samples.length,
      `ngspice returned ${measured.size}/${samples.length} requested samples`);

    const board = zeroWidthCurrentBoard();
    for (let index = 0; index < samples.length; index++) {
      board.advanceTo(BigInt(Math.round(samples[index] * 1e9)));
      assert.ok(Math.abs(board.nodeVoltage('out') - measured.get(index)) < 2e-4,
        `sample ${samples[index]}s: board ${board.nodeVoltage('out')} vs ngspice ${measured.get(index)}`);
    }
  });

  it('refuses absent, non-finite, ambiguous zero-edge, negative, and overlapping parameters', () => {
    const bad = [
      [{ per: undefined }, /per must be a finite authored number/],
      [{ v1: '{supply}' }, /v1 must be a finite authored number/],
      [{ v2: Number.NaN }, /v2 must be a finite authored number/],
      [{ td: -1 }, /td must be non-negative/],
      [{ tr: 0 }, /tr must be positive/],
      [{ tf: 0 }, /tf must be positive/],
      [{ pw: -1 }, /pw must be non-negative/],
      [{ per: 0 }, /per must be positive/],
      [{ tr: 4, pw: 4, tf: 3, per: 10 }, /must not exceed per/],
    ];
    for (const [change, message] of bad) {
      assert.throws(() => sourceVoltage(source(pulse(change)), 0, 5), message);
    }
  });

  it('does not alter the established native frequency/duty pulse', () => {
    const legacy = source({ wave: 'pulse', freq: 100, amplitude: 5, offset: 1, duty: 0.25 });
    assert.equal(sourceVoltage(legacy, 1e-3, 5), 6);
    assert.equal(sourceVoltage(legacy, 5e-3, 5), 1);
  });

  it('remains explicitly ineligible for a DC operating point', () => {
    const board = rcBoard(pulse({ v1: 0, v2: 5 }));
    assert.throws(() => board.operatingPoint(), /unsupported time-varying source V1 \(spice-pulse\)/);
  });

  it('drives an actual Board RC transient at its authored finite-edge waveform', () => {
    const p = pulse({ v1: 0, v2: -4, td: 0.4e-3, tr: 0.2e-3,
      tf: 0.35e-3, pw: 0.45e-3, per: 1.5e-3 });
    const board = rcBoard(p);
    const samples = [0.2e-3, 0.5e-3, 0.65e-3, 1e-3, 1.225e-3, 1.55e-3, 1.9e-3, 2e-3];
    const seen = [];
    for (const t of samples) {
      board.advanceTo(BigInt(Math.round(t * 1e9)));
      seen.push({ t, src: board.nodeVoltage('src'), out: board.nodeVoltage('out') });
    }
    for (const point of seen) {
      assert.ok(Math.abs(point.src - sourceVoltage(source(p), point.t, 5)) < 1e-8,
        `Board source at ${point.t}s follows the authored PULSE`);
    }
    assert.ok(seen[1].out < -0.5 && seen[1].out > -2,
      `the RC output responds during the finite rise, got ${seen[1].out}`);
    assert.ok(seen[4].out > -4 && seen[4].out < -1,
      `the RC output responds during the unequal finite fall, got ${seen[4].out}`);
    assert.ok(seen[7].out < seen[6].out,
      'the repeated-period rise drives the RC output negative again');
  });

  it('matches ngspice at source and RC nodes around finite corners', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    const p = pulse({ v1: 0, v2: -4, td: 0.4e-3, tr: 0.2e-3,
      tf: 0.35e-3, pw: 0.45e-3, per: 1.5e-3 });
    const samples = [0.2e-3, 0.5e-3, 0.65e-3, 1e-3, 1.225e-3, 1.55e-3, 1.9e-3, 2e-3];
    const measures = samples.flatMap((t, i) => [
      `.meas tran src${i} FIND v(src) AT=${t}`,
      `.meas tran out${i} FIND v(out) AT=${t}`,
    ]).join('\n');
    const deck = `self-authored exact PULSE RC oracle
V1 src 0 PULSE(0 -4 0.4m 0.2m 0.35m 0.45m 1.5m)
R1 src out 1k
C1 out 0 100n
.tran 1u 2.1m 0 0.2u
${measures}
.end
`;
    const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const measured = new Map();
    for (const match of ng.stdout.matchAll(/^\s*(src|out)(\d+)\s*=\s*([-+0-9.e]+)/gmi)) {
      measured.set(`${match[1].toLowerCase()}${match[2]}`, Number(match[3]));
    }
    assert.equal(measured.size, samples.length * 2,
      `ngspice returned ${measured.size}/${samples.length * 2} requested samples`);

    const board = rcBoard(p);
    for (let i = 0; i < samples.length; i++) {
      const t = samples[i];
      board.advanceTo(BigInt(Math.round(t * 1e9)));
      assert.ok(Math.abs(board.nodeVoltage('src') - measured.get(`src${i}`)) < 1e-7,
        `source sample ${i} matches ngspice`);
      assert.ok(Math.abs(board.nodeVoltage('out') - measured.get(`out${i}`)) < 2e-3,
        `RC sample ${i}: board ${board.nodeVoltage('out')} vs ngspice ${measured.get(`out${i}`)}`);
    }
  });
});
