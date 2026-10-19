/**
 * `canTakeButtons()` must agree with `setButtons()` on every board, because the
 * whole point of the predicate is to be asked INSTEAD of calling.
 *
 * WHY IT EXISTS. `I8086Machine.canTakeKeys()` has had this shape for months and
 * the other two machines had no equivalent, so a caller could only discover
 * whether a board takes buttons by pressing one and reading the answer. That is
 * too late for anything acting on the CAPABILITY rather than on the OUTCOME: a
 * face advertising a control the board cannot take, or a recorder logging a
 * press nothing received. The second is a live defect in a downstream consumer
 * — its `setButtons` publishes the fact before the machine refuses it, and
 * replaying that log aborts on the refusal.
 *
 * WHAT THIS TEST IS ACTUALLY FOR. A pre-check that disagrees with the operation
 * it gates is worse than no pre-check: it reports on a question the runtime
 * never asks. Downstream `setButtons` pre-checks METHOD EXISTENCE, which is true
 * on a board with no VIA, while the machine refuses later on the capability.
 *
 * SO THE COMPARISON IS AGAINST THE OBSERVED EFFECT, NOT AGAINST setButtons.
 * The first version of this file asserted `canTakeButtons() === setButtons()`,
 * and on the z80 that is a TAUTOLOGY — `setButtons` consults the predicate, so
 * mutating the predicate moves both sides and the assertion holds. Three
 * mutations proved it: hard-coding the predicate true, false, or onto the wrong
 * field all passed. Single-sourcing the check is right (they cannot drift), and
 * it means the agreement must be measured against something INDEPENDENT: what
 * the machine actually does when a button is pressed — the Kempston port on the
 * z80, the VIA's input lines on the 6502.
 *
 * WHAT IT DOES NOT COVER, said rather than implied: this closes the gap for a
 * CAPABILITY the machine lacks. A machine that HAS the hardware and declines a
 * particular press at runtime would still be invisible to a pre-check, and
 * needs an offer/apply/retract answer instead. No such case exists in this tree
 * today; if one appears, this predicate is not the fix for it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import {
  M6502Machine, EATER6502, HB6502, WILSON6502, KIT1, GPASCAL
} from '../src/m6502-machine.js';

const RAM = [{ kind: 'ram', start: 0x0000, end: 0xffff }];

/**
 * The INDEPENDENT observation per machine: press, then look at what the CPU
 * would see. Deliberately not `setButtons`'s return value, and deliberately not
 * the field the predicate reads.
 */
const observers = {
  z80: machine => {
    // READ BEFORE PRESSING, and the order is the whole point. `setButtons`
    // WRITES `_kempston`, which is the same field the port read consults — so a
    // predicate hard-coded true on a bare board makes the press CREATE the port
    // it was asked about, and an observation taken afterwards agrees with the
    // wrong answer. Three mutations passed that way before this was reordered.
    //
    // z80-machine.js:246 answers a Kempston read at 0x1f; a board without one
    // leaves the bus floating at 0xff. At construction the latch is 0.
    return machine.cpu.inPort(0x1f) !== 0xff;
  },
  m6502: machine => {
    // Safe to press first here: the 6502's capability is the presence of a VIA
    // chip, which `setButtons` cannot create. The z80's is a latch `setButtons`
    // writes, which is why that one has to look first.
    machine.setButtons(0x0f);
    // Active-low on the first VIA's PA0..PA3: idle is all high.
    const via = Object.values(machine.chips ?? {}).find(c => c && 'inA' in c);
    return !!via && (via.inA & 0x0f) !== 0x0f;
  }
};

const BOARDS = [
  ['z80', 'z80 with a ULA (Kempston implied)', () => new Z80Machine(
    { clockHz: 3_500_000, regions: RAM, ula: true }, {})],
  ['z80', 'z80 with Kempston asked for outright', () => new Z80Machine(
    { clockHz: 3_500_000, regions: RAM, kempston: true }, {})],
  ['z80', 'z80 with Kempston refused despite a ULA', () => new Z80Machine(
    { clockHz: 3_500_000, regions: RAM, ula: true, kempston: false }, {})],
  ['z80', 'z80 bare', () => new Z80Machine({ clockHz: 3_500_000, regions: RAM }, {})],
  ['m6502', '6502 EATER (via1)', () => new M6502Machine(EATER6502, {})],
  ['m6502', '6502 HB6502', () => new M6502Machine(HB6502, {})],
  ['m6502', '6502 WILSON6502', () => new M6502Machine(WILSON6502, {})],
  ['m6502', '6502 KIT1', () => new M6502Machine(KIT1, {})],
  ['m6502', '6502 GPASCAL', () => new M6502Machine(GPASCAL, {})],
  ['m6502', '6502 with no chips at all', () => new M6502Machine(
    { clockHz: 1_000_000, regions: RAM, chips: [] }, {})]
];

