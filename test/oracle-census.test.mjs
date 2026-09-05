/**
 * The census must not become fiction.
 *
 * `scripts/oracle-census.mjs` reports which external inputs are present and
 * therefore which checks would run. Its whole value is that a reader can trust
 * it instead of reading 42 skip lines — so its failure mode is not being
 * wrong, it is being STALE: an env var nothing reads any more, a path that
 * moved, a gate file that was deleted or renamed. It would keep reporting
 * cheerfully, and it would be believed, because a census is exactly the kind
 * of output nobody re-derives.
 *
 * So every claim it makes about the tree is checked against the tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, basename } from 'node:path';
import { INPUTS, resolve } from '../scripts/oracle-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every file the census claims to gate actually exists', () => {
    for (const input of INPUTS) {
        assert.ok(input.gates.length, `${input.id} gates nothing — delete the row or name its gates`);
        for (const g of input.gates) {
            assert.ok(existsSync(join(ROOT, g)),
                `${input.id} names "${g}", which is not in the tree. The census is reporting on `
                + 'a file that no longer exists.');
        }
    }
});

test('every gated file actually mentions the thing the census detects', () => {
    // THIS IS THE ANTI-DRIFT CHECK, and it is checked in BOTH directions
    // because one direction alone is not enough. My first version asked only
    // "does each gate mention at least one key", which a renamed env var
    // survives: the gates still mention the default PATH, `some()` is
    // satisfied, and the census goes on offering a variable nothing reads —
    // which matters, because `resolve()` prefers env over path, so a stale
    // name silently disables the override. Mutation caught it; the reasoning
    // that wrote it did not.
    for (const input of INPUTS) {
        const keys = [input.env, ...input.paths.map((p) => basename(dirname(p)) || basename(p))]
            .filter(Boolean);
        assert.ok(keys.length, `${input.id} has no detectable key at all`);
        const sources = input.gates.map((g) => readFileSync(join(ROOT, g), 'utf8'));

        // (a) every gate consults SOMETHING about this input.
        input.gates.forEach((g, i) => {
            assert.ok(keys.some((k) => sources[i].includes(k)),
                `${g} is listed as gated on ${input.id}, but mentions none of [${keys.join(', ')}]. `
                + 'Either the census is stale or the gate stopped consulting the input.');
        });

        // (b) every KEY the census detects on is consulted by SOMETHING.
        for (const k of keys) {
            assert.ok(sources.some((src) => src.includes(k)),
                `${input.id} detects on "${k}", which none of its gates mention. A detection key `
                + 'nothing reads makes the census report on a condition that has no effect.');
        }
    }
});

test('ids are unique and every input declares its CI status', () => {
    const ids = INPUTS.map((i) => i.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate id in the census');
    for (const i of INPUTS) {
        // THREE KINDS, AND THE LIST IS ENUMERATED SO ADDING ONE IS DELIBERATE.
        // This guard refused `service` when it was first added, which is the
        // behaviour wanted: a new kind changes what `present` MEANS for the
        // rows carrying it, and that is not a thing to slip in.
        //
        //   oracle   an independent source of truth; absent = a claim rests on
        //            our own opinion
        //   fixture  data a check needs to run at all; absent = the check did
        //            not happen
        //   service  reachability, not a file. `present` is ALWAYS false: the
        //            census refuses to probe the network, so it never
        //            establishes one locally. `ciAvailable` carries the real
        //            answer. See resolve().
        assert.ok(['oracle', 'fixture', 'service'].includes(i.kind),
            `${i.id}: kind must be oracle, fixture or service`);
        if (i.kind === 'service') {
            assert.equal(resolve(i).present, false,
                `${i.id} is a service, so present must be false — the census does not `
                + 'probe reachability, and a true here would claim something it never checked');
        }
        assert.ok(i.what && i.obtain && i.ci,
            `${i.id} must say what it proves, how to obtain it, and whether CI has it — `
            + 'an entry without those is a name, not a census row');
    }
});

test('--require fails on an absent input and passes on a present one', () => {
    // The behaviour the CI gate depends on, asserted rather than assumed:
    // without this, a job could "require" a suite it never got and stay green.
    const run = (args) => {
        try {
            execFileSync(process.execPath, [join(ROOT, 'scripts/oracle-census.mjs'), ...args],
                { encoding: 'utf8', stdio: 'pipe' });
            return 0;
        } catch (e) { return e.status; }
    };
    const present = INPUTS.find((i) => resolve(i).present);
    const absent = INPUTS.find((i) => !resolve(i).present);

    assert.equal(run([]), 0, 'a plain census must not fail');
    if (present) assert.equal(run(['--require', present.id]), 0,
        `--require ${present.id} should pass: it is present`);
    if (absent) assert.equal(run(['--require', absent.id]), 1,
        `--require ${absent.id} should EXIT 1: it is absent, and that is the whole point`);
    assert.equal(run(['--require', 'no-such-input']), 2, 'an unknown id is a usage error');
});

test('ciAvailable agrees with the reason it sits beside', () => {
    // THE BOOLEAN IS EXPLICIT DATA, NOT PARSED PROSE -- and that is exactly why
    // it can drift from the sentence next to it. A consumer reading
    // `ciAvailable` while a human reads `ci` is two sources of truth, which is
    // the shape this whole file exists to refuse.
    //
    // Added when the language-device-matrix lane asked for a boolean rather
    // than regex my English. Giving them one moves the parsing into this tool,
    // where it can be guarded; leaving it prose-only would have moved a
    // fragile parse into theirs.
    for (const i of INPUTS) {
        const saysYes = /^yes\b/i.test(i.ci.trim());
        assert.equal(i.ciAvailable, saysYes,
            `${i.id}: ciAvailable=${i.ciAvailable} but the reason begins `
            + `"${i.ci.trim().slice(0, 40)}". A consumer reading the boolean and a `
            + 'human reading the sentence would disagree about whether this claim stands.');
    }
});

test('every input declares ciAvailable, so a consumer never sees undefined', () => {
    // A missing boolean is falsy, so a new row without one silently reads as
    // "not in CI" -- an omission that looks like an answer.
    for (const i of INPUTS) {
        assert.equal(typeof i.ciAvailable, 'boolean',
            `${i.id} has no ciAvailable; a consumer would read undefined as false `
            + 'and record a standing claim as merely recorded');
    }
});

test('--snapshot rows are EXACTLY --json rows, and the sha is real', () => {
    // THE SNAPSHOT MUST NOT BE A SECOND IMPLEMENTATION. brickwright-lite ships
    // docs/generated/oracle-census.json and derives a standing-versus-recorded
    // column from it. If --snapshot ever summarised, reduced or reordered
    // relative to --json, lite would be reasoning from semantics that exist
    // nowhere else and no test would cover -- the exact arrangement this whole
    // exchange was meant to avoid.
    //
    // So: identical rows, and a real HEAD sha, because "standing" alone rots
    // the moment CI changes while "standing as of sha X" stays checkable.
    const dir = mkdtempSync(join(tmpdir(), 'census-snap-'));
    try {
        const out = join(dir, 'snap.json');
        const run = (args) => execFileSync(process.execPath,
            [fileURLToPath(new URL('../scripts/oracle-census.mjs', import.meta.url)), ...args],
            { encoding: 'utf8' });
        run(['--snapshot', out]);
        const snap = JSON.parse(readFileSync(out, 'utf8'));
        const plain = JSON.parse(run(['--json']));

        assert.deepEqual(snap.rows, plain,
            '--snapshot rows differ from --json rows; lite would derive its matrix '
            + 'from a shape nothing else produces');
        assert.match(snap.source.sha, /^[0-9a-f]{40}$/,
            `snapshot sha is "${snap.source.sha}" -- without a real sha a stale `
            + 'matrix is merely old rather than detectable');
        assert.match(snap.source.read, /^\d{4}-\d{2}-\d{2}$/);
        assert.equal(snap.source.repo, 'https://github.com/CrispStrobe/bw-board');
        // A consumer pinned to an older bw-board gets an older SHAPE. It must
        // be able to detect that rather than read a missing field as a value:
        // pre-be0e881 snapshots have no ciAvailable, and undefined is falsy,
        // so every claim would read as "recorded" including the standing ones.
        assert.equal(typeof snap.schema, 'number',
            'the envelope carries no schema version, so a consumer cannot tell an '
            + 'old snapshot from one missing a field it needs');
        assert.ok(snap.schema >= 1);
        for (const r of snap.rows) {
            assert.equal(typeof r.ciAvailable, 'boolean',
                `schema ${snap.schema} promises ciAvailable on every row; ${r.id} has none`);
        }
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
