/**
 * The Z80 target's APPLY half, driven against a real machine.
 *
 * WHY A REAL TARGET AND NOT A FIXTURE. `debug-replay-contract.test.mjs` proves
 * the normalisation against objects it builds itself, and a declaration tested
 * only against its own fixtures agrees with itself by construction. This file is
 * the first place the contract meets a target that exists: a `Z80Machine` with a
 * real ULA, driven through `createZ80DebugTarget`.
 *
 * WHAT IT DELIBERATELY DOES NOT COVER. Only the apply half is here. The record
 * half needs facts stamped `{ticks, domain, hz}` and this build has no debug time
 * source of that shape — `machine.tMs` is milliseconds and is not it. Recording
 * is therefore a named prerequisite rather than a silent omission, and
 * `replaySupport` requires only the apply half precisely so a target in this
 * state is usable rather than refused.
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

test('the target declares the apply half and not the record half', () => {
  const { target } = zx();
  assert.equal(canApplyReplayInput(target), true);
  assert.equal(canRecordDebugInput(target), false,
    'the record half is not implemented here yet, and must not read as though it were');
  // And that is enough to replay: the facts come from wherever they were recorded.
  assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
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
