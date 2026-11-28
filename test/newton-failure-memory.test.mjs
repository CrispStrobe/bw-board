/**
 * A step size Newton could not converge from here is not tried again until
 * the time that step spanned has passed.
 *
 * Approaching a regenerative edge (a transistor astable near 100 kHz, an
 * LM386 relaxation oscillator) the largest step Newton can converge shrinks
 * with every accepted step. The controller halved a failed step, accepted
 * the half, then grew it straight back past the size that had just failed:
 * two failed solves (50 Newton iterations each, against ~3 for an accepted
 * one) for every accepted step of the approach -- a third of all Newton
 * iterations of a 60 kHz astable went into failed trials.
 *
 * The memory ends at a discontinuity (a reset, a switch, a device flip, a
 * backward-Euler restart): test/reset-transient-controller.test.mjs's motor
 * bench, whose winding edge strands the trapezoidal rule at the step floor
 * unless the restart there may grow its step again.
 *
 * (A predicted Newton start -- extrapolating the last two accepted junction
 * states -- was tried with this and withdrawn: the full step and the half
 * steps then start from different points, and at small steps the Newton
 * residual that leaves in the Richardson error estimate drove the motor bench
 * to the step floor and moved a VHF FM superhet's 2 kHz product 3 mV -> 23 mV.
 * Newton starts from the last accepted state, as before.)
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const C = (id, farads) => ({ id, kind: 'capacitor', params: { farads }, terminals: ['a', 'b'] });
const Q = (id) => ({ id, kind: 'npn', params: {}, terminals: ['base', 'collector', 'emitter'] });

/** Two-transistor astable, 1 nF / 6.8 k from a 4 V base supply: ~60 kHz. */
function astable() {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'VB', kind: 'vsource', params: { volts: 4 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    R('RC1', 1000), R('RC2', 470), { id: 'LED', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
    Q('Q1'), Q('Q2'), C('CA', 1e-9), C('CB', 1e-9), R('RBA', 6800), R('RBB', 6800),
  ], [
    net('vcc', ['V', 'pos'], ['RC1', 'a'], ['RC2', 'a']),
    net('vb', ['VB', 'pos'], ['RBA', 'a'], ['RBB', 'a']),
    net('c1', ['RC1', 'b'], ['Q1', 'collector'], ['CA', 'a']),
    net('b2', ['CA', 'b'], ['Q2', 'base'], ['RBA', 'b']),
    net('la', ['RC2', 'b'], ['LED', 'anode']),
    net('c2', ['LED', 'cathode'], ['Q2', 'collector'], ['CB', 'a']),
    net('b1', ['CB', 'b'], ['Q1', 'base'], ['RBB', 'b']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['VB', 'neg'], ['Q1', 'emitter'], ['Q2', 'emitter']),
  ]);
  b.setPower(true);
  return b;
}

describe('Newton-failure memory in the step controller', () => {
  it('a 60 kHz astable spends far fewer failed Newton trials per edge', () => {
    const b = astable();
    b.advanceTo(50_000n);
    const f0 = b._transientTrialFailures;
    let edges = 0;
    let prev = b.nodeVoltage('c1') > 4.5;
    for (let t = 50_000n; t < 250_000n; t += 2000n) {
      b.advanceTo(t + 2000n);
      const hi = b.nodeVoltage('c1') > 4.5;
      if (hi !== prev) edges++;
      prev = hi;
    }
    assert.equal(b.transientAnalysisStatus().failure, null);
    // MEASURED 2026-11-26: 24 edges in 0.2 ms either way; 20.4 failed trials
    // per edge before (every halved step grown back past the failed size),
    // 14.1 after. 2026-11-28, with the memory ending at discontinuities and
    // no predicted start: 14.5.
    assert.ok(edges >= 22 && edges <= 26, `edges in 0.2 ms: ${edges}`);
    const perEdge = (b._transientTrialFailures - f0) / edges;
    assert.ok(perEdge < 17, `failed Newton trials per edge: ${perEdge.toFixed(1)}`);
  });
});
