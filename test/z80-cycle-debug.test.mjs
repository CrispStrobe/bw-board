// THE CYCLE-MODE Z80 TARGET, DRIVEN THROUGH ITS INJECTED PROVIDER MODULE.
//
// Self-contained for the same reason its provider's suite is: the engine is
// injected, so there is no oracle and no case here can skip.
//
// THE BATCH-DRAIN ASSERTION IS THE POINT OF THE TRANSPORT. A run slice must
// cross into the module ONCE and drain a batch, not once per tick -- a
// per-tick crossing is the cost this boundary exists to avoid, and it is
// invisible in the facts themselves, which look identical either way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createZ80CycleDebugTarget } from '../src/z80-cycle-debug.js';
import { FLOOOH_Z80_PINS, FLOOOH_Z80_STATE_FIELDS } from '../src/floooh-z80-cycle-provider.js';

const pins = value => Object.fromEntries(
  FLOOOH_Z80_PINS.map((name, i) => [name, name === 'data' ? value : i]));
const state = value => Object.fromEntries(FLOOOH_Z80_STATE_FIELDS.map((name, i) =>
  [name, ['prefixActive', 'iff1', 'iff2'].includes(name) ? false : value + i]));

const fakeModule = () => {
  let cpu = state(10);
  let pinState = pins(0);
  let crossings = 0;
  return {
    reset() { pinState = pins(0); return pinState; },
    tickBatch(count) {
      crossings++;
      return Array.from({ length: count }, () => {
        cpu.step++;
        pinState = pins(cpu.step);
        return { ...pinState, registers: { pc: cpu.pc, step: cpu.step }, retired: cpu.step % 4 === 0 };
      });
    },
    costMetadata: () => ({ maxBatchTicks: 64, maxEvents: 64, eventBytes: 4096, moduleBytes: 8192 }),
    registers() { return { pc: cpu.pc, step: cpu.step }; },
    saveState() { return structuredClone(cpu); },
    loadState(next, nextPins) { cpu = structuredClone(next); pinState = structuredClone(nextPins); },
    crossings: () => crossings
  };
};

const make = async (core = fakeModule()) => {
  const made = await createZ80CycleDebugTarget({
    config: { clockHz: 4_000_000 }, loadCycleModule: async () => core
  });
  assert.equal(made.accepted, true, `construction refused: ${JSON.stringify(made)}`);
  return { ...made, core };
};

test('a cycle target declares cycle stepping and declines to claim a machine checkpoint', async () => {
  const { target } = await make();
  assert.deepEqual(target.capabilities().steps, ['cycle']);
  assert.deepEqual(target.capabilities().breakpoints, [], 'no breakpoints on this path');
  assert.deepEqual(target.capabilities().events, ['cycle', 'signal']);
  assert.equal(target.capabilities().fidelity.instruction, 'unsupported',
    'a cycle provider does not retire instructions');
  assert.deepEqual(target.capabilities().recording, [],
    'provider state is not a complete machine checkpoint: the peripherals are not in it');
});

test('one immutable fact per real tick, on the provider clock, drained in ONE module crossing', async () => {
  const { target, core } = await make();
  const events = [];
  target.onDebugEvent(event => events.push(event));

  target.step('cycle', 2);
  assert.equal(target.runFor(1_000_000), 'halted', 'a two-cycle step ends halted');

  assert.deepEqual(events.map(e => e.time.ticks), [1, 2], 'one fact per tick, in order');
  assert.ok(events.every(e => e.fidelity === 'recorded' && e.phase === 'tick' && e.kind === 'cycle'));
  assert.ok(events.every(e => e.time.domain === 'z80-tstates' && e.time.hz === 4_000_000),
    'facts carry the provider clock, not the instruction target\'s');
  assert.notEqual(events[0].signals, events[1].signals,
    'each fact owns its pin snapshot; a shared object would rewrite history in place');
  assert.equal(core.crossings(), 1, 'a run slice drains one batch, not one crossing per tick');
});

test('a cycle checkpoint round-trips, and an incompatible one throws rather than half-restoring', async () => {
  const { target } = await make();
  target.step('cycle', 4);
  target.runFor(1_000_000);
  const checkpoint = target.captureCheckpoint();
  assert.equal(checkpoint.mode, 'cycle');
  assert.ok(checkpoint.time && checkpoint.provider, 'a checkpoint carries its clock and provider state');

  for (const bad of [null, {}, { schema: 2, target: 'z80', mode: 'cycle' },
    { schema: 1, target: 'i8086', mode: 'cycle' }, { schema: 1, target: 'z80', mode: 'fast' }]) {
    assert.throws(() => target.restoreCheckpoint(bad), /incompatible/,
      `a checkpoint from elsewhere must be refused, not partially applied: ${JSON.stringify(bad)}`);
  }
  // RESTORE FROM A RUNNING TARGET, or the post-condition is already true.
  // This asserted `state() === 'halted'` after restoring a target that was
  // ALREADY halted, so deleting `runState = 'halted'` from restoreCheckpoint
  // left it green -- measured. The state has to be observed changing.
  target.run();
  assert.equal(target.state(), 'running', 'precondition: the target is mid-run before the restore');
  assert.equal(target.restoreCheckpoint(checkpoint), true, 'and its own checkpoint is accepted');
  assert.equal(target.state(), 'halted',
    'a restore halts a running target rather than leaving it advancing on restored state');
});

test('a non-cycle step and a nonsense count refuse by name instead of stepping', async () => {
  const { target } = await make();
  for (const kind of ['insn', 'line', 'over', 'out']) {
    assert.match(target.step(kind).unsupported, /does not yet implement/,
      `${kind} must refuse rather than silently take a cycle`);
  }
  for (const count of [0, -1, 1.5, NaN]) {
    assert.match(target.step('cycle', count).unsupported, /positive/,
      `count ${String(count)} must refuse`);
  }
  assert.equal(target.state(), 'halted', 'and none of those started a run');
});
