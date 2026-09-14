/**
 * Current contract: raw currents uniformly OUT, operatingPoint explicitly
 * INTO. The following historical diagnosis explains the former extraction
 * defect. The initializer's OP terminal-a read was correct throughout; its
 * cache conversion and the public extraction were the broken boundaries.
 *
 * ONE SIGN CONVENTION FOR BRANCH CURRENTS, AND NET-LEVEL KCL PROVES IT.
 *
 * `branchCurrent(part, terminal)` is OUT-OF-PART POSITIVE — positive means
 * current leaving the part into the net. That is documented in
 * `test/device-kcl-visibility.test.mjs`, and it is what the resistor, the
 * capacitor, the buzzer, the ldr, the ntc and the current source do.
 *
 * IT IS NOT WHAT EVERY DEVICE DOES, and an earlier version of this comment
 * said so wrongly. `solveMNA`'s extraction is split PER KIND: a diode, an LED,
 * a zener and a voltage source report the opposite sign, so net-level KCL fails
 * through this API on a resistor-plus-diode junction -- the commonest circuit in
 * the gallery corpus -- by exactly twice the branch current. Every kind's
 * measured verdict is in `test/branch-current-kind-census.test.mjs`. What
 * follows is true of the inductor and the resistor, the pair this file is
 * about; it is not a claim about the engine as a whole.
 *
 * It is not negotiable per device. Net-level KCL is the sum of every terminal's
 * reading on a net, so ONE device using the opposite sign breaks Kirchhoff
 * wherever it shares a net with anything else — and the reading a user takes
 * with a meter in that lead is then wrong by twice the current.
 *
 * WHY THIS FILE EXISTS. The inductor's extraction briefly read `a: +i, b: -i`,
 * with a comment asserting "positive INTO the named terminal". The motivation
 * was real: `initializeTransientFromOperatingPoint` reads the stored a -> b
 * current off a terminal, and it was reading terminal A, whose value is the
 * NEGATIVE of that. But the repair went into the public reader instead of the
 * initializer, so it fixed one consumer and broke all the others.
 *
 * Measured on the bench below, where NEITHER of the inductor's nets carries a
 * reference terminal, so no question about whether the ground rail reports
 * current can arise:
 *
 *   out-of-part          KCL at L1.a's net  0.0000 mA, at L1.b's  0.0000 mA
 *   into-the-terminal    KCL at L1.a's net 49.9998 mA, at L1.b's -49.9997 mA
 *
 * Off by exactly twice the branch current, in both places at once.
 *
 * AND THE FULL SUITE PASSED IN BOTH STATES — 5,447 tests, 0 failures, with the
 * violation in place. No test put an inductor on a shared net with another
 * device and summed. That gap is what this file closes; the assertion is on
 * KCL at a net, not on a sign, because the sign is a means and KCL is the claim.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** V1 -> R1 -> L1 -> R2 -> gnd. Both of L1's nets are ordinary nets. */
function rlr() {
  const { parts, nets } = new NetlistBuilder()
    .vsource('V1', 5).gnd('GND')
    .resistor('R1', 100).inductor('L1', 1e-3).resistor('R2', 100)
    .wire('V1.neg', 'GND.gnd').wire('V1.pos', 'R1.a')
    .wire('R1.b', 'L1.a').wire('L1.b', 'R2.a').wire('R2.b', 'GND.gnd')
    .build();
  const board = new BoardImpl(5);
  board.setNetlist(parts, nets);
  const netOf = (part, terminal) => nets.find(
    (n) => n.terminals.some((t) => t.part === part && t.terminal === terminal));
  return { board, nets, netOf };
}

const kcl = (board, net) => net.terminals
  .reduce((sum, t) => sum + board.branchCurrent(t.part, t.terminal), 0);

