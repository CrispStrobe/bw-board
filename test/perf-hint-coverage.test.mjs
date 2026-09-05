/**
 * EVERY WALL-CLOCK ASSERTION CARRIES ITS DISCRIMINATOR.
 *
 * A sweep fixes the files that exist today. This is what stops the next one
 * arriving without the hint -- the difference between a cleanup and a rule.
 *
 * THE SET IS DERIVED, NOT LISTED, which is the whole point. A curated list of
 * "the perf tests" would go stale the moment someone adds a timing assertion
 * to a file nobody thought of as a perf test, and its green would then be a
 * statement about the list rather than about the suite.
 *
 * WHAT COUNTS AS LOAD-SENSITIVE: a variable assigned from `performance.now()`
 * or `Date.now()` whose name then appears in an assertion. Derived that way on
 * 2026-09-05 because a keyword sweep flagged 13 files and all but five were
 * using `elapsed` for EMULATED time -- T-states in contention-vectors,
 * simulated milliseconds in device-555. Those are deterministic. Warning about
 * them would be noise, and noise is how a real warning gets skimmed past.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { perfHint } from './helpers/perf-hint.mjs';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

/** Variables in `src` assigned from a wall-clock read. */
const wallClockVars = (src) => {
    const out = new Set();
    for (const m of src.matchAll(
        /(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*[^;\n]*(?:performance\.now|Date\.now)/g
    )) out.add(m[1]);
    return out;
};

/** Lines in `src` that assert on one of `vars`. */
const assertionsUsing = (src, vars) => src.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\bassert\b/.test(line)
        && [...vars].some((v) => new RegExp(`\\b${v}\\b`).test(line)));

const testFiles = () => readdirSync(TEST_DIR)
    .filter((f) => /\.test\.(mjs|js)$/.test(f))
    .map((f) => ({ name: f, src: readFileSync(join(TEST_DIR, f), 'utf8') }));

test('the extractor still finds wall-clock assertions at all', () => {
    // Species 1: an extractor that stopped matching yields an empty set, and
    // an empty set is trivially "all covered". Prove it reaches something
    // before drawing any conclusion from its silence.
    const found = testFiles().filter((f) => wallClockVars(f.src).size > 0);
    assert.ok(found.length >= 5,
        `the wall-clock extractor found ${found.length} file(s); expected at least 5. ` +
        'It has probably stopped matching, and an empty result reads as full coverage.');
});

test('every wall-clock assertion carries the environment discriminator', () => {
    const missing = [];
    for (const { name, src } of testFiles()) {
        const vars = wallClockVars(src);
        if (!vars.size) continue;
        const hinted = src.includes('perfHint');
        for (const { line, n } of assertionsUsing(src, vars)) {
            if (hinted) continue;
            missing.push(`${name}:${n}  ${line.trim().slice(0, 78)}`);
        }
    }
    assert.deepEqual(missing, [],
        '\n  A WALL-CLOCK ASSERTION WITHOUT ITS DISCRIMINATOR:\n    ' + missing.join('\n    ') +
        '\n\n  A loaded box produces these failures with the engine untouched, and the' +
        '\n  reader meets the test through its failure, not through its header. Import' +
        '\n  perfHint from ./helpers/perf-hint.mjs and append it to the message.' +
        '\n  If the value is EMULATED time rather than wall-clock, rename it so it does' +
        '\n  not read as a stopwatch -- this gate keys on a real `performance.now()`.\n');
});

test('the hint itself still says the two things that make it useful', () => {
    // A hint that lost its discriminator is decoration. It has to name the
    // likely cause AND the action that settles it.
    const h = perfHint('X');
    assert.match(h, /CHECK THE MACHINE/, 'names the likely cause');
    assert.match(h, /run THIS FILE ALONE/, 'names the action that discriminates');
});
