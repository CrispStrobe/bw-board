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
      + 'throws, and a case deleted by an edit.');
  });
});
