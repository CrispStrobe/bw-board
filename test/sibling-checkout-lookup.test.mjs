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
  // some of them appeared to work — because `code/wt/emu8051-stc` is a SYMLINK
  // to `code/emu8051-stc`, added 2026-09-03. Someone hit this defect three
  // weeks ago and fixed it in the FILESYSTEM instead of in the lookup. Measured
  // from a worktree one level deeper, where the symlink does not help: 22 cases
  // stopped running.
  //
  // TWO SPELLINGS, AND THE FIRST VERSION OF THIS GATE SAW ONLY ONE. It matched
  // two SEPARATE arguments — `join(HERE, '..', '..', 'x')` — and was blind to
  // `'../../x'`, which is the form nineteen files in this directory actually
  // use. It reported zero offenders while the tree was full of them: a census
  // that is vacuous against the real population reads exactly like a clean one.
  //
  // SO IT IS A RATCHET, not a pass/fail gate: widening it reds nineteen files
  // at once, which is not a reviewable change. The expected set is asserted BY
  // NAME in both directions — a new fixed-depth lookup reds it, and converting
  // one reds it too, saying to take the name off the list. Terminal value:
  // empty.
  const TEST_DIR = HERE;

  // Each spelling carries its own example AND counter-example. A pattern that
  // covers two forms needs two positive cases, or you widen it, catch one, and
  // believe you caught both — which is exactly what happened here.
  const SPELLINGS = [
    {
      what: 'two separate arguments',
      re: /['"]\.\.['"]\s*,\s*['"]\.\.['"]/,
      example: "const C = [join(HERE, '..', '..', 'emu8051-stc', 'build', 'emu8051.js')];",
      counter: "const C = ancestorCandidates(HERE, ['emu8051-stc', 'build', 'emu8051.js']);"
    },
    {
      what: 'one string',
      re: /['"](?:\.\.\/)+\.\.\//,
      example: "for (const p of ['../../emu8051-stc/build/emu8051.js']) {",
      counter: "for (const p of ancestorCandidates(HERE, ['emu8051-stc'])) {"
    }
  ];

  // The holder builds both shapes ON PURPOSE, to fire the patterns at them.
  // Named, with its reason, never a pattern — an exemption list is the one part
  // of a census that grows silently.
  const EXEMPT = new Set(['sibling-checkout-lookup.test.mjs']);

  // THE RATCHET. Exact names, not a count: a count cannot tell "one converted
  // and one added" from "nothing happened".
  const EXPECTED_OFFENDERS = [
    'brightness-emu8051.test.js',
    'conformance-real-wasm.test.js',
    'debug-factory.test.js',
    'device-drivers-e2e.test.js',
    'emu8051-debug.test.js',
    'end-to-end-dimmer.test.js',
    'example-bundles.test.js',
    'example-buzzer.test.js',
    'example-dimmer.test.js',
    'example-manifest.test.js',
    'example-pwm-preview.test.js',
    'example-seven-segment.test.js',
    'example-shift-register.test.js',
    'motor-e2e.test.js',
    'multimeter-chain.test.mjs',
    'rung8-serial-reads.test.js',
    'serial-debug-e2e.test.js',
    'servo-e2e.test.js',
    'stc89c52-demos.test.mjs'
  ];

  const offendersNow = () => readdirSync(TEST_DIR)
    .filter(name => /\.(mjs|js)$/.test(name) && !EXEMPT.has(name))
    .filter(name => {
      const source = readFileSync(join(TEST_DIR, name), 'utf8');
      return SPELLINGS.some(s => s.re.test(source));
    })
    .sort();

  for (const spelling of SPELLINGS) {
    it(`the ${spelling.what} pattern matches its shape and not the remedy`, () => {
      // Fired at CONSTRUCTED text, never at this file: the patterns are DEFINED
      // here, so this file's own source is in the haystack and any regex
      // matches the line that declares it. Measured on the earlier version —
      // /NEVERMATCHESANYTHING/ left the check green because the file then
      // contained that word.
      assert.ok(spelling.re.test(spelling.example),
        `the pattern no longer matches: ${spelling.example}`);
      assert.ok(!spelling.re.test(spelling.counter),
        `the pattern matches the remedy: ${spelling.counter}`);
    });
  }

  it('the spellings are distinct, so one cannot stand in for the other', () => {
    // Without this, collapsing both entries to the same regex passes every
    // check above while halving the population the gate can see.
    const [two, one] = SPELLINGS;
    assert.ok(!two.re.test(one.example), 'the two-argument pattern claims the one-string form');
    assert.ok(!one.re.test(two.example), 'the one-string pattern claims the two-argument form');
  });

  it('the exemption is one named file, not a widening pattern', () => {
    // Measured: replacing this set with every filename in the directory reds
    // nothing, because an all-exempt scan has no offenders and deepEqual([],[])
    // passes. So its exact contents are asserted.
    assert.deepEqual([...EXEMPT], ['sibling-checkout-lookup.test.mjs'],
      'this holder builds both shapes on purpose and is the only file that may. '
      + 'Adding a name here removes a file from the scan — say why in the commit, '
      + 'and never exempt by pattern.');
  });

  it('the offender list is exactly what is on the ratchet, in both directions', () => {
    const now = offendersNow();
    const added = now.filter(n => !EXPECTED_OFFENDERS.includes(n));
    const converted = EXPECTED_OFFENDERS.filter(n => !now.includes(n));

    assert.deepEqual(added, [],
      `${added.join(', ')} reaches for a sibling checkout at a FIXED depth. That is where one `
      + 'sits relative to a CLONE and never relative to a git WORKTREE, which lives a level '
      + "deeper — so CI keeps the suite and every lane loses it, as a '# skipped' that reads "
      + 'like a deliberate exclusion. Use ancestorCandidates() from ./helpers/sibling-checkout.mjs.');

    assert.deepEqual(converted, [],
      `${converted.join(', ')} no longer uses a fixed depth — take ${converted.length === 1
        ? 'that name' : 'those names'} off EXPECTED_OFFENDERS in this file. The ratchet only `
      + 'falls, and it falls by being edited deliberately.');
  });

  it('the ratchet is not already empty, so the assertions above are exercised', () => {
    // The day this reds is the day the list is empty and this whole block,
    // EXPECTED_OFFENDERS included, comes out — leaving the plain assertion that
    // no file uses a fixed depth.
    assert.ok(EXPECTED_OFFENDERS.length > 0,
      'the ratchet reached zero: delete EXPECTED_OFFENDERS and assert offendersNow() is empty');
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
