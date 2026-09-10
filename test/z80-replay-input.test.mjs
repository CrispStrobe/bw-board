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
import { createZ80Adapter } from '../src/z80-adapter.js';
import { readFileSync } from 'node:fs';
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

test('an input unchanged since an ABANDONED timeline is still recorded', () => {
  // THE DEFECT THIS EXISTS FOR. Detection used to sit inside the stamp, which is
  // only reached once a value has been found to have changed — so a suppressed
  // input never noticed the rewind, and the dedup map survived it holding values
  // from a timeline that no longer exists.
  //
  // Hold 'a', snapshot, run on, press 'b', restore, press 'b' again BELOW the
  // old high-water mark. That last one is a genuine a→b transition in the
  // restored era, and it was dropped because the map still remembered 'b'.
  // Silent loss in the log, which is worse than the ordering error it replaced:
  // that at least threw.
  const { machine, target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));

  target.setKeys(['a']);
  const snapshot = machine.saveState();
  machine.cycles = 50_000;
  target.setKeys(['b']);
  machine.loadState(snapshot);
  machine.cycles = 10_000;        // below the last tick issued: the rewind is visible
  target.setKeys(['b']);          // same VALUE, different timeline

  assert.equal(facts.length, 3, 'the post-rewind input was suppressed by a stale dedup entry');
  assert.match(facts[2].time.domain, /rewind-\d+$/,
    'the post-rewind fact must not claim the abandoned domain');
});

test('KNOWN LIMIT: a rewind that runs past the old high-water mark is invisible', () => {
  // Pinned rather than implied, so the boundary is a fact instead of a promise.
  // Clock-watching sees a rewind only when a later input observes a LOWER tick.
  // Restore, then run past where the timeline had already reached, and the next
  // fact is monotonic and indistinguishable from ordinary progress — the log
  // implies time elapsed between two facts on opposite sides of a restore.
  //
  // Nothing on this side can detect it: the machine would have to say so, and
  // closing it needs a machine-side signal on loadState. THIS TEST ASSERTS THE
  // CURRENT BEHAVIOUR, INCLUDING ITS LOSS. If it starts failing because a signal
  // arrived, that is the good outcome — delete it and cover the case properly.
  const { machine, target } = zx();
  const facts = [];
  target.onDebugInput(fact => facts.push(fact));

  target.setKeys(['a']);
  const snapshot = machine.saveState();
  machine.cycles = 50_000;
  target.setKeys(['b']);
  machine.loadState(snapshot);
  machine.cycles = 60_000;        // ABOVE the last tick issued: the rewind is not visible
  target.setKeys(['b']);

  assert.equal(facts.length, 2, 'a signal must have arrived; this limit can now be closed');
  assert.equal(new Set(facts.map(f => f.time.domain)).size, 1,
    'the domain split, so something detected a rewind this test says is undetectable');
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

// ─── serial: a CORRECTION, and the tests the corrected claim needs ─────────
//
// This block replaces a test called "serial is refused by name, because this
// build has no path for it". It passed, and its subject was false. The build
// has a serial input path: `z80-adapter.js:245`, whose own header at line 14
// calls it "sendSerial like every other serial-bearing adapter". What was
// actually absent was the ADAPTER — `zx()` above builds the target over a bare
// `{machine}` — and the test could not tell the two apart, because both give
// `accepted: false`. A refusal reason is a claim about the BUILD, and the test
// only ever exercised one construction of it.
//
// So the fixture is the thing that had to change first: a target over a real
// adapter is what makes the two answers distinguishable.

/** A target over a REAL adapter — SEARLE, which carries an ACIA. */
const searle = () => {
  const adapter = createZ80Adapter({});
  return { adapter, machine: adapter.machine, target: createZ80DebugTarget(adapter) };
};

test('serial APPLIES through the adapter, and the byte reaches the ACIA', () => {
  const { target, machine } = searle();
  const acia = machine.chips.acia1;
  assert.equal(acia.rdrf, false, 'idle before replay');
  const outcome = replayOutcome(
    target.applyReplayInput({ producer: 'z80.serial', payload: { byte: 0x41 } }));
  assert.equal(outcome.accepted, true);
  assert.equal(acia.rdrf, true, 'RDRF raised, as a real UART would');
  // MC6850: RS=0 is status (bit 0 = RDRF), RS=1 is the data register. The 6502
  // tier's W65C51 has them the other way round, which is why this is measured
  // per chip rather than copied across targets.
  assert.equal(acia.read(0) & 0x01, 1, 'status shows data ready');
  assert.equal(acia.read(1), 0x41, 'and the data register holds the recorded byte');
});

test('serial is an EVENT: the same byte twice is two facts and two bytes', () => {
  // Not a level. Deduplicating it would replay a transcript with a character
  // missing, and nothing would report an error.
  const live = searle();
  const facts = [];
  live.target.onDebugInput(f => facts.push(f));
  assert.equal(live.target.sendSerial(0x41), true);
  assert.equal(live.target.sendSerial(0x41), true);
  assert.equal(facts.length, 2);
  assert.deepEqual(facts.map(f => f.payload.byte), [0x41, 0x41]);
  assert.equal(facts[0].producer, 'z80.serial');
  assert.equal(facts[0].time.domain, 'z80-cycles');

  const replayed = searle();
  const echoed = [];
  replayed.target.onDebugInput(f => echoed.push(f));
  for (const fact of facts) {
    assert.equal(replayOutcome(replayed.target.applyReplayInput(fact)).accepted, true);
  }
  assert.equal(replayed.machine.chips.acia1.read(1), 0x41, 'the replayed ACIA has it');
  assert.equal(echoed.length, 0, 'a replayed byte must not re-enter the log');
});

test('a target built WITHOUT an adapter refuses, and says that is why', () => {
  // The distinction the old test could not draw. The refusal is still correct
  // for this construction — it just has to name the right absence.
  const { target } = zx();
  const outcome = replayOutcome(
    target.applyReplayInput({ producer: 'z80.serial', payload: { byte: 0x41 } }));
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.code, 'no-input-path');
  assert.match(outcome.reason, /without an adapter/);
  assert.equal(target.sendSerial(0x41), false, 'and the record entry point agrees');
});

test('a build with no serial-capable chip refuses, and that is a different absence', () => {
  const adapter = createZ80Adapter({ config: {
    clockHz: 3_500_000,
    regions: [{ kind: 'ram', start: 0x0000, end: 0xffff }],
    ports: []
  } });
  const target = createZ80DebugTarget(adapter);
  const outcome = replayOutcome(
    target.applyReplayInput({ producer: 'z80.serial', payload: { byte: 0x41 } }));
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.code, 'no-input-path');
  assert.match(outcome.reason, /no chip/);

  // And the record half agrees: a byte no chip took is not a fact. Logging it
  // would replay a character that never arrived, and the log would be longer
  // than the run — the same defect as the refusal, from the other side.
  const facts = [];
  target.onDebugInput(f => facts.push(f));
  assert.equal(target.sendSerial(0x41), false, 'nothing took it');
  assert.equal(facts.length, 0, 'so it is not a fact');
});

