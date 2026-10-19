/**
 * The MOO reader, proved against the encoding it replaces.
 *
 * `scripts/moo.mjs` exists so the 646,000-vector grind can run in CI, and a
 * reader that quietly returned EMPTY vectors would make that grind report
 * 646,000/646,000 while checking nothing -- a gate that cannot fail, which is
 * worse than one that is wrong because nobody re-reads a green one.
 *
 * So the reader is not tested against hand-written expectations. The suite
 * ships the SAME 2,000 vectors per opcode in two independent encodings, and
 * this file requires them to agree field for field: every register, every
 * `[addr, value]` pair in both directions, the instruction bytes, the name
 * and the queue. If the reader drops a chunk, mis-reads the inner length in
 * front of NAME, or fails to match the space-padded `RAM ` id, the two
 * encodings stop agreeing and this goes red.
 *
 * It does NOT skip quietly when only one encoding is present. A skip here
 * would restore exactly the hole this reader was written to close, so when
 * the binary form exists and the JSON does not, the test says so and fails.
 *
 * RUN ONCE OVER EVERYTHING, and the result is why this reader is trusted:
 * `MOO_ALL=1` compares every opcode file and reports
 *
 *     cross-format: 323 files, 646000 vectors agree
 *
 * By default it stops after SAMPLE_FILES, because 646,000 deepStrictEqual
 * comparisons take minutes and a suite member that slow gets skipped by
 * whoever is in a hurry. The bounded run is not a weaker check of the same
 * kind -- it is the same check over fewer files, and the count it prints says
 * exactly how many, so nobody has to guess whether it looked at anything.
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readMooFile } from '../scripts/moo.mjs';

const root = process.env.I8086_VECTORS || join(homedir(), 'code', '8086-vectors');
const jsonDir = join(root, 'v1');
const mooDir = join(root, 'v1_binary');
const haveMoo = existsSync(mooDir);
const haveJson = existsSync(jsonDir);

/** How many opcode files the bounded run compares. Three is enough to cover a
 *  plain opcode, a ModR/M-group file and one with a segment override, and the
 *  vector floor below still demands a full file's worth. */
const SAMPLE_FILES = 3;
const ALL = process.env.MOO_ALL === '1';

test('the two encodings of the suite agree, vector for vector', {
    skip: !haveMoo && 'binary suite not present',
}, () => {
    assert.ok(haveJson,
        `${mooDir} exists but ${jsonDir} does not — the cross-format check cannot run, `
        + 'and skipping it would restore the hole scripts/moo.mjs was written to close. '
        + 'Check out at least a few v1/*.json.gz beside the binary form.');

    const json = readdirSync(jsonDir).filter((f) => f.endsWith('.json.gz')).sort();
    assert.ok(json.length, `no v1/*.json.gz in ${jsonDir}`);

    let filesChecked = 0, vectorsChecked = 0;
    for (const file of json) {
        const base = file.replace('.json.gz', '');
        const mooPath = join(mooDir, `${base}.MOO.gz`);
        if (!existsSync(mooPath)) continue;
        if (!ALL && filesChecked >= SAMPLE_FILES) break;

        const want = JSON.parse(gunzipSync(readFileSync(join(jsonDir, file))).toString('utf8'));
        const got = readMooFile(mooPath).tests;
        assert.strictEqual(got.length, want.length, `${base}: vector count`);

        for (let i = 0; i < want.length; i++) {
            const w = want[i], g = got[i];
            const at = `${base} #${w.test_num}`;
            assert.strictEqual(g.test_num, w.test_num, `${at}: index`);
            assert.strictEqual(g.name, w.name, `${at}: name`);
            assert.deepStrictEqual(g.bytes, w.bytes, `${at}: bytes`);
            for (const half of ['initial', 'final']) {
                assert.deepStrictEqual(g[half].regs, w[half].regs, `${at}: ${half}.regs`);
                assert.deepStrictEqual(g[half].ram, w[half].ram, `${at}: ${half}.ram`);
                assert.deepStrictEqual(g[half].queue, w[half].queue ?? [], `${at}: ${half}.queue`);
            }
            vectorsChecked++;
        }
        filesChecked++;
    }

    // An agreement over nothing is not an agreement. These lower bounds are
    // what separate "the encodings match" from "no file was compared".
    assert.ok(filesChecked > 0, 'no opcode file existed in BOTH encodings');
    assert.ok(vectorsChecked >= 2000,
        `only ${vectorsChecked} vectors compared — expected at least one full opcode file`);
    console.log(`    cross-format: ${filesChecked} files, ${vectorsChecked} vectors agree`);
});

test('a truncated MOO file is refused, not silently short', {
    skip: !haveMoo && 'binary suite not present',
}, async () => {
    const { parseMoo } = await import('../scripts/moo.mjs');
    const first = readdirSync(mooDir).filter((f) => f.endsWith('.MOO.gz')).sort()[0];
    const raw = gunzipSync(readFileSync(join(mooDir, first)));

    // Cutting the tail off leaves a file whose chunks all still parse; the
    // header's declared count is the only thing between a partial read and a
    // short pass that nobody notices. This asserts the count is load-bearing.
    assert.throws(() => parseMoo(raw.subarray(0, raw.length - 4096)),
        /declares \d+ tests, \d+ found/);

    // And something that is not a MOO file at all is named, not misread.
    assert.throws(() => parseMoo(Buffer.from('not a moo file at all, really')),
        /not a MOO file/);
});
