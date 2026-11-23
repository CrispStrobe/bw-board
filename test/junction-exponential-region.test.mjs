// The default diode/LED is the exponential (Shockley) junction since round 3
// (user ruling 2026-11-23), with the per-part saturation current and emission
// coefficient from the class card (src/parts-library.js) and the LED's knee
// calibrated to its datasheet `vf` at 20 mA. The piecewise knee -- almost no
// exponential region, a few millivolts per decade of current by construction
// -- is one parameter away: `params.model: 'pwl'`. These tests pin both
// halves of that, so the choice is a documented parameter rather than folklore.
//
// The flip moves ten asserted gallery values (38-npn-switch, 41-pot-as-dimmer,
// pc07-pot-dimmer, pc49-diode-clamp, pc55-ntc-indicator,
// pc60-night-lamp-hardware): those circuits run their LEDs at fractions of a
// milliamp, exactly where the two models differ, and the exponential is the
// physically right one there. The moves are listed for the gallery's
// re-measurement (kosmos-cleanroom/R3A-GALLERY-MOVES.md).
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
  test(`default ${kind} is the exponential: the same n*Vt*ln(10) per decade`, () => {
    const perDecade = forwardDrop(kind, {}, 1e-5) - forwardDrop(kind, {}, 1e-6);
    assert.ok(Math.abs(perDecade - n * VT * Math.LN10) < 1e-3,
      `default ${kind}: ${(perDecade * 1e3).toFixed(2)} mV/decade, want ${(n * VT * Math.LN10 * 1e3).toFixed(2)}`);
    assert.equal(forwardDrop(kind, {}, 1e-5), forwardDrop(kind, {model: 'shockley'}, 1e-5),
      `default ${kind} and explicit shockley must be the same device`);
  });
  test(`explicit pwl ${kind} is the piecewise knee: almost no exponential region`, () => {
    const perDecade = forwardDrop(kind, {model: 'pwl'}, 1e-5) - forwardDrop(kind, {model: 'pwl'}, 1e-6);
    assert.ok(perDecade < 0.01, `pwl ${kind} moved ${perDecade} V per decade`);
  });
}

test('the exponential LED keeps its datasheet knee at the rated 20 mA', () => {
  const v = forwardDrop('led', {model: 'shockley', vf: 2.0}, 0.020);
  assert.ok(Math.abs(v - 2.0) < 1e-3, `LED at 20 mA reads ${v} V`);
});

test('the default LED keeps its per-colour vf at the rated 20 mA', () => {
  // Round 1's per-colour vf is the rated-current anchor of the exponential.
  for (const [color, vf] of [['red', 1.9], ['green', 2.2], ['blue', 3.1], ['ir', 1.3]]) {
    const v = forwardDrop('led', {color}, 0.020);
    assert.ok(Math.abs(v - vf) < 1e-3, `${color} LED at 20 mA reads ${v} V, rated ${vf} V`);
  }
});

test('a carded diode takes its own is and n from the parts library', () => {
  // 1N4148: is 2.52e-9, n 1.752, rs 0.568 (parts-library.js). At 1 mA the
  // junction alone is n*Vt*ln(I/Is + 1); the card's rs adds I*rs.
  const i = 1e-3;
  const want = 1.752 * VT * Math.log(i / 2.52e-9 + 1) + i * 0.568;
  const v = forwardDrop('diode', {part: '1N4148'}, i);
  assert.ok(Math.abs(v - want) < 1e-4, `1N4148 at 1 mA reads ${v} V, card says ${want} V`);
});
