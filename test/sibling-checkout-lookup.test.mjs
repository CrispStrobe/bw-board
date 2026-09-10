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
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ancestorCandidates } from './helpers/sibling-checkout.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

describe('no suite reaches for a sibling checkout at a FIXED depth', () => {
  // THE POPULATION, NOT THE INSTANCE. Two suites looked for a firmware at
  // `<repo>/../..` and four more looked for the emu8051 wasm there. On this box
  // the second group appeared to work — because `code/wt/emu8051-stc` is a
  // SYMLINK to `code/emu8051-stc`, added 2026-09-03. Someone hit this defect
  // three weeks ago and fixed it in the FILESYSTEM instead of in the lookup, so
  // four suites (replay-surface-conformance among them) rested on undeclared
  // state that a cleanup would remove. Measured from a worktree one level
  // deeper, where the symlink does not help: 22 cases stopped running.
  //
  // So the check is over the whole directory rather than over the files anyone
  // remembers. A new suite that copies the old shape reddens this, and the
  // message says what to use instead.
  const TEST_DIR = HERE;
  const FIXED_DEPTH = /['"]\.\.['"]\s*,\s*['"]\.\.['"]/;
  // The holder below builds the old shape ON PURPOSE, to assert the walk finds
  // what it cannot. Named, with its reason, rather than pattern-excluded.
  const EXEMPT = new Set(['sibling-checkout-lookup.test.mjs']);

  it('and the scan can see the shape at all', () => {
    // A census whose pattern matches nothing proves nothing. This asserts the
    // regex fires on the one file that deliberately contains the shape.
    const holder = readFileSync(join(TEST_DIR, 'sibling-checkout-lookup.test.mjs'), 'utf8');
    assert.ok(FIXED_DEPTH.test(holder), 'the pattern no longer matches its own example');
  });

  it('every other test file uses the walk', () => {
    const offenders = readdirSync(TEST_DIR)
      .filter(name => /\.(mjs|js)$/.test(name) && !EXEMPT.has(name))
      .filter(name => FIXED_DEPTH.test(readFileSync(join(TEST_DIR, name), 'utf8')));

    assert.deepEqual(offenders, [],
      `${offenders.join(', ')} reaches for a path two levels up. That is where a sibling `
      + 'checkout sits relative to a CLONE and never relative to a git WORKTREE, which lives '
      + "one level deeper — so CI keeps the suite and every lane loses it, as a '# skipped' "
      + 'that reads like a deliberate exclusion. Use ancestorCandidates() from '
      + './helpers/sibling-checkout.mjs'.replace(/^/, '') + '.');
  });
});

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

  // THE DEFAULT DEPTH IS LOAD-BEARING AND NOTHING HELD IT. Measured on this
  // tree: changing `levels = 6` to `levels = 0` reddens NOTHING and moves the
  // skip count from 3 to 5 — two suites stop running and the summary still
  // reads `# fail 0`. That is the exact failure this helper exists to end, so
  // the default gets an assertion of its own rather than living on the
  // signature line where a reasonable-looking edit can silently narrow it.
  //
  // Seven candidates (levels 0..6) is what a worktree needs: test/ -> repo ->
  // code/wt -> code -> volume1 -> mnt -> /. A caller that wants less says so.
  it('the DEFAULT depth reaches past a worktree, not just an explicit one', () => {
    assert.equal(ancestorCandidates('/mnt/volume1/code/wt/lane/test', ['x']).length, 7,
      'the default must climb far enough to leave a worktree without being asked');
    assert.ok(ancestorCandidates('/mnt/volume1/code/wt/lane/test', ['x'])
      .includes('/mnt/volume1/code/x'), 'and must reach the sibling level itself');
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