describe('an inductor obeys the same branch-current convention as everything else', () => {
  it('KCL holds at the net on the inductor\'s A side', () => {
    const { board, netOf } = rlr();
    const net = netOf('L1', 'a');
    assert.ok(!net.terminals.some((t) => t.part === 'GND'),
      'the bench must put no reference terminal on this net, or KCL is not a fair test');
    const sum = kcl(board, net);
    assert.ok(Math.abs(sum) < 1e-9,
      `KCL at L1.a's net: ${(sum * 1e3).toFixed(4)} mA — an inductor using the `
      + 'opposite sign to the resistor beside it is off by twice the current');
  });

  it('KCL holds at the net on the inductor\'s B side', () => {
    // BOTH ends, because a sign flip breaks one and could be mistaken for a
    // problem with the other device.
    const { board, netOf } = rlr();
    const net = netOf('L1', 'b');
    assert.ok(!net.terminals.some((t) => t.part === 'GND'));
    const sum = kcl(board, net);
    assert.ok(Math.abs(sum) < 1e-9, `KCL at L1.b's net: ${(sum * 1e3).toFixed(4)} mA`);
  });

  it('and the inductor conserves across its own two terminals', () => {
    // This held even while KCL was broken — a device can be internally
    // consistent and still disagree with the rest of the circuit, which is
    // exactly why the assertions above are about NETS.
    const { board } = rlr();
    const a = board.branchCurrent('L1', 'a');
    const b = board.branchCurrent('L1', 'b');
    assert.ok(Math.abs(a + b) < 1e-12, `a ${a} + b ${b}`);
    assert.ok(Math.abs(a) > 1e-3, 'and it must actually be carrying current');
  });

  it('the resistor beside it reads the same magnitude with the opposite sign', () => {
    // Pins the convention itself, so a future reader can see which way round it
    // is without deriving it from KCL.
    const { board } = rlr();
    const iR1b = board.branchCurrent('R1', 'b');
    const iL1a = board.branchCurrent('L1', 'a');
    // Relative, not absolute: the two come from different computations -- R1's
    // from Ohm's law across its own nodes, L1's from the 1 mOhm DC wire -- so
    // they agree to about 1e-9 relative, not to the last bit.
    assert.ok(Math.abs(iR1b + iL1a) / Math.abs(iR1b) < 1e-6,
      `R1.b ${iR1b} and L1.a ${iL1a} are the two ends of one wire`);
    assert.ok(iR1b > 0, 'current LEAVES R1 at b, so out-of-part is positive there');
    assert.ok(iL1a < 0, 'and ENTERS L1 at a, so out-of-part is negative there');
  });
});

/**
 * THE REAL DEFECT UNDERNEATH: TWO BRANCH-CURRENT CONVENTIONS IN ONE ENGINE.
 *
 * `branchCurrent()` (from `solveMNA`'s extraction) is OUT-OF-PART positive.
 * `operatingPoint()` is INTO-THE-TERMINAL positive. Both are self-consistent,
 * so net-level KCL holds inside each, and the two are exact negatives:
 *
 *   branchCurrent()    L1.a = -2.499988e-2   R1.b = +2.499988e-2
 *   operatingPoint()   L1.a = +2.500000e-2   R1.b = -2.500000e-2
 *
 * That is what made the inductor look wrong from the outside.
 * `initializeTransientFromOperatingPoint` reads an `operatingPoint()` result,
 * where terminal A's value IS the a -> b current, so its `get('a')` was
 * correct — and the repair that followed flipped `solveMNA`'s PUBLIC signs to
 * match a consumer of the OTHER convention, fixing nothing and breaking KCL.
 *
 * Converging the two touches every `operatingPoint()` consumer, and that API is
 * a separate lane's refuse-by-name contract. So this pins BOTH conventions AS
 * THEY ARE, with the remedy named: whichever one moves, this reds and says what
 * the decision is, instead of a sign quietly changing under one caller.
 */
describe('the two branch-current conventions, pinned until they are converged', () => {
  it('branchCurrent() is out-of-part positive', () => {
    const { board } = rlr();
    assert.ok(board.branchCurrent('R1', 'b') > 0,
      'current leaves R1 at b, so out-of-part is positive');
    assert.ok(board.branchCurrent('L1', 'a') < 0,
      'current enters L1 at a, so out-of-part is negative');
  });

  it('operatingPoint() is into-the-terminal positive — the OPPOSITE one', () => {
    const { board } = rlr();
    const op = board.operatingPoint();
    const r1 = op.branchCurrents.get('R1');
    const l1 = op.branchCurrents.get('L1');
    assert.ok(r1 && l1, 'both parts must be reported');
    assert.ok(r1.get('b') < 0,
      'operatingPoint reports R1.b NEGATIVE where branchCurrent reports it positive');
    assert.ok(l1.get('a') > 0,
      'and L1.a POSITIVE where branchCurrent reports it negative');
  });

  it('are exact negatives FOR THE FOUR KINDS operatingPoint reverses', () => {
    // NARROWER THAN IT FIRST READ. `currentsIntoTerminals` reverses exactly
    // {resistor, capacitor, isource, vccs}; for a vsource, a diode or a VCVS
    // the two APIs return the IDENTICAL value, not the negative. Every part
    // probed below is in the reversed set, so "exact negatives" is true of them
    // and false as a general claim -- do not add a V or D part to this list
    // expecting it to hold.
    // THE REMEDY, IF THIS EVER REDS: converge the two on out-of-part positive
    // (the documented one, in `test/device-kcl-visibility.test.mjs`) and update
    // `initializeTransientFromOperatingPoint` to read terminal B in the same
    // change. Do NOT fix one caller by flipping a sign; that is the mistake
    // this file records.
    const { board } = rlr();
    const op = board.operatingPoint();
    for (const [part, terminal] of [['R1', 'b'], ['L1', 'a'], ['L1', 'b'], ['R2', 'a']]) {
      const live = board.branchCurrent(part, terminal);
      const point = op.branchCurrents.get(part)?.get(terminal);
      assert.ok(Number.isFinite(point), `${part}.${terminal} missing from operatingPoint`);
      assert.ok(Math.abs(live + point) / Math.abs(live) < 1e-3,
        `${part}.${terminal}: branchCurrent ${live}, operatingPoint ${point} — `
        + 'these four kinds must remain exact negatives until the conventions converge');
    }
  });
});