describe('canTakeButtons agrees with what the machine actually does', () => {
  const answers = [];

  for (const [kind, name, make] of BOARDS) {
    it(name, () => {
      const machine = make();
      const declared = machine.canTakeButtons();
      assert.equal(typeof declared, 'boolean', 'the predicate answers a boolean');
      const observed = observers[kind](machine);
      assert.equal(declared, observed,
        `${name}: canTakeButtons() said ${declared} and pressing a button `
        + `${observed ? 'reached the machine' : 'reached nothing'} — a pre-check that `
        + 'disagrees with what it gates is worse than none');
      answers.push(declared);
    });
  }

  it('BOTH ANSWERS OCCUR, or the table proves nothing', () => {
    // Guards the whole block against passing because every board happens to
    // answer the same way — which is how a predicate hard-coded to a constant
    // would look.
    assert.equal(answers.length, BOARDS.length, 'every board was exercised');
    assert.ok(answers.includes(true), 'no board in the table can take buttons');
    assert.ok(answers.includes(false), 'no board in the table refuses buttons');
  });

  it('setButtons still reports the same answer, which is what callers read', () => {
    // The return value is a separate contract from the predicate and both are
    // used; this keeps them from being allowed to disagree just because the
    // observation above is what the predicate is now measured against.
    for (const [, name, make] of BOARDS) {
      const machine = make();
      assert.equal(machine.setButtons(0x1f), machine.canTakeButtons(), name);
    }
  });

  it('asking does not CHANGE anything, so it is safe as a pre-check', () => {
    // A predicate with a side effect would be worse than the call it replaces.
    const machine = new Z80Machine({ clockHz: 3_500_000, regions: RAM, ula: true }, {});
    const before = machine._kempston;
    machine.canTakeButtons();
    machine.canTakeButtons();
    assert.equal(machine._kempston, before, 'the Kempston latch is untouched');

    const m6502 = new M6502Machine(EATER6502, {});
    const via = Object.values(m6502.chips).find(c => c && 'inA' in c);
    const inA = via.inA;
    m6502.canTakeButtons();
    assert.equal(via.inA, inA, 'the VIA input lines are untouched');
  });

  it("ONE MUTATION IS INERT and is recorded as inert: the scan's `'inA' in c`", () => {
    // Dropping that clause changes nothing today, because EVERY chip in this
    // tree that has `setInput` also has `inA` (i8255, m6532, w65c22 — checked).
    // So the clause is a correctness guard for a chip that does not exist yet:
    // one offering `setInput` for ports B/C only. It reports MISSED the way a
    // blind test does and is neither, and the honest handling is to say which
    // with the condition under which it stops being inert — not to delete the
    // clause and not to invent a chip to test it with.
    //
    // What IS asserted is the property the clause exists for: the scan must
    // find a chip whose port A can take an input.
    const machine = new M6502Machine(EATER6502, {});
    const via = machine._buttonVia();
    assert.ok(via, 'a VIA was found');
    assert.equal(typeof via.setInput, 'function');
    assert.ok('inA' in via, 'and it is one whose port A exists');
  });

  it('the 6502 predicate and setButtons share ONE scan', () => {
    // They were the same `find` written twice. Written twice, they can drift;
    // this asserts they cannot, by removing the VIA and checking both answers
    // move together.
    const machine = new M6502Machine(EATER6502, {});
    assert.equal(machine.canTakeButtons(), true);
    assert.equal(machine.setButtons(1), true);
    machine.chips = {};
    assert.equal(machine.canTakeButtons(), false);
    assert.equal(machine.setButtons(1), false);
  });
});
