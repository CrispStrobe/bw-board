import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const ground = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };

function rcBoard(params, r = 1000, c = 1e-9, profile = null) {
  const board = new BoardImpl(5);
  if (profile) board.configureTransientAnalysis(profile);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: r }, terminals: ['a', 'b'] },
    { id: 'C1', kind: 'capacitor', params: { farads: c }, terminals: ['a', 'b'] },
    ground,
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'out', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }] },
    { id: '0', terminals: [{ part: 'V1', terminal: 'neg' },
      { part: 'C1', terminal: 'b' }, { part: 'GND', terminal: 'gnd' }] },
  ]);
  board.initializeTransientFromOperatingPoint();
  return board;
}

// Exact convolution of a piecewise-linear source with a first-order RC.
function linearRc(v0, u0, slope, dt, tau) {
  return u0 + slope * (dt - tau) + (v0 - u0 + slope * tau) * Math.exp(-dt / tau);
}

function row158Exact(t) {
  const tau = 1e-6;
  if (t <= 1e-6) return 0;
  let v = linearRc(0, 0, 5 / 1e-9, Math.min(t - 1e-6, 1e-9), tau);
  if (t <= 1.001e-6) return v;
  return linearRc(v, 5, 0, t - 1.001e-6, tau);
}

function sineRcExact(t, amplitude, frequency, tau) {
  const omega = 2 * Math.PI * frequency;
  const magnitude = amplitude / Math.sqrt(1 + (omega * tau) ** 2);
  const lag = Math.atan(omega * tau);
  const particular = at => magnitude * Math.sin(omega * at - lag);
  return particular(t) - particular(0) * Math.exp(-t / tau);
}

