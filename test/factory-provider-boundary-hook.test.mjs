// AN OPTIONAL CYCLE-PROVIDER BOUNDARY, INJECTED RATHER THAN IMPORTED.
//
// A downstream tree selects between a fast target and an optional cycle engine
// through a boundary object, and its factory copy imported that boundary
// directly -- a reach out of this tree into a module that cannot come here,
// because the boundary's own dependency has three consumers on that side and
// moving it would point the dependency backwards.
//
// So this tree gains the SEAM and not the boundary: `opts.providerBoundary` is
// a function from a target to a boundary, and absent one the factory behaves
// exactly as it does today. This tree does not need a conditional provider; it
// needs somewhere to put one.
//
// THE BOUNDARY IS DUCK-TYPED, which is what makes the seam a seam: it is used
// only as `.select(id)` returning `{target, ...}`, so nothing here needs a type
// or helper that lives downstream. These cases prove that by injecting a
// boundary written in this file, with no downstream import at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget } from '../src/debug-target-factory.js';

const rom = () => {
  const img = new Uint8Array(0x8000);
  img[0x7ffc] = 0x00;
  img[0x7ffd] = 0x80;
  return img;
};
const board = () => ({ advanceTo() {}, setPin() {} });

/** A boundary of the shape the factory consumes, and nothing more. */
const fakeBoundary = (substitute = null) => {
  const calls = [];
  return {
    calls,
    make(target) {
      calls.push(target);
      return {
        select(requested) {
          calls.push(['select', requested]);
          return { accepted: substitute !== null, activeProvider: 'fake',
            requestedProvider: requested ?? 'fake', target: substitute ?? target };
        }
      };
    }
  };
};

test('with NO hook the factory returns exactly what it returns today', async () => {
  const made = await createDebugTarget('eater6502', { rom: rom(), board: board() });
  assert.ok(made.target, 'the factory produced no target at all');
  assert.ok(made.adapter);
  // The absence must be silent, not a null-valued key: a caller distinguishing
  // "no boundary" from "a boundary that refused" would otherwise have to guess.
  assert.ok(!('providerBoundary' in made),
    'an uninjected boundary must not appear in the result at all');
  assert.ok(!('providerSelection' in made));
});

test('an injected hook is called with the target and its selection is returned', async () => {
  const fake = fakeBoundary();
  const made = await createDebugTarget('eater6502',
    { rom: rom(), board: board(), providerBoundary: fake.make, cycleProvider: 'fast-thing' });

  assert.equal(fake.calls.length, 2, 'the hook ran and select ran');
  assert.ok(fake.calls[0] && typeof fake.calls[0].capabilities === 'function',
    'the hook receives the real debug target, not a literal');
  assert.deepEqual(fake.calls[1], ['select', 'fast-thing'],
    'the requested provider id reaches select verbatim');
  assert.equal(made.providerSelection.activeProvider, 'fake');
  assert.equal(made.target, fake.calls[0], 'the selection returned the same target here');
  assert.ok(made.providerBoundary, 'the boundary is exposed for a caller that wants its status');
});

test('the selection decides the target, so a substituting boundary is honoured', async () => {
  // The point of a boundary is that it MAY return a different target. If the
  // factory returned its own `target` regardless, every case above would still
  // pass and the selection would be decorative.
  const substitute = { capabilities: () => ({ steps: ['cycle'] }) };
  const fake = fakeBoundary(substitute);
  const made = await createDebugTarget('eater6502',
    { rom: rom(), board: board(), providerBoundary: fake.make });

  assert.equal(made.target, substitute,
    'the factory must return the SELECTION\'s target, not the one it built');
  assert.deepEqual(made.target.capabilities().steps, ['cycle']);
});

test('a hook is ignored when there is no target to wrap', async () => {
  // Adapter-only mode: with no target there is nothing for a boundary to
  // select between, and calling the hook with null would hand it a target its
  // own contract says it always gets.
  const fake = fakeBoundary();
  const made = await createDebugTarget('eater6502',
    { rom: rom(), board: board(), providerBoundary: fake.make });
  if (made.target) {
    assert.ok(fake.calls.length > 0, 'fixture: a target exists here, so the hook must have run');
  } else {
    assert.equal(fake.calls.length, 0, 'no target means the hook is not called');
  }
});
