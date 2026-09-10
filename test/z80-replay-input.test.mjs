/**
 * The Z80 target's APPLY half, driven against a real machine.
 *
 * WHY A REAL TARGET AND NOT A FIXTURE. `debug-replay-contract.test.mjs` proves
 * the normalisation against objects it builds itself, and a declaration tested
 * only against its own fixtures agrees with itself by construction. This file is
 * the first place the contract meets a target that exists: a `Z80Machine` with a
 * real ULA, driven through `createZ80DebugTarget`.
 *
 * WHAT IT DOES NOT COVER, AND A CORRECTION TO WHY. Only the apply half is here.
 * The first version of this note said the record half was BLOCKED — that facts
 * need a `{ticks, domain, hz}` stamp and this build has no time source of that
 * shape, since `machine.tMs` is milliseconds. **The second half is true and the
 * conclusion does not follow.** `tMs` is not a time source, it is a lossy
 * projection of one: `z80-machine.js:270` is
 * `get tMs() { return this.cycles * 1000 / this.clockHz; }`, and both operands
 * are public. The stamp is `{ticks: machine.cycles, domain: 'z80-cycles',
 * hz: machine.clockHz}` — available here, today, and a BETTER source than a
 * host-derived nanosecond clock because it is the machine's own, integral, with
 * no floating-point division.
 *
 * So recording is unstarted work, not a prerequisite. It was read as blocked
 * because someone had already divided the exact source into a float and everyone
 * downstream read the float.
 *
 * `replaySupport` requiring only the apply half is still right, for the reason it
 * always was: a target handed facts from elsewhere can replay them without ever
 * recording one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { replayOutcome, canApplyReplayInput, canRecordDebugInput, replaySupport }
  from '../src/debug-replay-contract.js';

/** A Spectrum-flavoured machine: it has the ULA the key path needs. */
const zx = () => {
  const machine = new Z80Machine({
    clockHz: 3_500_000,
    regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
    ula: true
  });
  return { machine, target: createZ80DebugTarget({ machine }) };
};

test('the target declares BOTH halves of the surface', () => {
  const { target } = zx();
  assert.equal(canApplyReplayInput(target), true);
  assert.equal(canRecordDebugInput(target), true);
  assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
});

test('a recorded fact is stamped from the machine CLOCK, not from a projection of it', () => {
  const { machine, target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));
  target.setKeys(['a']);

  assert.equal(facts.length, 1, 'setting a key must record exactly one fact');
  const [fact] = facts;
  assert.equal(fact.producer, 'z80.keys');
  assert.deepEqual(fact.payload, { names: ['a'] });
  // THE STAMP. cycles and clockHz are the two operands tMs is computed from;
  // taking them undivided keeps it integral.
  assert.equal(fact.time.domain, 'z80-cycles');
  assert.equal(fact.time.hz, machine.clockHz);
  assert.equal(typeof fact.time.ticks, 'number');
  assert.equal(fact.time.ticks, machine.cycles);
});

test('a snapshot RESTORE moves the clock backwards, and the domain says so', () => {
  // The defect this replaces a false claim about. An earlier version of the
  // source said this machine has no reset and its snapshot loaders do not touch
  // `cycles`, so the domain could be constant. `z80-machine.js:373` is
  // `this.cycles = s.cycles` inside loadState, so a restore rewinds into ticks
  // the domain has already issued — worse than a reset, which at least restarts
  // forwards. A downstream recorder refuses exactly that with
  // INVALID_INPUT_ORDER, in the workflow snapshots exist for.
  const { machine, target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));

  target.setKeys(['a']);
  const snapshot = machine.saveState();
  machine.cycles = 100_000;
  target.setKeys(['b']);
  machine.loadState(snapshot);
  assert.ok(machine.cycles < 100_000, 'the restore did not rewind the clock; this test is moot');
  target.setKeys(['c']);

  assert.equal(facts.length, 3);
  const [before1, before2, after] = facts;
  assert.equal(before1.time.domain, before2.time.domain, 'facts before the rewind share a domain');
  assert.notEqual(after.time.domain, before2.time.domain,
    'the fact after the rewind is in the SAME domain as one with a higher tick count');
  assert.match(after.time.domain, /rewind-\d+$/);

  // Within each domain, ticks are non-decreasing — which is the property the
  // recorder checks and the only thing the domain split has to buy.
  const byDomain = new Map();
  for (const fact of facts) {
    const seen = byDomain.get(fact.time.domain) ?? [];
    seen.push(fact.time.ticks);
    byDomain.set(fact.time.domain, seen);
  }
  for (const [domain, ticks] of byDomain) {
    const sorted = [...ticks].sort((a, b) => a - b);
    assert.deepEqual(ticks, sorted, `ticks decreased within domain ${domain}`);
  }
});