describe('the transient initializer stores a positive a -> b current', () => {
  it('initialises +I for current flowing a -> b', () => {
    // The consumer whose sign started all of this. What it must produce is
    // stated here in PHYSICAL terms — a positive stored current for current
    // flowing a to b — so the assertion survives either convention being
    // chosen later.
    const { board } = rlr();
    assert.equal(typeof board.initializeTransientFromOperatingPoint, 'function',
      'initializeTransientFromOperatingPoint is gone; this test must be re-aimed');
    board.initializeTransientFromOperatingPoint();
    const stored = board.inductorCurrents.get('L1');
    const expected = 5 / (100 + 100 + 0.001);
    assert.ok(Math.abs(stored - expected) / expected < 1e-3,
      `stored inductor current ${stored} A, expected +${expected} A flowing a -> b`);
    assert.ok(stored > 0, 'a current flowing a to b must be stored POSITIVE');
  });
});

/**
 * AND THE PUBLIC READER MUST NOT CHANGE CONVENTION MID-LIFE.
 *
 * `initializeTransientFromOperatingPoint` seeds `_mnaCache.branchCurrents` from
 * an `operatingPoint()` result. Seeded verbatim, that inverted EVERY device's
 * public current for as long as that cache stood, and then inverted back on the
 * next solve — so the sign a meter reported depended on whether the board had
 * just been initialised. Measured at volts = -4 on the RCL bench: L1.b read
 * +1.333333e-3 straight after initialisation and -1.333333e-3 at every other
 * moment.
 *
 * The conversion now happens at that one boundary. This asserts the property it
 * buys, which is not a sign but STABILITY: the same reading before and after.
 */
describe('branchCurrent keeps one convention across initialisation', () => {
  it('reports the same sign before and after initializeTransientFromOperatingPoint', () => {
    const { board } = rlr();
    const before = ['a', 'b'].map((t) => board.branchCurrent('L1', t));
    assert.ok(Math.abs(before[0]) > 1e-3, 'the bench must be carrying current');
    board.initializeTransientFromOperatingPoint();
    const after = ['a', 'b'].map((t) => board.branchCurrent('L1', t));
    for (let k = 0; k < 2; k++) {
      assert.ok(Math.abs(after[k] - before[k]) / Math.abs(before[k]) < 1e-3,
        `L1.${'ab'[k]}: ${before[k]} before initialisation, ${after[k]} after — `
        + 'the public convention must not depend on what the board just did');
    }
  });

  it('and KCL still holds at a net immediately after initialisation', () => {
    // The stronger form: it is not enough for the signs to be stable, they must
    // be stable AT THE CONVENTION THAT SATISFIES KIRCHHOFF.
    const { board, netOf } = rlr();
    board.initializeTransientFromOperatingPoint();
    for (const terminal of ['a', 'b']) {
      const net = netOf('L1', terminal);
      const sum = kcl(board, net);
      assert.ok(Math.abs(sum) < 1e-9,
        `KCL at L1.${terminal}'s net straight after initialisation: ${(sum * 1e3).toFixed(6)} mA`);
    }
  });

  it('every device is converted, not just the inductor', () => {
    // Guard every reach: the seed converts a whole map, so a resistor on the
    // same board must move with it.
    const { board } = rlr();
    const before = board.branchCurrent('R1', 'b');
    board.initializeTransientFromOperatingPoint();
    const after = board.branchCurrent('R1', 'b');
    assert.ok(Math.abs(after - before) / Math.abs(before) < 1e-3,
      `R1.b: ${before} before, ${after} after`);
    assert.ok(after > 0, 'and still out-of-part positive where current leaves');
  });
});
