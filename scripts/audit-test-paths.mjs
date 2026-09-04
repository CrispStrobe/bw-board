/**
 * A TEST THAT READS OUTSIDE THE REPOSITORY IS GREEN WHERE IT WAS WRITTEN AND
 * RED EVERYWHERE ELSE, and nothing in a passing run says which you have.
 *
 * `test/reseat-gate.test.mjs` climbs directories looking for a sibling git
 * worktree and reads three fixtures tracked in no repository. Two people ran
 * the suite, uncapped, with real exit codes, and got green; CI could never
 * have gone green, and the difference was invisible to both of them. This is
 * the check that makes the difference visible.
 *
 * IT RUNS THE TESTS AND WATCHES, rather than reading them. The escape is built
 * at run time by a loop that stats candidates, so no lexical scan can see it.
 * `test/helpers/path-audit.mjs` is preloaded and records every path the
 * process really resolved; this script judges the record.
 *
 * TWO VERDICTS:
 *   OUTSIDE    resolved above the repository root -- unavailable to anyone who
 *              has only this repo.
 *   UNTRACKED  inside the repo but unknown to git -- available to whoever
 *              generated it and to nobody else. A file under `test/fixtures/`
 *              looks committed and need not be.
 *
 * DECLARING, NOT SILENCING. A test with a genuine reason to reach outside
 * (a large corpus checked out beside the repo) marks itself:
 *
 *     // path-audit-allow: <why, and what happens when the path is absent>
 *
 * The reason is required and must say what the test does when the path is not
 * there -- because "skips cleanly" and "passes vacuously" are the two
 * possibilities and only one of them is acceptable. A marker with no reason is
 * rejected, so the exemption cannot become a habit.
 *
 * Usage:
 *   node scripts/audit-test-paths.mjs                 # every test file
 *   node scripts/audit-test-paths.mjs test/foo.test.mjs [...]
 *
 * @module
 */
import { readFileSync, readdirSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const PRELOAD = join(ROOT, 'test', 'helpers', 'path-audit.mjs');

const argv = process.argv.slice(2);
const files = argv.length ? argv.map((f) => resolve(f))
    : readdirSync(join(ROOT, 'test'))
        .filter((f) => /\.test\.m?js$/.test(f))
        .map((f) => join(ROOT, 'test', f));

/** Every path git knows about, as absolutes. */
const tracked = new Set(
    execFileSync('git', ['-C', ROOT, 'ls-files'], {encoding: 'utf8', maxBuffer: 1 << 28})
        .split('\n').filter(Boolean).map((p) => join(ROOT, p)));

/** `// path-audit-allow: reason` — the reason is mandatory. */
const declarationOf = (file) => {
    const m = readFileSync(file, 'utf8').match(/path-audit-allow:[ \t]*(.+)/);
    if (!m) return null;
    const reason = m[1].trim();
    return reason.length >= 20 ? reason : '';   // '' = present but not a reason
};

let failed = 0, checked = 0;
for (const file of files) {
    const rel = relative(ROOT, file);
    const out = join(ROOT, `.path-audit-${process.pid}.tsv`);
    if (existsSync(out)) unlinkSync(out);

    const r = spawnSync(process.execPath,
        ['--import', PRELOAD, '--test', file],
        {cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 28,
            env: {...process.env, PATH_AUDIT_OUT: out, PATH_AUDIT_ROOT: ROOT}});

    // A test file that cannot RUN tells us nothing about its paths, and
    // reporting it clean would be the very failure this script is about.
    if (!existsSync(out)) {
        console.log(`  ?? ${rel}: the preload produced no record (exit ${r.status}) — NOT audited`);
        failed++; continue;
    }
    const rows = readFileSync(out, 'utf8').split('\n').filter(Boolean)
        .map((l) => l.split('\t'));
    unlinkSync(out);
    checked++;

    const outside = [...new Set(rows.filter((x) => x[0] === 'OUT').map((x) => x[1]))];
    const untracked = [...new Set(rows.filter((x) => x[0] === 'IN').map((x) => x[1]))]
        .filter((p) => !tracked.has(p))
        // Build products and the audit's own scratch file are not fixtures.
        .filter((p) => !/[\\/](rom|dist|coverage|\.git)[\\/]/.test(p))
        .filter((p) => !p.includes('.path-audit-'));

    if (!outside.length && !untracked.length) continue;

    const declared = declarationOf(file);
    if (declared) {
        console.log(`  ok ${rel}: declared — ${declared}`);
        continue;
    }
    failed++;
    console.log(`  FAIL ${rel}${declared === '' ? '  (marker present but no reason given)' : ''}`);
    for (const p of outside.slice(0, 5)) {
        console.log(`       OUTSIDE   ${p}`);
    }
    for (const p of untracked.slice(0, 5)) {
        console.log(`       UNTRACKED ${relative(ROOT, p)}`);
    }
}

console.log(`\naudited ${checked} of ${files.length} test file(s); ${failed} with findings.`);
if (failed) {
    console.error('A path outside the repo, or a file git does not have, is available only on '
        + 'the machine that has it. Commit the fixture, or declare the dependency with '
        + '`// path-audit-allow: <reason>` saying what happens when it is absent.');
    process.exit(1);
}
