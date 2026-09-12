/**
 * The 8051's replay epoch is covered BY ENUMERATION, and this file is the
 * enumeration — executable, so it can stop being true out loud.
 *
 * The other three debug targets detect a rewind: they compare the machine's
 * clock against the last tick they stamped, and a restore that moves it
 * backwards bumps the epoch whoever caused it. This adapter cannot. Its clock
 * lives in the WASM core, and `emu8051-adapter.js` bumps the epoch at exactly
 * one place: the explicit trigger inside `reset()`.
 *
 * That is correct today. It is correct only because `reset()` happens to be the
 * only public method that moves the clock backwards — a property of the CURRENT
 * ABI, not of the design, and nothing anywhere would notice it stopping being
 * true. A new method that reset the core, or a snapshot/restore added to the
 * WASM (which is where the checkpoint work is heading), would silently produce
 * two eras sharing one domain: facts from an abandoned run interleaved with
 * facts from the live one, and a replay that looks ordered.
 *
 * So the table below is a claim about every public method, and the test asserts
 * the table COVERS the adapter. Adding a method without a row here reddens this
 * file, which is the only moment anybody would otherwise think about it.
 *
 * WHY NOT JUST ADD DETECTION AND DELETE THIS. Because detection alone would not
 * be enough either: `reset()` takes the clock to zero, and a reset issued while
 * the clock IS zero moves nothing, so the explicit trigger is still needed. The
 * two cover each other's blind spot, and this file is what keeps the pair
 * honest rather than a third mechanism nobody reads.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ancestorCandidates } from './helpers/sibling-checkout.mjs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { BoardImpl } from '../src/board.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  // WALKED UP, NOT A FIXED DEPTH. The nearest ancestor comes first, so the CI
  // layout (the build inside the workspace, where actions/checkout puts it)
  // still wins over a sibling checkout. What changes is REACH: a git worktree
  // lives a level deeper than a clone, so `<repo>/../..` lands in `code/wt`
  // and never at `code/emu8051-stc`. Measured from a worktree one level
  // deeper than usual, the old list lost 22 cases across four suites — and on
  // this box the usual depth only worked through an UNDECLARED SYMLINK,
  // `code/wt/emu8051-stc -> code/emu8051-stc`, added 2026-09-03. The defect
  // had already been paid for once, in the filesystem instead of the lookup.
  ...ancestorCandidates(HERE, ['emu8051-stc', 'build', 'emu8051.js'])
];
const WASM = CANDIDATES.find(existsSync);
// Skipped BY NAME when the emulator is not built, so a silent green is never
// mistaken for a passing enumeration.
const skip = WASM ? false : 'emu8051 WASM build not present';

const require = createRequire(import.meta.url);
const loadFactory = () => {
  const mod = require(WASM);
  return typeof mod === 'function' ? mod : mod?.default;
};

/** The core's clock, read the way the adapter reads it. */
const clockNs = Module =>
  BigInt(Module._emu_get_time_ns_lo() >>> 0) | (BigInt(Module._emu_get_time_ns_hi() >>> 0) << 32n);

async function boot(mode = 'poll') {
  const Module = await loadFactory()();
  return { Module, adapter: createEmu8051Adapter(Module, { mode }) };
}

const board = () => {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }
  ], [
    { id: 'n0', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] }
  ]);
  return b;
};

/**
 * Every public method of the adapter, with a benign call and what it is claimed
 * to do to the clock.
 *
 *   'forward'  may advance it; must never move it back
 *   'rewind'   moves it BACK, and must therefore bump the replay epoch
 *
 * A method missing from this table is a method nobody has thought about.
 */
const METHODS = {
  reset:            { effect: 'rewind',  call: a => a.reset() },
  runNs:            { effect: 'forward', call: a => a.runNs(1_000_000) },
  setFosc:          { effect: 'forward', call: a => a.setFosc(11_059_200) },
  attachBoard:      { effect: 'forward', call: a => a.attachBoard(board()) },
  writePort:        { effect: 'forward', call: a => a.writePort(1, 0xff) },
  setPortMode:      { effect: 'forward', call: a => a.setPortMode(1, 0x00, 0xff) },
  readPort:         { effect: 'forward', call: a => a.readPort(1) },
  startAdc:         { effect: 'forward', call: a => a.startAdc(0) },
  adcReady:         { effect: 'forward', call: a => a.adcReady() },
  readAdc:          { effect: 'forward', call: a => a.readAdc() },
  getStats:         { effect: 'forward', call: a => a.getStats() },
  onDebugInput:     { effect: 'forward', call: a => a.onDebugInput(() => {}) },
  applyReplayInput: { effect: 'forward', call: a => a.applyReplayInput(
    { producer: 'emu8051.pin', payload: { port: 1, bit: 0, level: 1 } }) },
  isCoreIdle:       { effect: 'forward', call: a => a.isCoreIdle() },
  loadHex:          { effect: 'forward', call: a => a.loadHex(':00000001FF\n') },
  getPinHistory:    { effect: 'forward', call: a => a.getPinHistory() },
  getTimeHistory:   { effect: 'forward', call: a => a.getTimeHistory() },
  destroy:          { effect: 'forward', call: a => a.destroy() }
};

