/**
 * Hand oracles for spec-updates/ac-operating-region.md.
 *
 * The AC op-amp row used to stamp `V(out) − rout·i − gain·(v⁺ − v⁻) = 0`
 * unconditionally, so a stage welded to a rail or pinned at its 40 mA
 * short-circuit current reported its full ideal small-signal gain at every
 * frequency. `src/ac.js` opens by saying an AC answer computed from a
 * different model than the operating point is a plausible wrong Bode plot;
 * this is that bug, in that file.
 *
 * The bench for the rail cases is deliberately OPEN LOOP so the gain is
 * readable directly and no feedback can hide the region.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

/**
 * Open-loop opamp: inn on ground, inp driven by the swept source through
 * nothing, out loaded by `rLoad` to ground.
 */
function openLoop({ gain = 10, railHigh = 3, railLow = -3, volts, rLoad = 1000,
  rout, iShort } = {}) {
  const params = { gain, railHigh, railLow };
  if (rout !== undefined) params.rout = rout;
  if (iShort !== undefined) params.iShort = iShort;
  const parts = [
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'U1', kind: 'opamp', params, terminals: ['inp', 'inn', 'out'] },
    { id: 'RL', kind: 'resistor', params: { ohms: rLoad }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'n_gnd', terminals: [
      { part: 'GND', terminal: 'gnd' }, { part: 'V1', terminal: 'neg' },
      { part: 'U1', terminal: 'inn' }, { part: 'RL', terminal: 'b' }] },
    { id: 'n_in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
    { id: 'n_out', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'RL', terminal: 'a' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  return b;
}

const sweep = (b) => b.runAc({ sourceId: 'V1', from: 10, to: 1000, pointsPerDecade: 2 });
const magAt = (pts, net) => pts.map(p => p.results.get(net).mag);

describe('AC honours the operating region it linearises about', () => {
  it('LINEAR is untouched: |H| = 10.000 at every frequency, and nothing is reported', () => {
    // gain·vin = 10 × 0.1 = 1.0 V, inside ±3 → region `linear`.
    const pts = sweep(openLoop({ volts: 0.1 }));
    for (const m of magAt(pts, 'n_out')) {
      assert.ok(Math.abs(m - 10) < 1e-6, `open-loop gain is 10, got ${m}`);
    }
    assert.equal(pts[0].outOfLinear, undefined,
      'a linear bench carries no outOfLinear key at all');
  });

  it('THE DEFECT: a railed stage reported ideal gain; it now reports 0 and says why', () => {
    // gain·vin = 10 × 1.0 = 10 V, past railHigh = 3 → region `high`,
    // V(out) = 3 V at DC. Before this change every point read |H| = 10.
    const b = openLoop({ volts: 1.0 });
    assert.ok(Math.abs(b.nodeVoltage('n_out') - 3) < 1e-6,
      `the DC bias is at the rail: ${b.nodeVoltage('n_out')}`);
    const pts = sweep(b);
    for (const m of magAt(pts, 'n_out')) {
      assert.ok(m < 1e-9, `a stage clamped to a rail cannot move: |H| = ${m}`);
    }
    assert.deepEqual(pts[0].outOfLinear, [{ part: 'U1', kind: 'opamp', region: 'high' }]);
    assert.ok(pts.every(p => p.outOfLinear?.[0].region === 'high'),
      'every point carries it — the operating point is a property of the sweep');
  });

  it('the low rail is the same story', () => {
    const b = openLoop({ volts: -1.0 });
    assert.ok(Math.abs(b.nodeVoltage('n_out') + 3) < 1e-6, 'biased at the low rail');
    const pts = sweep(b);
    assert.ok(magAt(pts, 'n_out').every(m => m < 1e-9), 'dead at the low rail too');
    assert.equal(pts[0].outOfLinear[0].region, 'low');
  });

  it('rout does not rescue a railed stage: V = rout·i and i = V/900 give V = 0', () => {
    // The row is V(out) − rout·i = 0 with the load giving i = V/900, so
    // V = 100·V/900 ⇒ V·(1 − 1/9) = 0 ⇒ V = 0. A railed output is dead
    // whatever its output resistance — the two mechanisms compose.
    const pts = sweep(openLoop({ volts: 1.0, rout: 100, rLoad: 900 }));
    assert.ok(magAt(pts, 'n_out').every(m => m < 1e-9),
      'railed with a finite rout is still railed');
  });

  it('CURRENT LIMIT: D20’s own follower oracle is small-signal dead', () => {
    // spec-updates/opamp-output-limit.md acceptance 1: unity-gain follower,
    // 2.5 V in, 1 Ω load, iShort at its 40 mA default → V(out) = 0.040 V,
    // region ilim-. The AC row becomes i = 0, the node's only other path is
    // the 1 Ω to AC ground, so |H| = 0.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'V1', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
      { id: 'U1', kind: 'opamp', params: { gain: 1e6, railLow: -12, railHigh: 12 },
        terminals: ['inp', 'inn', 'out'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'n_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' }, { part: 'V1', terminal: 'neg' },
        { part: 'RL', terminal: 'b' }] },
      { id: 'n_in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'U1', terminal: 'inp' }] },
      // Follower: inn tied to out.
      { id: 'n_out', terminals: [
        { part: 'U1', terminal: 'out' }, { part: 'U1', terminal: 'inn' },
        { part: 'RL', terminal: 'a' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    assert.ok(Math.abs(b.nodeVoltage('n_out') - 0.040) < 1e-5,
      `D20's oracle: 40 mA into 1 ohm = 0.040 V, got ${b.nodeVoltage('n_out')}`);
    const pts = b.runAc({ sourceId: 'V1', from: 10, to: 1000, pointsPerDecade: 2 });
    for (const p of pts) {
      assert.ok(p.results.get('n_out').mag < 1e-9,
        `a follower in current limit cannot follow: |H| = ${p.results.get('n_out').mag}`);
      assert.equal(p.outOfLinear[0].region, 'ilim-');
    }
  });

  it('the limit row pins the CURRENT, not the voltage — the two are distinguishable', () => {
    // The same limited follower, with the output ALSO tied to the swept node
    // through 1 kΩ. With i = 0 the output is a plain 1 kΩ/1 Ω divider off the
    // source: |H| = 1/1001 = 9.990e-4. A `V(out) = 0` shortcut passes the
    // previous case and fails this one — which is the whole reason the rail
    // row and the limit row are written separately.
    const parts = [
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'V1', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
      { id: 'U1', kind: 'opamp', params: { gain: 1e6, railLow: -12, railHigh: 12 },
        terminals: ['inp', 'inn', 'out'] },
      { id: 'RL', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
      { id: 'RF', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'n_gnd', terminals: [
        { part: 'GND', terminal: 'gnd' }, { part: 'V1', terminal: 'neg' },
        { part: 'RL', terminal: 'b' }] },
      { id: 'n_in', terminals: [
        { part: 'V1', terminal: 'pos' }, { part: 'U1', terminal: 'inp' },
        { part: 'RF', terminal: 'a' }] },
      { id: 'n_out', terminals: [
        { part: 'U1', terminal: 'out' }, { part: 'U1', terminal: 'inn' },
        { part: 'RL', terminal: 'a' }, { part: 'RF', terminal: 'b' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    const pts = b.runAc({ sourceId: 'V1', from: 10, to: 100, pointsPerDecade: 1 });
    const region = pts[0].outOfLinear?.[0]?.region;
    assert.ok(region === 'ilim-' || region === 'ilim+',
      `the stage is current-limited at this bias, got ${region}`);
    const expected = 1 / 1001;
    for (const p of pts) {
      const m = p.results.get('n_out').mag;
      assert.ok(Math.abs(m - expected) < 1e-9,
        `i = 0 leaves a 1k/1R divider: ${expected.toExponential(4)}, got ${m.toExponential(4)}`);
      assert.ok(m > 1e-6, 'and it is NOT the zero a voltage-pinning row would give');
    }
  });

  it('solveMNA publishing opampRegions moves no solved value', () => {
    // The mna.js half is a pure addition to the return object. Same bench,
    // same numbers, plus a key.
    const b = openLoop({ volts: 0.1 });
    assert.ok(Math.abs(b.nodeVoltage('n_out') - 1.0) < 1e-6,
      'gain 10 × 0.1 V = 1.000 V, unchanged');
  });
});
