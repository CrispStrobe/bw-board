/**
 * The LM386 pole resting on its swing clamp is integrated with backward
 * Euler (src/lm386.js, POLE INTEGRATION), as the LM358's is.
 *
 * On the clamp the pole is a 0.1 ns mode (G_CLAMP on cInt) that the
 * trapezoidal rule does not damp: after every switching edge of an LM386
 * relaxation oscillator the pole alternated about the clamp, the alternation
 * reached the output and the speaker coil, and the controller chased it at
 * 40-800 ns steps for tens of microseconds.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

/** LM386 Schmitt-style relaxation oscillator (1M/1M hysteresis, 220k/47nF
 * timing) into an 8 ohm speaker through 220 uF. */
function tone() {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U', kind: 'lm386', params: {}, terminals: ['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8'] },
    R('RA1', 1e6), R('RA2', 1e6), R('RT', 220e3),
    { id: 'CT', kind: 'capacitor', params: { farads: 47e-9 }, terminals: ['a', 'b'] },
    { id: 'CO', kind: 'polarized_cap', params: { farads: 220e-6 }, terminals: ['pos', 'neg'] },
    { id: 'SPK', kind: 'speaker', params: { ohms: 8 }, terminals: ['a', 'b'] },
  ], [
    net('vs', ['V', 'pos'], ['U', 'vs'], ['RA1', 'a']),
    net('p', ['RA1', 'b'], ['RA2', 'b'], ['U', 'inp']),
    net('n', ['RT', 'b'], ['CT', 'a'], ['U', 'inn']),
    net('g18', ['U', 'gain1'], ['U', 'gain8']),
    net('out', ['U', 'vout'], ['RA2', 'a'], ['RT', 'a'], ['CO', 'pos']),
    net('spk', ['CO', 'neg'], ['SPK', 'a']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['CT', 'b'], ['U', 'gnd'], ['SPK', 'b']),
  ]);
  b.setPower(true);
  return b;
}

describe('LM386: the pole on its clamp is damped', () => {
  it('publishes poleClamped while the output rests at a rail', () => {
    const b = tone();
    let seen = { true: 0, false: 0 };
    for (let k = 1; k <= 60; k++) { b.advanceTo(BigInt(k) * 100_000n); seen[b.getDeviceState('U').poleClamped.out]++; }
    assert.ok(seen.true > 20 && seen.false > 0, `clamped in ${seen.true}, free in ${seen.false} of 60 samples`);
  });

  it('an oscillating LM386 into a speaker takes few steps per edge', () => {
    const b = tone();
    b.advanceTo(5_000_000n);
    const before = b.transientAnalysisStatus().work.attempts;
    let edges = 0, prev = null;
    for (let k = 1; k <= 200; k++) {
      b.advanceTo(5_000_000n + BigInt(k) * 100_000n);
      const hi = b.nodeVoltage('out') > 4.5;
      if (prev !== null && hi !== prev) edges++;
      prev = hi;
    }
    assert.equal(b.transientAnalysisStatus().failure, null);
    const attempts = b.transientAnalysisStatus().work.attempts - before;
    assert.ok(edges >= 10, `${edges} edges in 20 ms`);
    // Measured: 301 attempts per edge with the trapezoidal pole on the
    // clamp, 199 with it damped (sampling every 100 us included).
    assert.ok(attempts / edges < 240, `${(attempts / edges).toFixed(0)} attempts per edge`);
  });
});