test('the table covers every public method of the adapter', { skip }, async () => {
  // The assertion that makes this file self-maintaining. Without it the table
  // silently describes an older adapter, which is exactly the failure it exists
  // to prevent — a claim about "every method" that quietly stops being one.
  const { adapter } = await boot();
  const actual = Object.entries(adapter)
    .filter(([, v]) => typeof v === 'function').map(([k]) => k).sort();
  assert.deepEqual(actual, Object.keys(METHODS).sort(),
    'a method with no row here is a method nobody has classified: add one');
});

test('only the methods claimed to rewind actually rewind', { skip }, async () => {
  let checkedForward = 0, checkedRewind = 0;
  for (const [name, { effect, call }] of Object.entries(METHODS)) {
    // A fresh adapter each time: destroy() and reset() are not undoable, and a
    // shared one would make the order of this loop load-bearing.
    const { Module, adapter } = await boot();
    adapter.runNs(2_000_000);                       // put the clock somewhere
    const before = clockNs(Module);
    assert.ok(before > 0n, `${name}: the clock must have moved before the check`);

    call(adapter);
    const after = clockNs(Module);

    if (effect === 'rewind') {
      assert.ok(after < before, `${name} is claimed to rewind the clock and did not`);
      checkedRewind++;
    } else {
      assert.ok(after >= before,
        `${name} moved the clock BACKWARDS (${before} -> ${after}). The replay epoch `
        + 'is bumped only inside reset(), so this produces two eras sharing one '
        + 'domain. Add a trigger for it, or switch this adapter to clock-based '
        + 'rewind detection like the z80/6502/8086 targets.');
      checkedForward++;
    }
  }
  // Guards against the loop passing because it ran over nothing, and against a
  // table that has quietly lost its one rewinding row.
  assert.ok(checkedRewind >= 1, 'the table must contain at least one rewinding method');
  assert.ok(checkedForward > 10, `only ${checkedForward} forward methods were exercised`);
});

test('the rewinding method bumps the epoch, and a stamped fact says so', { skip }, async () => {
  // The other half: a rewind is only covered if the epoch actually moves. This
  // asserts the EFFECT the table's claim is for, rather than the presence of a
  // trigger in the source.
  //
  // A board is attached because that is what makes the adapter observe inputs
  // at all — the record sites are the native pin/analog boundary. Replay is
  // refused while a board is attached, which is a different rule and not this
  // test's subject.
  const { Module, adapter } = await boot();
  adapter.attachBoard(board());
  const facts = [];
  adapter.onDebugInput(f => facts.push(f));

  adapter.runNs(2_000_000);
  assert.ok(facts.length > 0, 'the emulator observed no input; nothing to stamp');
  const domainBefore = facts[facts.length - 1].time.domain;
  assert.equal(domainBefore, '8051-input-ns', 'the first era is unnumbered');
  // The CLOCK at this moment, not the last fact's tick: facts are observed at
  // the native boundary and the last one may be stamped early in the run, so
  // comparing against it would make the assertion below true by accident.
  const clockBefore = clockNs(Module);
  assert.ok(clockBefore > 0n, 'the run must have moved the clock');

  adapter.reset();
  assert.ok(clockNs(Module) < clockBefore, 'the reset really moved the clock back');
  const beforeCount = facts.length;
  adapter.runNs(2_000_000);

  assert.ok(facts.length > beforeCount,
    'the cleared dedup map must let the post-reset values through again');
  const after = facts[facts.length - 1];
  assert.match(after.time.domain, /^8051-input-ns-reset-\d+$/,
    'a fact recorded after the reset must name the new era');
  assert.notEqual(after.time.domain, domainBefore);
});

test('loadHex does NOT move the clock, which is why it needs no trigger', { skip }, async () => {
  // Pinned separately because it is the method most likely to be assumed to
  // reset the core, and an assumption either way would have been wrong to
  // write down without checking.
  const { Module, adapter } = await boot();
  adapter.runNs(2_000_000);
  const before = clockNs(Module);
  adapter.loadHex(':00000001FF\n');
  assert.equal(clockNs(Module), before, 'loading an image leaves simulated time alone');
});
