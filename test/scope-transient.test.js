// The scope must capture INSIDE transient sub-steps: a 1 kHz sine advanced
// in 50 ms chunks is an integer number of periods per chunk — boundary-only
// sampling aliases it to a flat line. The regression the UI gate caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

test('a waveform source advanced in big chunks still draws its envelope', () => {
  const b = new BoardImpl();
  b.setNetlist(
    [{ id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'FG', kind: 'vsource', params: { wave: 'sine', freq: 1000, amplitude: 2, offset: 2.5 }, terminals: ['pos', 'neg'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
    [
      { id: 'sig', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'RL', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'FG', terminal: 'neg' }, { part: 'RL', terminal: 'b' }] },
    ]);
  const ch = b.addScopeChannel({ type: 'voltage', netId: 'sig', sampleRateHz: 20000 });
  // Four 50 ms chunks — each an integer number of 1 kHz periods.
  for (let i = 1; i <= 4; i++) b.advanceTo(BigInt(i) * 50_000_000n);
  const d = b.getScopeData(ch);
  let mn = Infinity, mx = -Infinity, count = 0;
  for (let i = 0; i < d.samples.length; i += 2) {
    if (Number.isNaN(d.samples[i])) continue;
    mn = Math.min(mn, d.samples[i]);
    mx = Math.max(mx, d.samples[i + 1]);
    count++;
  }
  assert.ok(count > 100, `captured ${count} sample pairs`);
  // Sine 2.5 ± 2: the envelope must span most of 0.5..4.5 V.
  assert.ok(mx > 4.0, `max ${mx} — envelope top`);
  assert.ok(mn < 1.0, `min ${mn} — envelope bottom`);
});
