/**
 * WHICH PRIMITIVES AGREE WITH A RESISTOR ABOUT THE SIGN OF A SHARED WIRE.
 *
 * `branchCurrent()` IS NOT ONE CONVENTION. The extraction in `solveMNA` is
 * split per device kind — some terminals report current OUT of the part into
 * the net, others report current INTO the part — and the consequence is that
 * **net-level Kirchhoff fails through this API wherever the two meet.**
 *
 * Measured, one resistor in series with each primitive between a 5 V rail and
 * ground, summing the two terminal readings on the net they share:
 *
 *   resistor   R1.b  2.5000e-3   DUT.a       -2.5000e-3   sum 2.5e-9 mA   ok
 *   capacitor        5.0000e-3               -5.0000e-3       0.0e+0      ok
 *   inductor         5.0000e-3               -5.0000e-3       4.3e-15     ok
 *   buzzer           4.5455e-3               -4.5455e-3       4.5e-10     ok
 *   ldr              4.9950e-6               -4.9950e-6       5.0e-9      ok
 *   ntc              4.9505e-5               -4.9505e-5       5.0e-9      ok
 *   isource         -1.0000e-3                1.0000e-3       6.0e-9      ok
 *   diode      R1.b  4.3075e-3   DUT.anode    4.3075e-3   sum 8.615 mA    VIOLATED
 *   led              3.1683e-3                3.1683e-3       6.337 mA    VIOLATED
 *   zener            1.6915e-3                1.6915e-3       3.383 mA    VIOLATED
 *   vsource          3.0000e-3                3.0000e-3       6.000 mA    VIOLATED
 *
 * Off by exactly twice the branch current in each failing case — the two ends
 * of one wire reported with the same sign. **A diode or an LED in series with a
 * resistor is the commonest circuit in the gallery corpus**, so this is a live
 * defect on the most ordinary topology there is, not an edge case.
 *
 * `test/mna-current-conservation.test.js` is titled "KCL must hold at every
 * node" and its fixtures are almost entirely resistors — a claim broader than
 * its check, which is why this went unnoticed.
 *
 * THIS FILE DOES NOT FIX IT. Flipping four kinds has a blast radius that must
 * be paid in one commit: `board.js`'s `Math.max(0, c.get('anode'))` LED
 * brightness clamps (which would silently zero every LED rather than fail),
 * the DRC's `> 0.025` anode threshold, `sweep.js`'s deliberate negation of a
 * vsource terminal, `operatingPoint()`'s hand-listed four-kind reverse set, and
 * roughly 180 signed assertions across bw-board, bw-circuit-ui and
 * brickwright-lite's lesson benches.
 *
 * So this PINS THE PRESENT REALITY, exactly: every kind's verdict is asserted
 * as it is today. A convergence must edit this file, which is the point — the
 * table then says what changed, and no kind can quietly join or leave the
 * violating set.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** kind -> [terminal on the resistor's net, terminal on ground, params] */
const SUBJECTS = [
  ['resistor', 'a', 'b', { ohms: 1000 }],
  ['capacitor', 'a', 'b', { farads: 1e-6 }],
  ['inductor', 'a', 'b', { henrys: 1e-3 }],
  ['buzzer', 'a', 'b', {}],
  ['ldr', 'a', 'b', {}],
  ['ntc', 'a', 'b', {}],
  ['isource', 'pos', 'neg', { amps: 1e-3 }],
  ['diode', 'anode', 'cathode', { model: 'shockley', is: 1e-14, n: 1, rs: 0 }],
  ['led', 'anode', 'cathode', {}],
  ['zener', 'cathode', 'anode', { vz: 3.3 }],
  ['vsource', 'pos', 'neg', { volts: 2 }],
];

/** Kinds whose terminal sign DISAGREES with a resistor's, as measured today. */
const VIOLATES_KCL = new Set(['diode', 'led', 'zener', 'vsource']);

function seriesWithResistor(kind, tHigh, tLow, params) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'DUT', kind, params, terminals: [tHigh, tLow] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'in', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'DUT', terminal: tHigh }] },
    { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'DUT', terminal: tLow },
      { part: 'G1', terminal: 'gnd' }] },
  ]);
  const iR = board.branchCurrent('R1', 'b');
  const iD = board.branchCurrent('DUT', tHigh);
  return { board, iR, iD, sum: iR + iD };
}

describe('branchCurrent: which primitives agree with a resistor on a shared wire', () => {
  for (const [kind, tHigh, tLow, params] of SUBJECTS) {
    const expectViolation = VIOLATES_KCL.has(kind);
    it(`${kind} ${expectViolation ? 'DISAGREES (pinned defect)' : 'agrees'}`, () => {
      const { iR, iD, sum } = seriesWithResistor(kind, tHigh, tLow, params);

      // FIRST: the bench must have driven current, or the verdict is a zero
      // nobody drove. A kind that conducts nothing here proves nothing.
      assert.ok(Number.isFinite(iR) && Math.abs(iR) > 1e-7,
        `${kind}: the bench passed no current (R1.b = ${iR}); this case is not exercised`);
      assert.ok(Number.isFinite(iD), `${kind}: DUT.${tHigh} is not finite`);

      // 1e-6 RELATIVE. The two readings come from different computations and
      // agree to ~1e-12 relative, not to the last bit; a 1e-9 tolerance called
      // resistor, ldr, ntc and isource violations when their readings are exact
      // negatives — four false accusations from a tolerance alone.
      const violates = Math.abs(sum) > 1e-6 * Math.abs(iR);

      if (expectViolation) {
        assert.ok(violates,
          `${kind} is pinned as DISAGREEING with a resistor, but KCL now holds `
          + `(sum ${sum}). If this was fixed deliberately, remove ${kind} from `
          + 'VIOLATES_KCL and say so — do not widen the tolerance.');
        // And the disagreement is exactly a sign, not a magnitude error.
        assert.ok(Math.abs(Math.abs(sum) - 2 * Math.abs(iR)) < 1e-6 * Math.abs(iR),
          `${kind}: the two readings should be equal and SAME-signed, so the sum `
          + `is twice the branch current; got sum ${sum} against iR ${iR}`);
      } else {
        assert.ok(!violates,
          `${kind}: KCL at the shared net is ${(sum * 1e3).toExponential(3)} mA — `
          + `R1.b ${iR} and DUT.${tHigh} ${iD} are the two ends of one wire`);
      }
    });
  }

  it('the violating set is exactly the four kinds named, no more and no fewer', () => {
    // An absence check: a kind that JOINS the set must be caught even though
    // its own case above would then fail for the opposite reason.
    const found = [];
    for (const [kind, tHigh, tLow, params] of SUBJECTS) {
      const { iR, sum } = seriesWithResistor(kind, tHigh, tLow, params);
      if (Math.abs(iR) > 1e-7 && Math.abs(sum) > 1e-6 * Math.abs(iR)) found.push(kind);
    }
    assert.deepEqual(found.sort(), [...VIOLATES_KCL].sort(),
      'the set of kinds whose branchCurrent sign disagrees with a resistor has '
      + 'changed; update VIOLATES_KCL in the same commit that changes the engine');
  });
});
