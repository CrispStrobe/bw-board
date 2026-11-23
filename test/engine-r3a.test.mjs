// Round 3 (2026-11-23): the transient controller's Richardson error factor and
// the exponential default junction's reverse region.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

const VT = 0.02585;

// A series RLC driven by a 1 kHz sine from rest. Reference: RK4 at 10 ns.
function rlc() {
  const parts = [
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'V', kind: 'vsource', params: {wave: 'sine', freq: 1000, amplitude: 1, offset: 0}, terminals: ['pos', 'neg']},
    {id: 'R', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
    {id: 'L', kind: 'inductor', params: {henrys: 0.01}, terminals: ['a', 'b']},
    {id: 'C', kind: 'capacitor', params: {farads: 1e-6}, terminals: ['a', 'b']}];
  const nets = [
    {id: 's', terminals: [{part: 'V', terminal: 'pos'}, {part: 'R', terminal: 'a'}]},
    {id: 'm', terminals: [{part: 'R', terminal: 'b'}, {part: 'L', terminal: 'a'}]},
    {id: 'o', terminals: [{part: 'L', terminal: 'b'}, {part: 'C', terminal: 'a'}]},
    {id: 'g', terminals: [{part: 'G', terminal: 'gnd'}, {part: 'V', terminal: 'neg'}, {part: 'C', terminal: 'b'}]}];
  const b = new BoardImpl(5);
  b.setNetlist(parts, nets);
  return b;
}
function rlcReference(tEnd) {
  const R = 1000, L = 0.01, C = 1e-6, w = 2 * Math.PI * 1000, h = 1e-8;
  const f = (t, q, i) => [i, (Math.sin(w * t) - R * i - q / C) / L];
  let q = 0, i = 0, t = 0;
  for (let k = 0; k < Math.round(tEnd / h); k++) {
    const a = f(t, q, i), b = f(t + h / 2, q + h / 2 * a[0], i + h / 2 * a[1]);
    const c = f(t + h / 2, q + h / 2 * b[0], i + h / 2 * b[1]), d = f(t + h, q + h * c[0], i + h * c[1]);
    q += h / 6 * (a[0] + 2 * b[0] + 2 * c[0] + d[0]);
    i += h / 6 * (a[1] + 2 * b[1] + 2 * c[1] + d[1]);
    t += h;
  }
  return q / C;
}

test('step doubling scales its estimate by 1/(2^p - 1): fewer steps, error still at tolerance', () => {
  // The trapezoidal rule is order 2: the two half steps carry a third of the
  // full-step/half-step difference as their own error. Comparing the raw
  // difference held every step to a third of the tolerance; 1,268 attempts
  // for these 10 ms before, 914 after (3^(1/3) = 1.44x longer steps).
  const b = rlc();
  b.advanceTo(10_000_000n);
  const attempts = b._transientAnalysisWork.attempts;
  assert.ok(attempts < 1000, `${attempts} attempts for 10 ms (1,268 with the raw difference)`);
  // Interactive tolerance: 1e-4 relative on ~0.16 V. Accumulated over the
  // run the global error is 2.3e-5 V (1.0e-5 V before): of the order the
  // tolerance asks for, not hidden below it.
  const ref = rlcReference(0.01);
  const v = b.nodeVoltage('o');
  assert.ok(Math.abs(v - ref) < 5e-5, `v(o) ${v}, reference ${ref}`);
});

test('the exponential junction has no gap in reverse: 0.995 Is has a voltage', () => {
  // shockleyEval used to switch to a flat -Is below -5 nVt, dropping the
  // e^-5 = 0.67 % of Is the exponential still carries there: no voltage gave
  // a reverse current between 0.9933 Is and Is, so a diode turning off on an
  // inductor (which forces its current through that range) had no Newton
  // solution at any step size.
  const nVt = 1.752 * VT;
  const is = 0.020 / (Math.exp((0.7 - 0.020 * 0.568) / nVt) - 1);
  const b = new BoardImpl(5);
  b.setNetlist([
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'I', kind: 'isource', params: {amps: -0.995 * is}, terminals: ['pos', 'neg']},
    {id: 'D', kind: 'diode', params: {}, terminals: ['anode', 'cathode']},
  ], [
    {id: 'a', terminals: [{part: 'I', terminal: 'pos'}, {part: 'D', terminal: 'anode'}]},
    {id: 'g', terminals: [{part: 'G', terminal: 'gnd'}, {part: 'I', terminal: 'neg'}, {part: 'D', terminal: 'cathode'}]},
  ]);
  const v = b.nodeVoltage('a');
  const want = nVt * Math.log(1 - 0.995);
  assert.ok(Math.abs(v - want) < 2e-3, `V(anode) ${v}, exponential says ${want}`);
});
