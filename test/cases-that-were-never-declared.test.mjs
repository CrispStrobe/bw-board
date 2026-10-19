/**
 * A CASE THAT WAS NEVER DECLARED LEAVES NO LINE AT ALL.
 *
 * Every other instrument in this tree looks for something PRESENT and wrong: a
 * failing assertion, a skip that should have been a pass, a declaration that
 * disagrees with behaviour. Nothing looked for something ABSENT, and absence is
 * the quieter defect — a pass-shaped skip at least leaves a line someone can
 * grep, while a case that was never declared leaves only a test count nobody
 * compares across runs.
 *
 * TWO REAL INSTANCES, both found by scanning for the shape rather than by anyone
 * reporting them, because there was nothing to report — both files were green
 * either way:
 *
 *   end-to-end-dimmer   `# tests 1` for a file containing 2
 *   example-manifest    `# tests 1` without its oracle, `# tests 11` with it
 *
 * The shape is `it.skip('…'); return;` in a `describe` BODY: the early return
 * abandons the rest of the callback, so every case below it is never declared.
 *
 * WHAT THIS DOES NOT SEE, stated here and in the failure message because a gate
 * whose text names its own boundary cannot be mistaken for coverage it does not
 * have:
 *
 *   - CASES GENERATED FROM AN INPUT that produces nothing. A loop over an empty
 *     directory declares nothing and this scan sees no `return` at all. The
 *     remedy there is a case asserting the generator produced something —
 *     `example-manifest.test.js` carries one, and it is the pattern to copy.
 *   - A `describe` BODY THAT THROWS. The runner reports the failure, so it is
 *     not silent, but the cases below it are equally undeclared.
 *   - A case removed by an edit. Nothing here knows what used to exist.
 *   - A `return` inside a CASE body. A different shape with a different
 *     meaning, and **whether it is a silent skip or ordinary control flow
 *     cannot be decided from the shape**: `if (x) return;` after an assertion is
 *     fine, and the identical line before one checks nothing. A regex cannot
 *     tell "we already checked" from "we checked nothing". Two such lines in
 *     `emu8051-debug.test.js` were both real -- one silently passed on a build
 *     without the cycle step, the other was dead on every build we have -- but
 *     they were resolvable only by DRIVING two emulator builds and seeing which
 *     branch was unreachable. See the standing list below.
 */

/**
 * THE STANDING LIST: one-line conditional returns inside case bodies.
 *
 * Derived on master `6e0677a` -- a census names the tree it measured -- as a
 * one-line `if (...) return;` whose nearest enclosing block is a case rather
 * than a describe. **This is a reading list, not a defect list.** Most of these
 * are ordinary control flow. It lives here because whoever wonders about this
 * shape will be standing at this file.
 *
 *     ac-small-signal.test.mjs          156
 *     avr-attiny88.test.js              305, 396
 *     conformance-mismatch.test.js      24, 53, 59, 91, 97, 127, 159, 166
 *     emu8051-adapter.test.js           399
 *     example-pwm-preview.test.js       202, 212
 *     machine-checkpoint.test.mjs       232
 *     ngspice-diode.test.js             58, 88, 118, 146, 182
 *     rp2040-bootrom.test.mjs           719, 721, 742, 844, 846, 880, 882
 *     sibling-checkout-lookup.test.mjs  185
 *     sparse-lu.test.mjs                186
 *
 * THE UNIT OF WORK IS ONE FILE, and the question is: on the box where this
 * branch is taken, what did the case verify? -- answered by RUNNING it, not by
 * reading the line. A mass conversion would produce thirty plausible diffs, all
 * green on the box that wrote them.
 *
 * TWO ARE WORTH READING SOONER, not because their sites are likelier to be
 * defects but because both files are INSTRUMENTS other things are measured
 * with. Both were read when this list was written and neither is a defect
 * today:
 *
 *   sibling-checkout-lookup.test.mjs:185  `if (existsSync(fixedDepth)) return;`
 *       Honest, and it weakens the case on a CLONE: there the walk and the
 *       fixed depth agree, so the meaningful assertion -- that the walk found
 *       what a fixed depth could not -- does not run. On a worktree, and on CI
 *       where the oracle sits inside the workspace, it does.
 *   machine-checkpoint.test.mjs:232      `if (!validatesTime) return;`
 *       A per-machine capability flag, and the case asserts the BigInt refusal
 *       BEFORE it, so the early return skips an extra table rather than the
 *       whole case. It does mean a machine with `validatesTime` false
 *       contributes nothing to those rows.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './helpers/sibling-checkout.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/** A `return;` at the indentation of a describe callback's own statements. */
// The `m` flag, not Python's inline `(?m)` — JS has no inline flags, and the
// first draft of this file threw "Invalid group" at load, which node reports as
// the whole FILE failing rather than as a bad regex.
const BODY_RETURN = /^(\s{2,4})return;\s*$/m;

