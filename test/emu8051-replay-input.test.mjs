/**
 * The 8051 adapter's replay surface: RECORD and APPLY, round-tripped.
 *
 * WHY THIS FILE MATTERS MORE THAN THE OTHER TWO. `debug-replay-contract.test.mjs`
 * drives objects it builds itself, and `z80-replay-input.test.mjs` applies facts
 * this repository hand-wrote. Both prove the apply half against a fact of the
 * shape the author BELIEVED a target produces. This is the first place a fact is
 * produced by a real emulator and then replayed back into one — the difference
 * between "a fact I believe the target emits" and "a fact the target emitted".
 *
 * That difference is not decorative. A hand-written fact cannot catch a recorder
 * that stamps the wrong time domain, dedups on the wrong key, or emits a payload
 * the applier then refuses as malformed — because the author writes both sides
 * from the same belief. A round trip catches all three.
 *
 * WHY POLL MODE. In push mode the core reads the attached board directly, so a
 * replayed value is overwritten by the next poll; `applyReplayInput` refuses
 * there rather than replaying something that will not survive. The refusal is
 * asserted below in the mode it applies to.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';
import { replayOutcome, canApplyReplayInput, canRecordDebugInput, replaySupport }
  from '../src/debug-replay-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// Same discovery as the other emu8051 suites: beside the repo when developing,
// inside the workspace in CI.
const CANDIDATES = [
  join(HERE, '..', 'emu8051-stc', 'build', 'emu8051.js'),
  join(HERE, '..', '..', 'emu8051-stc', 'build', 'emu8051.js')
];
const WASM = CANDIDATES.find(existsSync);
// Skipped BY NAME when the emulator is not built, so a silent green is never
// mistaken for a passing round trip.
const skip = WASM ? false : 'emu8051 WASM build not present';

const require = createRequire(import.meta.url);
const loadFactory = () => {
  const mod = require(WASM);
  return typeof mod === 'function' ? mod : mod?.default;
};

/** A real adapter on a real board, with P1.0 driven by the circuit. */
async function boot(mode) {
  const Module = await loadFactory()();
  const adapter = createEmu8051Adapter(Module, { mode });
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }
  ], [
    { id: 'n0', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] }
  ]);
  adapter.attachBoard(board);
  return { adapter, board };
}

test('the adapter declares BOTH halves of the surface', { skip }, async () => {
  const { adapter } = await boot('poll');
  assert.equal(canApplyReplayInput(adapter), true);
  assert.equal(canRecordDebugInput(adapter), true,
    'this is the first target to implement the record half; the name is onDebugInput');
  assert.deepEqual(replaySupport(adapter), { supported: true, reasons: [] });
});

test('a fact the emulator RECORDED is replayed back and accepted', { skip }, async () => {
  const { adapter } = await boot('poll');
  const recorded = [];
  const stop = adapter.onDebugInput(fact => recorded.push(fact));

  // Run the core so it polls its inputs. The facts below are whatever the
  // machine actually observed — nothing here constructs one.
  adapter.runNs(2_000_000);
  stop();

  assert.ok(recorded.length > 0, 'the emulator observed no input at all; nothing to round-trip');
  const fact = recorded[0];

  // The shape is asserted on a fact the target produced, which is the only way
  // to catch a recorder and an applier that agree with each other and not with
  // the contract.
  assert.match(fact.producer, /^emu8051\.(pin|adc)$/);
  assert.equal(typeof fact.time.ticks, 'bigint');
  assert.equal(fact.time.hz, 1e9);
  assert.match(fact.time.domain, /^8051-input-ns/);

  // THE ROUND TRIP. Replay the recorded fact, unmodified.
  const outcome = replayOutcome(adapter.applyReplayInput(fact));
  assert.equal(outcome.accepted, true,
    `a fact this adapter recorded was refused by the same adapter: ${outcome.reason}`);
});

test('every recorded fact replays — not just the first', { skip }, async () => {
  const { adapter } = await boot('poll');
  const recorded = [];
  const stop = adapter.onDebugInput(fact => recorded.push(fact));
  adapter.runNs(2_000_000);
  stop();

  for (const fact of recorded) {
    const outcome = replayOutcome(adapter.applyReplayInput(fact));
    assert.equal(outcome.accepted, true,
      `recorded ${fact.producer} was refused on replay: ${outcome.reason}`);
  }
});