test('serial refuses a byte outside 0..255 as a BAD INPUT, not a bad build', () => {
  const { target } = searle();
  for (const byte of [-1, 256, 1.5, undefined, '0x41']) {
    const outcome = replayOutcome(
      target.applyReplayInput({ producer: 'z80.serial', payload: { byte } }));
    assert.equal(outcome.accepted, false, `${String(byte)} must be refused`);
    assert.equal(outcome.code, 'invalid-replay-input');
  }
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

// ─── A HOLLOW TARGET REFUSES, IT DOES NOT THROW ────────────────────────────
//
// The contract's central rule: applyReplayInput never throws for an input it
// merely cannot serve. This target already satisfied it — checked, not assumed
// — and the enumeration is here anyway, because satisfying it once is not the
// property worth having. The 6502 and 8086 targets each threw on producers
// added an hour after the same rule had been applied correctly to a sibling
// producer in the same file. A rule learned about one call site is not yet a
// rule about the method, and a rule about the method is not yet a rule about
// the file.
//
// `{machine: {cpu: {}}}` is not a hypothetical construction:
// `code-address-progression.test.mjs:32` builds it literally, and
// `z80-machine.test.mjs:77`, `debug-parity.test.mjs:23` and
// `audio-ay.test.mjs:219` all construct over a bare `{machine}`.

const Z80_SOURCE = readFileSync(new URL('../src/z80-debug.js', import.meta.url), 'utf8');
const Z80_PRODUCERS = [...new Set(
  [...Z80_SOURCE.matchAll(/input\?\.producer === '(z80\.[a-z]+)'/g)].map(m => m[1]))];

// A VALID payload per producer. Malformed ones would refuse at the validation
// step and never reach the hardware, so a table of those would pass against a
// throwing implementation too.
const Z80_VALID = {
  'z80.buttons': { mask: 1 },
  'z80.keys': { names: ['a'] },
  'z80.serial': { byte: 0x41 }
};

test('the payload table covers every producer the source handles', () => {
  assert.deepEqual(Z80_PRODUCERS.sort(), Object.keys(Z80_VALID).sort(),
    'a producer with no valid payload here is a producer this test does not check');
  assert.ok(Z80_PRODUCERS.length >= 3, `the scan found only ${Z80_PRODUCERS.length}`);
});

test('every producer refuses on a hollow target, with a VALID payload', () => {
  const target = createZ80DebugTarget({ machine: { cpu: {} } });
  for (const producer of Z80_PRODUCERS) {
    const outcome = replayOutcome(
      target.applyReplayInput({ producer, payload: Z80_VALID[producer] }));
    assert.equal(outcome.accepted, false, `${producer} must refuse`);
    assert.equal(outcome.code, 'no-input-path',
      `${producer} refused for the wrong reason: ${outcome.reason}`);
  }
});

test('the record entry points refuse on a hollow target too', () => {
  const target = createZ80DebugTarget({ machine: { cpu: {} } });
  assert.equal(target.setButtons(1), false);
  assert.equal(target.setKeys(['a']), false);
  assert.equal(target.sendSerial(0x41), false);
  // And an unknown producer is still told what it was.
  const outcome = replayOutcome(target.applyReplayInput({ producer: 'z80.paddle', payload: {} }));
  assert.equal(outcome.code, 'unsupported-replay-input');
});