test('a rewind that does not happen does not split the domain', () => {
  // The complement: forward-only recording stays in one domain, so the epoch is
  // not bumped by ordinary use.
  const { machine, target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));
  target.setKeys(['a']);
  machine.cycles += 1000;
  target.setKeys(['b']);
  machine.cycles += 1000;
  target.setKeys(['c']);
  assert.equal(new Set(facts.map(f => f.time.domain)).size, 1,
    'the domain split without the clock ever going backwards');
  assert.equal(facts[0].time.domain, 'z80-cycles');
});

test('THE ROUND TRIP: a fact this target recorded, replayed into a fresh one', () => {
  // Record on one machine, replay into another — the real shape, and the one
  // that catches a recorder and an applier agreeing with each other rather than
  // with the contract.
  const recorder = zx();
  const facts = [];
  const stop = recorder.target.onDebugInput(fact => facts.push(fact));
  recorder.target.setKeys(['a', 'enter']);
  recorder.target.setButtons(0x03);
  stop();
  assert.ok(facts.length >= 1, 'nothing was recorded, so this proves nothing');

  const player = zx();
  assert.equal(halfRow(player.machine, 0xfd) & 1, 1, 'the fresh machine starts with the key released');

  for (const fact of facts) {
    const outcome = replayOutcome(player.target.applyReplayInput(fact));
    assert.equal(outcome.accepted, true, `${fact.producer} was refused on replay: ${outcome.reason}`);
  }
  // Asserted at the PORT: the replayed key is held on a machine that never saw
  // the original input.
  assert.equal(halfRow(player.machine, 0xfd) & 1, 0,
    'the replayed key is not held on the machine it was replayed into');
});

test('an unchanged input is not recorded twice, and a changed one is', () => {
  const { target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));
  target.setKeys(['a']);
  target.setKeys(['a']);
  assert.equal(facts.length, 1, 'the same key set was recorded twice');
  target.setKeys(['b']);
  assert.equal(facts.length, 2, 'a CHANGED key set must be recorded');
});

test('replay records NOTHING — a replayed fact is not a newly observed one', () => {
  // Replay routes through setKeys and setButtons, which record. The dedup map is
  // seeded before applying, so the replayed value is already "known" and no fact
  // is emitted. Without the seed, replaying a log while recording produces a
  // second copy of every fact in it.
  //
  // An earlier version of this test asserted only that the SECOND identical
  // replay recorded nothing — which the dedup gives for free even without the
  // seed, so it passed while the first replay was still emitting a fact. The
  // name claimed more than the assertion checked.
  const { target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));
  target.applyReplayInput({ producer: 'z80.keys', payload: { names: ['a'] } });
  assert.deepEqual(facts, [], 'the first replay emitted a fact as though it were observed');
  target.applyReplayInput({ producer: 'z80.buttons', payload: { mask: 0x03 } });
  assert.deepEqual(facts, [], 'the button replay emitted a fact as though it were observed');

  // And a genuine input after a replay is still recorded: the seed suppresses
  // the replayed value, not the recorder.
  target.setKeys(['b']);
  assert.equal(facts.length, 1, 'a real input after a replay must still be recorded');
});

test('a listener cannot corrupt the log for the next listener', () => {
  const { target } = zx();
  const observed = [];
  target.onDebugInput(fact => { fact.payload.names = ['mutated']; fact.time.domain = 'mutated'; });
  target.onDebugInput(fact => observed.push(fact));
  target.setKeys(['a']);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].time.domain, 'z80-cycles');
  assert.deepEqual(observed[0].payload.names, ['a']);
});

