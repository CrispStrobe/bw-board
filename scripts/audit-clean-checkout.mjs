/**
 * RUN THE TESTS AGAINST WHAT GIT ACTUALLY HAS.
 *
 * `test/reseat-gate.test.mjs` climbs directories looking for a sibling git
 * worktree and reads three fixtures tracked in NO repository. Two people ran
 * the full suite -- uncapped, real exit codes, no pipes -- and both got green.
 * CI could never go green, and nothing in either passing run distinguished the
 * two cases. That is the failure this script exists to make impossible.
 *
 * IT DOES NOT DETECT. An earlier attempt here preloaded a module that wrapped
 * `fs` and recorded every path resolved, on the theory that a lexical scan
 * cannot see a path built at run time by a loop. It could not work, and the
 * reason is worth keeping: the test does `import { statSync } from 'node:fs'`,
 * and an ESM named import binds to the function directly, so patching the `fs`
 * object afterwards intercepts nothing. It reported "0 findings" against the
 * very file it was written to catch -- a detector that could not fail, written
 * while hunting gates that cannot fail.
 *
 * So this reproduces CI's condition instead of modelling it: `git archive
 * HEAD` into a temporary directory is EXACTLY the tracked tree and nothing
 * else, with no sibling worktrees above it and no untracked leftovers in it.
 * A test that needs either fails there and passes at home, which is the whole
 * signal.
 *
 * `node_modules` is symlinked rather than copied: dependencies are not the
 * subject, and a fresh install would take longer than the suite.
 *
 * WHAT A FAILURE MEANS. Not "this test is wrong" -- a test may legitimately
 * need a large corpus checked out beside the repo. It means the dependency is
 * UNDECLARED. Commit the fixture, or make the test skip explicitly and
 * loudly when the path is absent, so an absent corpus reads as a skip and
 * never as a pass.
 *
 * Usage:
 *   node scripts/audit-clean-checkout.mjs test/reseat-gate.test.mjs [...]
 *   node scripts/audit-clean-checkout.mjs --all
 *
 * @module
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const argv = process.argv.slice(2);
const all = argv.includes('--all');
const wanted = argv.filter((a) => !a.startsWith('--'));

const files = all
    ? readdirSync(join(ROOT, 'test')).filter((f) => /\.test\.m?js$/.test(f))
        .map((f) => join('test', f))
    : wanted.map((f) => relative(ROOT, resolve(f)));

if (!files.length) {
    console.error('give test files, or --all');
    process.exit(2);
}

/** `packages/<x>/node_modules` and the like — one level of nesting is what
 *  this monorepo has, and a deeper search would spend its time in the trees
 *  it is about to symlink. */
function nestedNodeModules () {
    const out = [];
    for (const top of ['packages', 'overlay']) {
        const dir = join(ROOT, top);
        if (!existsSync(dir)) continue;
        for (const e of readdirSync(dir)) {
            const cand = join(dir, e, 'node_modules');
            try { if (statSync(cand).isDirectory()) out.push(join(top, e, 'node_modules')); }
            catch { /* none here */ }
        }
    }
    return out;
}

const work = mkdtempSync(join(tmpdir(), 'clean-checkout-'));
try {
    // EXACTLY THE TRACKED TREE. `git archive` cannot include an untracked
    // file, which is the point: if a fixture is missing here it was missing
    // from the repository all along.
    execFileSync('bash', ['-c',
        `git -C ${JSON.stringify(ROOT)} archive HEAD | tar -x -C ${JSON.stringify(work)}`],
    {stdio: 'inherit'});

    // EVERY node_modules, not just the root one. This is a monorepo: the
    // first version symlinked `<root>/node_modules` alone and a test importing
    // `packages/scratch-gui/src/lib/sb3-creator.js` failed with "Cannot find
    // package 'jszip'" -- which the audit then reported as a missing FIXTURE.
    // An absent dependency and an absent fixture are different faults and the
    // gate must not confuse them, or it names the victim instead of the cause,
    // which is the shape it exists to stop.
    for (const rel of ['node_modules', ...nestedNodeModules()]) {
        const src = join(ROOT, rel);
        if (!existsSync(src)) continue;
        const dst = join(work, rel);
        mkdirSync(dirname(dst), {recursive: true});
        try { symlinkSync(src, dst, 'dir'); } catch { /* already there */ }
    }

    console.log(`clean checkout at ${work}\n`);
    let failed = 0;
    for (const rel of files) {
        if (!existsSync(join(work, rel))) {
            console.log(`  FAIL ${rel}: the TEST FILE itself is not tracked`);
            failed++; continue;
        }
        const r = spawnSync(process.execPath, ['--test', rel],
            {cwd: work, encoding: 'utf8', maxBuffer: 1 << 28});
        const pass = /^# fail 0$/m.test(r.stdout || '') && r.status === 0;
        if (pass) { console.log(`  ok   ${rel}`); continue; }
        failed++;
        const why = (r.stdout || '').match(/^ *(?:error|code): .*$/gm) || [];
        console.log(`  FAIL ${rel}  (exit ${r.status})`);
        for (const line of why.slice(0, 3)) console.log(`       ${line.trim()}`);
    }
    console.log(`\n${files.length} file(s) run from the tracked tree; ${failed} failed.`);
    if (failed) {
        console.error('These pass here and cannot pass from a clean checkout: they depend on '
            + 'files git does not have, or on paths outside the repository. Commit the '
            + 'fixture, or make the test SKIP loudly when it is absent — an absent fixture '
            + 'must never read as a pass.');
        process.exit(1);
    }
} finally {
    rmSync(work, {recursive: true, force: true});
}