describe('bounded transient numerical-analysis profile', () => {
  it('is explicit, fixed, copy-safe, and selectable only on a fresh board', () => {
    const board = new BoardImpl(5);
    assert.equal(board.transientAnalysisStatus().profile.id, 'interactive-v1');
    assert.equal(board.transientAnalysisStatus().accuracyMet, null,
      'an untouched board has no measured accuracy result');
    const selected = board.configureTransientAnalysis('precision-v1');
    assert.deepEqual(selected, {
      id: 'precision-v1', relativeTolerance: 1e-7,
      absoluteVoltage: 1e-9, absoluteCurrent: 1e-12,
      minStepSec: 1e-11, seedStepSec: 1e-11,
      maxStepSec: 1e-5, maxAttempts: 20000,
    });
    assert.equal(Object.isFrozen(selected), true);
    assert.throws(() => board.configureTransientAnalysis('anything-else'), /unsupported profile/);
    board.advanceTo(1n);
    assert.throws(() => board.configureTransientAnalysis('precision-v1'), /fresh board/);
  });

  it('resolves a 1 ns authored PULSE edge in a 1 us RC without changing its t=0 bias', () => {
    const params = { wave: 'spice-pulse', v1: 0, v2: 5,
      td: 1e-6, tr: 1e-9, tf: 1e-9, pw: 19e-6, per: 20e-6 };
    const board = rcBoard(params, 1000, 1e-9, 'precision-v1');
    const interactive = rcBoard(params, 1000, 1e-9);
    for (let ns = 200; ns <= 2200; ns += 200) {
      board.advanceTo(BigInt(ns)); interactive.advanceTo(BigInt(ns));
    }
    const expected = row158Exact(2.2e-6);
    const tolerance = 1e-6 + 1e-6 * Math.abs(expected);
    const precisionError = Math.abs(board.nodeVoltage('out') - expected);
    const interactiveError = Math.abs(interactive.nodeVoltage('out') - expected);
    assert.ok(precisionError <= tolerance,
      `precision result ${board.nodeVoltage('out')} vs closed-form ${expected}`);
    assert.ok(interactiveError > 1e-4 && interactiveError < 5e-4,
      `interactive-v1 remains the shipped speed/accuracy tradeoff (${interactiveError} V)`);
    assert.ok(precisionError < interactiveError / 20,
      `precision-v1 must materially improve integration error (${precisionError} vs ${interactiveError} V)`);
    assert.deepEqual(board.transientAnalysisStatus().failure, null);
    assert.equal(board.transientAnalysisStatus().accuracyMet, true);
  });

  it('controls smooth 500 kHz sine integration independently of the observation cadence', () => {
    const params = { wave: 'spice-sine', offset: 0, amplitude: 5, freq: 500e3,
      td: 0, theta: 0, phase: 0 };
    const r = 3506; const c = 9.08e-9;
    const board = rcBoard(params, r, c, 'precision-v1');
    for (let ns = 300; ns <= 10500; ns += 300) board.advanceTo(BigInt(ns));
    const expected = sineRcExact(10.5e-6, 5, 500e3, r * c);
    assert.ok(Math.abs(board.nodeVoltage('out') - expected) < 1e-6,
      `precision result ${board.nodeVoltage('out')} vs closed-form ${expected}`);
    assert.equal(board.transientAnalysisStatus().accuracyMet, true);
  });

  it('marks a source corner at an advance endpoint as a restart boundary', () => {
    const board = rcBoard({ wave: 'spice-pulse', v1: 0, v2: 1,
      td: 1e-6, tr: 10e-9, tf: 10e-9, pw: 1e-6, per: 3e-6 });
    board.advanceTo(500n);
    assert.equal(board._trapValid, true);
    board.advanceTo(1000n);
    assert.equal(board._trapValid, false,
      'a corner exactly at the requested endpoint must restart history on its far side');
  });

  it('chooses barrier semantics from the nearest final endpoint, not a later candidate', () => {
    const board = new BoardImpl(5);
    board._nextSourceEdgeSec = () => 2e-6;
    board._nextDeviceWakeSec = () => null;
    board._nextSampleGridSec = () => 1e-6;
    assert.deepEqual(board._transientStepBarrier(0, 3e-6),
      { atSec: 1e-6, discontinuity: false },
    'an earlier observation grid does not inherit the later source restart');

    board._nextDeviceWakeSec = () => 0.5e-6;
    assert.deepEqual(board._transientStepBarrier(0, 3e-6),
      { atSec: 0.5e-6, discontinuity: true },
    'an earlier device wake remains a discontinuity');

    board._nextDeviceWakeSec = () => 1e-6;
    assert.deepEqual(board._transientStepBarrier(0, 3e-6),
      { atSec: 1e-6, discontinuity: true },
      'a wake coincident with an observation grid restarts history');
  });

  it('records a non-converged accepted seed as an explicit sticky analysis failure', () => {
    const board = new BoardImpl(5);
    board.configureTransientAnalysis('precision-v1');
    board.setNetlist([
      { id: 'V1', kind: 'vsource', params: { wave: 'spice-sine', offset: 0,
        amplitude: 1, freq: 1e6, td: 0, theta: 0, phase: 0 }, terminals: ['pos', 'neg'] },
      { id: 'V2', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
      ground,
    ], [
      { id: 'conflict', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'V2', terminal: 'pos' }] },
      { id: '0', terminals: [{ part: 'V1', terminal: 'neg' },
        { part: 'V2', terminal: 'neg' }, { part: 'GND', terminal: 'gnd' }] },
    ]);
    board.advanceTo(100n);
    const status = board.transientAnalysisStatus();
    assert.equal(status.accuracyMet, false);
    assert.equal(status.failure.code, 'transient-solve-not-converged');
    assert.equal(status.failure.stage, 'be');
    assert.ok(status.work.solves > 0 && status.work.attempts > 0);
    board.advanceTo(200n);
    assert.deepEqual(board.transientAnalysisStatus().failure, status.failure,
      'the first numerical qualification failure remains sticky');
  });
});