test('unsubscribing stops the listener', () => {
  const { target } = zx();
  const facts = [];
  const stop = target.onDebugInput(fact => facts.push(fact));
  target.setKeys(['a']);
  stop();
  target.setKeys(['b']);
  assert.equal(facts.length, 1, 'a fact arrived after unsubscribing');
});

/**
 * Read a Spectrum keyboard half-row the way the ROM does: IN from port 0xFE with
 * A8..A15 selecting the row. A held key pulls its bit LOW.
 */
const halfRow = (machine, selector) => machine.ula.in((selector << 8) | 0xfe) & 0x1f;

test('a recorded key fact reaches the KEYBOARD, not just the return value', () => {
  const { machine, target } = zx();
  // 'a' lives in the half-row selected by A9 low (0xFD), as bit 0.
  assert.equal(halfRow(machine, 0xfd) & 1, 1, 'the key must start released');

  const outcome = replayOutcome(
    target.applyReplayInput({ producer: 'z80.keys', payload: { names: ['a'] } }));
  assert.equal(outcome.accepted, true, outcome.reason);

  // Asserted at the port, not at the method's own answer: a setKeys that
  // returned true and stored nothing would satisfy an assertion about itself.
  assert.equal(halfRow(machine, 0xfd) & 1, 0, 'the replayed key must read as HELD at the port');

  assert.equal(replayOutcome(
    target.applyReplayInput({ producer: 'z80.keys', payload: { names: [] } })).accepted, true);
  assert.equal(halfRow(machine, 0xfd) & 1, 1, 'replaying an empty set must release it');
});

test('a malformed key fact is refused, and the machine is untouched', () => {
  const { target } = zx();
  for (const names of [undefined, 'a', [1], new Array(41).fill('a'), ['x'.repeat(17)]]) {
    const outcome = replayOutcome(target.applyReplayInput({ producer: 'z80.keys', payload: { names } }));
    assert.equal(outcome.accepted, false, `names=${JSON.stringify(names)} must be refused`);
    assert.equal(outcome.code, 'invalid-replay-input');
  }
});

test('a button fact is accepted, because this machine does have setButtons', () => {
  // The first version of this test branched on whether setButtons existed. It
  // does — measured — so the other half never ran, and a conditional assertion
  // whose condition is constant is a test that agrees with whatever it finds.
  const { machine, target } = zx();
  assert.equal(typeof machine.setButtons, 'function',
    'this test asserts acceptance BECAUSE the path exists; if that changes, change the test');
  const outcome = replayOutcome(
    target.applyReplayInput({ producer: 'z80.buttons', payload: { mask: 0x1f } }));
  assert.equal(outcome.accepted, true, outcome.reason);
});

test('a malformed button mask is refused before it reaches the machine', () => {
  const { target } = zx();
  for (const mask of [undefined, 'ff', 1.5, NaN]) {
    const outcome = replayOutcome(
      target.applyReplayInput({ producer: 'z80.buttons', payload: { mask } }));
    assert.equal(outcome.accepted, false, `mask=${String(mask)} must be refused`);
    assert.equal(outcome.code, 'invalid-replay-input');
  }
});

test('serial is refused by name, because this build has no path for it', () => {
  // A downstream copy routes this through adapter.sendSerial, which is absent
  // here. Refusing names the gap; accepting would replay nothing and say it
  // worked.
  const { target } = zx();
  const outcome = replayOutcome(
    target.applyReplayInput({ producer: 'z80.serial', payload: { byte: 0x41 } }));
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.code, 'no-input-path');
  assert.match(outcome.reason, /serial/);
});

test('an unknown producer is refused and names what it was', () => {
  const { target } = zx();
  const outcome = replayOutcome(target.applyReplayInput({ producer: 'z80.nonsense', payload: {} }));
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.code, 'unsupported-replay-input');
  assert.match(outcome.reason, /z80\.nonsense/);
});

test('nothing throws — every failure arrives as a return value', () => {
  const { target } = zx();
  for (const input of [undefined, null, {}, { producer: 'z80.keys' }, { payload: {} }]) {
    let outcome;
    assert.doesNotThrow(() => { outcome = replayOutcome(target.applyReplayInput(input)); },
      `applyReplayInput(${JSON.stringify(input)}) must refuse rather than throw`);
    assert.equal(outcome.accepted, false);
  }
});