test('every recorded fact is distinct — no key is emitted twice in a sync', { skip }, async () => {
  // WHAT THIS DOES NOT PROVE, STATED RATHER THAN IMPLIED. `recordInput`
  // deduplicates on (key, value), and that property is NOT observable through
  // this surface with this adapter: measured, the input sync runs once per
  // attach or reset, so a second `runNs` polls nothing and the fact count cannot
  // grow whether deduplication works or not. An earlier version of this test
  // asserted exactly that non-growth and passed with deduplication DISABLED —
  // a mutation proved it vacuous.
  //
  // What is checkable here is weaker and honest: within the one sync that does
  // happen, no key repeats. If the sync ever becomes repeatable — a running
  // core that re-polls, or a board whose values change mid-run — this is the
  // test to strengthen, and the dedup property becomes provable then.
  const { adapter } = await boot('poll');
  const seen = [];
  const stop = adapter.onDebugInput(fact => seen.push(fact));
  adapter.runNs(1_000_000);
  stop();
  assert.ok(seen.length > 0, 'nothing was recorded, so this proves nothing');
  const keys = seen.map(fact => `${fact.producer}:${JSON.stringify(fact.payload)}`);
  assert.equal(new Set(keys).size, keys.length, 'a fact was emitted twice in one sync');
});

test('a listener cannot corrupt the log for the next listener', { skip }, async () => {
  const { adapter } = await boot('poll');
  const observed = [];
  adapter.onDebugInput(fact => { fact.payload.level = 99; fact.time.domain = 'mutated'; });
  adapter.onDebugInput(fact => observed.push(fact));
  adapter.runNs(2_000_000);
  assert.ok(observed.length > 0, 'nothing was recorded, so this proves nothing');
  for (const fact of observed) {
    assert.notEqual(fact.time.domain, 'mutated', "a listener mutated another listener's fact");
    if (fact.producer === 'emu8051.pin') assert.notEqual(fact.payload.level, 99);
  }
});

test('reset clears the dedup and moves the time domain to a new era', { skip }, async () => {
  // Facts from before a reset are not comparable with facts after it: the clock
  // restarts. A replay that interleaved them would look ordered and be wrong.
  const { adapter } = await boot('poll');
  const before = [];
  let stop = adapter.onDebugInput(fact => before.push(fact));
  adapter.runNs(2_000_000);
  stop();
  assert.ok(before.length > 0);

  adapter.reset();
  const after = [];
  stop = adapter.onDebugInput(fact => after.push(fact));
  adapter.runNs(2_000_000);
  stop();

  assert.ok(after.length > 0, 'reset suppressed every post-reset fact; the dedup map was not cleared');
  assert.match(after[0].time.domain, /reset-\d+$/, 'the post-reset era is not marked in the domain');
  assert.notEqual(after[0].time.domain, before[0].time.domain);
});

test('a malformed fact is refused before it reaches the native setters', { skip }, async () => {
  const { adapter } = await boot('poll');
  const bad = [
    { producer: 'emu8051.pin', payload: { port: 9, bit: 0, level: 1 } },
    { producer: 'emu8051.pin', payload: { port: 1, bit: 8, level: 1 } },
    { producer: 'emu8051.pin', payload: { port: 1, bit: 0, level: 2 } },
    { producer: 'emu8051.adc', payload: { channel: 8, volts: 1 } },
    { producer: 'emu8051.adc', payload: { channel: 0, volts: NaN } },
    { producer: 'emu8051.nonsense', payload: {} },
    undefined
  ];
  for (const input of bad) {
    let outcome;
    assert.doesNotThrow(() => { outcome = replayOutcome(adapter.applyReplayInput(input)); },
      `applyReplayInput(${JSON.stringify(input)}) must refuse rather than throw`);
    assert.equal(outcome.accepted, false, `${JSON.stringify(input)} must be refused`);
  }
});

test('push mode refuses replay, because the board would overwrite it', { skip }, async () => {
  const { adapter } = await boot('push');
  const outcome = replayOutcome(adapter.applyReplayInput(
    { producer: 'emu8051.pin', payload: { port: 1, bit: 0, level: 1 } }));
  // Asserted, not branched on: this WASM build does reach push mode (measured),
  // so a conditional here would leave one half permanently dead — the vacuous
  // shape this suite exists to avoid. If a build stops reaching push mode, this
  // fails loudly and says why rather than quietly testing the other mode.
  assert.equal(adapter.getStats().mode, 'push',
    'this test is about push mode; the build did not reach it');
  assert.equal(outcome.accepted, false);
  assert.equal(outcome.code, 'live-board-input-authority');
  assert.match(outcome.reason, /board/);
});
