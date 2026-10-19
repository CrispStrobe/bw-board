// THE Z80 MACHINE MUST ACCEPT THE CHECKPOINT DOMAIN ITS OWN TARGET STAMPS.
//
// `z80-debug.js` stamps `z80-cycles` (and `z80-cycles-rewind-N` after a
// rewind); `z80-machine.js` validated `/^z80-tstates(?:-reset-\d+)?$/`. Both
// files were internally consistent and disagreed with each other, so a z80
// target could not restore a checkpoint it had just captured itself:
//
//     captureCheckpoint() -> {time: {domain: 'z80-cycles', ...}}
//     restoreCheckpoint() -> {refused: 'checkpoint simulation time is
//                             inconsistent', code: 'INVALID_CHECKPOINT_TIME'}
//
// WHY NO TEST HERE SAW IT. The rename to `z80-cycles` was deliberate and is
// argued in z80-debug.js:37-42 — an event clock on a different base from the
// replay clock is two timelines a replayer reads as one. But it moved the
// BUILDER and left a READER behind, and the reader matches a FRAGMENT inside a
// regex, so it is invisible to a census of `domain: 'z80-tstates'`. Every
// existing case drives one file or the other; only capturing through the
// TARGET and restoring through the MACHINE crosses the seam.
//
// SO THIS ASSERTS AGREEMENT, NOT A SPELLING. No case here names either domain
// string: the checkpoint's domain is whatever the target stamps, and the
// machine has to take it. A test that asserted `'z80-cycles'` would pass again
// the day someone renames the builder and misses the regex — which is exactly
// what happened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';

// LD A,(0x0500) ; LD (0x0501),A ; HALT
const CODE = [0x3a, 0x00, 0x05, 0x32, 0x01, 0x05, 0x76];

const build = () => {
  const machine = new Z80Machine(
    { clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
  machine.mem.set(CODE, 0);
  machine.mem[0x0500] = 0x5a;
  return { machine, target: createZ80DebugTarget({ machine }) };
};

test('the machine accepts the checkpoint domain its own target stamps', () => {
  const { machine, target } = build();
  machine.step();

  const checkpoint = target.captureCheckpoint();
  // ANTI-VACUITY: a refused capture, or one carrying no time at all, would make
  // every assertion below true about nothing.
  assert.ok(!checkpoint.refused, `capture refused: ${JSON.stringify(checkpoint.refused)}`);
  assert.ok(checkpoint.time && typeof checkpoint.time.domain === 'string',
    'the checkpoint must carry a stamped time domain for this to be about anything');

  const restored = machine.restoreCheckpoint(checkpoint);
  assert.equal(restored, undefined,
    `the machine refused the domain its own target stamped (${checkpoint.time.domain}): `
    + `${JSON.stringify(restored)}. The builder and the reader of this domain string have `
    + 'drifted apart — finish the rename rather than reverting it; z80-debug.js:37-42 is '
    + 'why the base is z80-cycles.');
});

test('and it still accepts it after a rewind has suffixed the domain', () => {
  // THE CASE A BASE-ONLY RENAME STILL FAILS. `captureCheckpoint` stamps
  // `<base>-rewind-N` once this target has opened a rewind epoch, so a guard
  // that accepts only the bare base refuses every post-rewind checkpoint. The
  // suffix is the half a careless fix drops.
  const { machine, target } = build();
  machine.step();
  const first = target.captureCheckpoint();
  assert.ok(!first.refused);

  machine.step();
  // Restoring through the TARGET is what opens the rewind epoch.
  assert.equal(target.restoreCheckpoint(first), undefined,
    'the target must be able to restore its own checkpoint before this case can continue');

  const second = target.captureCheckpoint();
  assert.ok(!second.refused, `post-rewind capture refused: ${JSON.stringify(second.refused)}`);
  assert.notEqual(second.time.domain, first.time.domain,
    'the rewind must have opened a new epoch, or this case is the same as the one above');

  assert.equal(machine.restoreCheckpoint(second), undefined,
    `the machine refused a post-rewind domain (${second.time.domain}). Accepting only the `
    + 'bare base is a half-finished rename: the epoch suffix is part of the domain.');
});
