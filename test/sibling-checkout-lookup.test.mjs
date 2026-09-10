/**
 * THE ORACLE LOOKUP MUST REACH FROM A WORKTREE, NOT ONLY FROM A CLONE.
 *
 * Suites driven by a sibling checkout looked for it at `<repo>/../..`. That is
 * where it sits relative to a clone and NOT where it sits relative to a git
 * worktree, which lives one level deeper. The result was not a missing test but
 * a split one: green from the clone CI checks out, skipped in all 66 worktrees
 * on this box — that is, everywhere the work is actually done. A skip reads as
 * a deliberate exclusion, so nothing pointed at it.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ancestorCandidates } from './helpers/sibling-checkout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('ancestorCandidates', () => {
  it('offers a candidate at every level, nearest first, and stops at the root', () => {
    const list = ancestorCandidates('/a/b/c', ['x', 'y.txt'], 10);
    assert.equal(list[0], path.join('/a/b/c', 'x', 'y.txt'));
    assert.equal(list[1], path.join('/a/b', 'x', 'y.txt'));
    assert.equal(list[2], path.join('/a', 'x', 'y.txt'));
    assert.equal(list[3], path.join('/', 'x', 'y.txt'));
    assert.equal(list.length, 4, 'it kept walking past the filesystem root');
  });

  it('respects the level bound', () => {
    assert.equal(ancestorCandidates('/a/b/c/d/e/f/g', ['z'], 2).length, 3);
  });

  const RELATIVE = ['blinkenrocket-firmware', 'build', 'main.hex'];
  const FOUND = ancestorCandidates(HERE, RELATIVE).find(p => existsSync(p));

  it('reaches a sibling checkout from a WORKTREE, where a fixed depth cannot', {
    // SKIPPED BY NAME, never `assert.ok(true)`: a box without the oracle must
    // say so rather than contribute a pass to the summary. That is the whole
    // defect class this file is part of.
    skip: FOUND ? false : 'no blinkenrocket-firmware checkout above ' + HERE
  }, () => {
    const fixedDepth = path.join(HERE, '..', '..', ...RELATIVE);
    assert.ok(existsSync(FOUND), FOUND);
    if (existsSync(fixedDepth)) return;   // running from a clone: both work
    // Running from a WORKTREE — precisely the case that used to skip.
    assert.notEqual(path.resolve(FOUND), path.resolve(fixedDepth),
      'the walk found what the fixed depth could not');
  });
});
