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
import { existsSync, readFileSync } from 'node:fs';
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
        assert.ok(['oracle', 'fixture'].includes(i.kind), `${i.id}: kind must be oracle or fixture`);
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
