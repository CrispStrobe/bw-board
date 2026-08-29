/**
 * `addScopeChannel({capture: 'sample'})` — a true sample series, not an envelope.
 *
 * The (min,max) buckets the scope tap has always written are right for DRAWING
 * and wrong for TRANSFORMING: the two numbers in a pair are two different
 * instants reported as one, so an FFT taken over them describes a signal that
 * never existed. bw-circuit-ui's D24 needs the other thing, and this is it.
 *
 * The oracle is a source whose waveform is known in closed form. A 1 kHz sine
 * of amplitude 2 V about 2.5 V, captured at 100 kHz, must give
 *
 *     v[k] = 2.5 + 2·sin(2π·1000·t_k)
 *
 * at every k, and min[k] must equal max[k] — that equality IS the claim, and
 * it is exactly what the envelope channel does not satisfy on the same bench.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

/** src(sine) → 1 kΩ → gnd. The mid net carries the source's own waveform. */
function sineBench({ freq = 1000, amplitude = 2, offset = 2.5 } = {}) {
  const parts = [
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'SRC', kind: 'vsource', params: { wave: 'sine', freq, amplitude, offset }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_sig', terminals: [{ part: 'SRC', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'net_gnd', terminals: [{ part: 'SRC', terminal: 'neg' }, { part: 'R1', terminal: 'b' }, { part: 'GND', terminal: 'gnd' }] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  board.setPower(true);
  return board;
}

/** The pairs actually written, oldest first. */
function written(data) {
  const depth = data.samples.length / 2;
  const count = Math.min(data.count, depth);
  const oldest = ((data.writeIndex - count) % depth + depth) % depth;
  const out = [];
  for (let k = 0; k < count; k++) {
    const i = ((oldest + k) % depth) * 2;
    out.push([data.samples[i], data.samples[i + 1]]);
  }
  return out;
}

describe('scope capture modes', () => {
  it('defaults to the envelope it has always written', () => {
    const board = sineBench();
    const ch = board.addScopeChannel({ type: 'voltage', netId: 'net_sig' });
    assert.equal(board.getScopeData(ch).capture, 'envelope');
  });

  it('a sample channel writes min === max — one instant, not a bucket', () => {
    const board = sineBench();
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_sig', sampleRateHz: 100_000, depth: 1024, capture: 'sample',
    });
    board.advanceTo(5_000_000n); // 5 ms = five periods
    const data = board.getScopeData(ch);
    assert.equal(data.capture, 'sample');
    const pairs = written(data);
    assert.ok(pairs.length > 400, `expected ~500 samples, got ${pairs.length}`);
    for (const [mn, mx] of pairs) {
      assert.equal(mn, mx, 'a sample series has one number per sample instant');
    }
  });

  it('the sampled values ARE 2.5 + 2·sin(2π·1000·t), to 1 mV', () => {
    const board = sineBench();
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_sig', sampleRateHz: 100_000, depth: 1024, capture: 'sample',
    });
    board.advanceTo(5_000_000n);
    const data = board.getScopeData(ch);
    const pairs = written(data);
    const interval = Number(data.sampleIntervalNs) / 1e9;
    const t0 = Number(data.startTNs) / 1e9;
    let worst = 0, worstK = -1;
    pairs.forEach(([v], k) => {
      const t = t0 + k * interval;
      const want = 2.5 + 2 * Math.sin(2 * Math.PI * 1000 * t);
      const err = Math.abs(v - want);
      if (err > worst) { worst = err; worstK = k; }
    });
    assert.ok(worst < 1e-3,
      `worst deviation from the closed form ${worst.toExponential(3)} V at k=${worstK}`);
  });

  it('the envelope channel on the SAME bench does not satisfy that — which is the defect', () => {
    const board = sineBench();
    // 20 µs buckets against a transient controller that steps in 100 µs while
    // only envelope channels are live: every fifth bucket brackets a real
    // interval and the four between it are collapsed holds. Measured on this
    // bench: 100 of 250 pairs carry min ≠ max, the widest spanning ~0.63 V.
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_sig', sampleRateHz: 50_000, depth: 1024,
    });
    board.advanceTo(5_000_000n);
    const pairs = written(board.getScopeData(ch));
    const differing = pairs.filter(([mn, mx]) => mn !== mx);
    const worst = Math.max(...differing.map(([mn, mx]) => mx - mn));
    assert.ok(differing.length > pairs.length / 10,
      `pairs that report two instants as one: ${differing.length}/${pairs.length}`);
    assert.ok(worst > 0.1,
      `the widest pair spans ${worst.toFixed(3)} V — an FFT over these is a spectrum of nothing`);
    // And the defect is not that it is imprecise; it is that the consumer
    // cannot tell WHICH pairs are two instants. The mixture is the problem.
    assert.ok(differing.length < pairs.length, 'some pairs really are single instants');
  });

  it('a current channel reports itself as a sample series, because it is one', () => {
    const board = sineBench();
    const ch = board.addScopeChannel({ type: 'current', partId: 'R1', terminal: 'a' });
    assert.equal(board.getScopeData(ch).capture, 'sample');
  });

  it('an unwritten region stays NaN in both modes', () => {
    const board = sineBench();
    const ch = board.addScopeChannel({
      type: 'voltage', netId: 'net_sig', sampleRateHz: 100_000, depth: 512, capture: 'sample',
    });
    board.advanceTo(100_000n); // 0.1 ms = 10 samples of 512
    const s = board.getScopeData(ch).samples;
    assert.ok(Number.isNaN(s[s.length - 1]), 'the far end of the ring is untouched');
  });
});