/**
 * Sites where a `return;` sits directly in a describe body.
 *
 * COMMENTS ARE STRIPPED FIRST. Both of us were fooled today by a file's own
 * prose about the shape it had just fixed — a document about a thing matches
 * every pattern meant for the thing, and the file that fixes a defect is the
 * one most likely to describe it.
 */
function bodyReturns(source) {
  const code = stripComments(source);
  const sites = [];
  for (const m of code.matchAll(new RegExp(BODY_RETURN.source, 'gm'))) {
    const before = code.slice(0, m.index);
    // A QUALIFIER IS ALLOWED ON BOTH, and its absence was a real blind spot: a
    // peer planted `test.describe(…) { test.it.skip(…); return; }` — the exact
    // shape, in the idiom node's own docs use — and this said nothing, because
    // `^\s*describe\(` does not match `test.describe(`. One file in this tree
    // already writes it that way. Found by someone else's probe, which is the
    // argument for handing a new gate to somebody who did not write it.
    const describes = [...before.matchAll(/^(\s*)(?:[\w$]+\.)?describe\(/gm)];
    const cases = [...before.matchAll(/^(\s*)(?:[\w$]+\.)?(it|test)\(/gm)];
    const lastDescribe = describes.at(-1);
    const lastCase = cases.at(-1);
    // Inside a case, `return` is ordinary control flow; inside a describe body
    // it abandons every declaration that follows.
    if (lastDescribe && (!lastCase || lastDescribe.index > lastCase.index)) {
      sites.push(before.split('\n').length);
    }
  }
  return sites;
}

describe('no case is abandoned before it is declared', () => {
  it('names the tree it measured', () => {
    // A CENSUS NAMES THE TREE IT MEASURED OR IT NAMES NOTHING. The scan that
    // found the second instance first ran while HEAD was another branch, and
    // its top hit named a line that did not exist in the tree being read.
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'],
      { cwd: TEST_DIR, encoding: 'utf8' }).trim();
    const files = readdirSync(TEST_DIR).filter(f => /\.(mjs|js)$/.test(f));
    console.log(`# scanned ${files.length} test files at ${sha}`);
    assert.ok(files.length > 20, `only ${files.length} test files — is TEST_DIR right?`);
  });

  it('the pattern matches the shape and not the remedy', () => {
    // Fired at CONSTRUCTED text, never at this file: the pattern is defined
    // here, so this file's own source is in the haystack.
    const shape = "describe('x', () => {\n  if (!ok) {\n    it.skip('nope');\n    return;\n  }\n";
    const remedy = "describe('x', () => {\n  it('a', {skip: SKIP}, () => {\n    return;\n  });\n";
    assert.deepEqual(bodyReturns(shape), [4], 'the pattern no longer matches the shape');
    assert.deepEqual(bodyReturns(remedy), [], 'the pattern claims a return inside a CASE');
  });

  it('the qualified idiom counts too — test.describe, not just describe', () => {
    // The blind spot a peer found by planting a probe I had not thought to
    // write. Both spellings are the same defect and the gate saw one of them.
    const qualified = "test.describe('probe', () => {\n  test.it.skip('oracle missing');\n  return;\n});\n";
    assert.deepEqual(bodyReturns(qualified), [3],
      'a qualified describe is still a describe; its body abandons the same way');
  });

  it('a return inside a comment is not a return', () => {
    const prose = "describe('x', () => {\n  /* this used to do\n    return;\n  */\n  it('a', () => {});\n";
    assert.deepEqual(bodyReturns(prose), []);
  });

  it('no test file abandons a describe body', () => {
    const offenders = [];
    for (const name of readdirSync(TEST_DIR).filter(f => /\.(mjs|js)$/.test(f))) {
      if (name === 'cases-that-were-never-declared.test.mjs') continue;   // builds the shape on purpose, above
      for (const line of bodyReturns(readFileSync(join(TEST_DIR, name), 'utf8'))) {
        offenders.push(`${name}:${line}`);
      }
    }

    assert.deepEqual(offenders, [],
      `${offenders.join(', ')} returns from a DESCRIBE BODY, so every case below it is `
      + 'never declared — not skipped, absent, leaving only a test count nobody compares '
      + 'across runs. Give each case its own `skip:` instead. NOTE WHAT THIS CHECK DOES '
      + 'NOT SEE: cases generated from an input that yields nothing (assert the generator '
      + 'produced something, as example-manifest.test.js does), a describe body that '
      + 'throws, a case deleted by an edit, and a `return` inside a CASE body — that '
      + 'last one is a different shape whose meaning cannot be read off the shape, and '
      + 'the standing list of them is in this file\'s header.');
  });
});
