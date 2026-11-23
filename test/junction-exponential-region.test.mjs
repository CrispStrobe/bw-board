// The default diode/LED is the piecewise knee: almost no exponential region
// (a few millivolts per decade of current, by construction). The exponential
// junction is one parameter away -- `params.model: 'shockley'` -- with the
// per-part saturation current and emission coefficient from the class card
// (src/parts-library.js) and the LED's knee calibrated to its datasheet
// `vf` at 20 mA. These tests pin both halves of that, so the choice is a
// documented parameter rather than folklore.
//
// Why the default is not flipped: measured 2026-11-23 against the gallery
// gates, making every diode/LED exponential moves ten asserted values beyond
// their tolerances (38-npn-switch, 41-pot-as-dimmer, pc07-pot-dimmer,
// pc49-diode-clamp, pc55-ntc-indicator, pc60-night-lamp-hardware): those
// circuits run their LEDs at fractions of a milliamp, exactly where the two
// models differ. That is a gallery re-measurement, not an engine fix.
import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

const VT = 0.02585;

function forwardDrop(kind, params, amps) {
  // A current source into the junction: V(anode) at that current.
  const b = new BoardImpl(5);
  b.setNetlist([
    {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
    {id: 'I', kind: 'isource', params: {amps}, terminals: ['pos', 'neg']},
    {id: 'D', kind, params, terminals: ['anode', 'cathode']},
  ], [
    {id: 'a', terminals: [{part: 'I', terminal: 'pos'}, {part: 'D', terminal: 'anode'}]},
    {id: 'g', terminals: [{part: 'G', terminal: 'gnd'}, {part: 'I', terminal: 'neg'}, {part: 'D', terminal: 'cathode'}]},
  ]);
  return b.nodeVoltage('a');
}

for (const [kind, n] of [['diode', 1.752], ['led', 1.8]]) {
  test(`explicit ${kind} exponential: n*Vt*ln(10) per decade below the bulk-resistance region`, () => {
    const v1 = forwardDrop(kind, {model: 'shockley'}, 1e-6);
    const v2 = forwardDrop(kind, {model: 'shockley'}, 1e-5);
    const perDecade = v2 - v1;
    // rs * 9 uA is at most 90 uV, far inside the tolerance.
    assert.ok(Math.abs(perDecade - n * VT * Math.LN10) < 1e-3,
      `${kind}: ${(perDecade * 1e3).toFixed(2)} mV/decade, want ${(n * VT * Math.LN10 * 1e3).toFixed(2)}`);
  });
  test(`default ${kind} is the piecewise knee: almost no exponential region`, () => {
    const perDecade = forwardDrop(kind, {}, 1e-5) - forwardDrop(kind, {}, 1e-6);
    assert.ok(perDecade < 0.01, `default ${kind} moved ${perDecade} V per decade`);
  });
}

test('the exponential LED keeps its datasheet knee at the rated 20 mA', () => {
  const v = forwardDrop('led', {model: 'shockley', vf: 2.0}, 0.020);
  assert.ok(Math.abs(v - 2.0) < 1e-3, `LED at 20 mA reads ${v} V`);
});
