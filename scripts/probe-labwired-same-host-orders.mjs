#!/usr/bin/env node
/** Hosted orchestration only; measurement children are unchanged frozen fb13. */
import assert from 'node:assert/strict';
import {spawnSync, execFileSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve, join} from 'node:path';
import {createHash} from 'node:crypto';
import {cpus, loadavg, freemem} from 'node:os';
import {SAME_HOST_ORDERS, FROZEN_HARNESS, SAME_HOST_ENGINES, verifySameHostPair} from './lib/same-host-orders.mjs';
import {assertSameMotionGuest} from './lib/motion-ab-receipt.mjs';
import {assertSameF0Guest} from './lib/f0-timing-receipt.mjs';
const option = name => {
    const index = process.argv.indexOf('--' + name), value = process.argv[index + 1];
    if (index < 0 || !value || value.startsWith('--')) throw Error('Required: --' + name);
    return resolve(value);
};
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Hosted-only; never execute engines on VPS');
assert.equal(process.env.NODE_OPTIONS || '', ''); assert.deepEqual(process.execArgv, []);
assert(['v20.20.2', 'v22.23.3'].includes(process.version));
const harness = option('harness'), out = option('out');
const directories = {baseline: option('baseline'), candidate: option('candidate')};
assert(!existsSync(out), 'Never overwrite existing receipts');
const git = args => execFileSync('git', args, {cwd: harness, encoding: 'utf8'}).trim();
assert.equal(git(['rev-parse', 'HEAD']), FROZEN_HARNESS);
assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Analysis uses the same strict parser bytes as frozen children.
for (const file of ['motion-ab-receipt.mjs', 'f0-timing-receipt.mjs']) {
    assert.equal(hash(readFileSync(new URL('./lib/' + file, import.meta.url))),
        hash(readFileSync(join(harness, 'scripts/lib', file))), 'Parser drift: ' + file);
}
const buildInfo = {};
for (const [label, directory] of Object.entries(directories)) {
    const info = JSON.parse(readFileSync(join(directory, '../BUILD-INFO.json')));
    assert.equal(info.ref, SAME_HOST_ENGINES[label].core);
    for (const [file, expected] of [['labwired_wasm_bg.wasm', SAME_HOST_ENGINES[label].wasm], ['labwired_wasm.js', SAME_HOST_ENGINES[label].glue]]) {
        const bytes = readFileSync(join(directory, file));
        assert.equal(hash(bytes), expected); assert.equal(info.targets.nodejs[file].sha256, expected);
        assert.equal(info.targets.nodejs[file].bytes, bytes.length);
    }
    buildInfo[label] = info;
}
mkdirSync(out, {recursive: true});
const receipt = {schema: 1, diagnosticOnly: true, hostedOnly: true,
    harness: FROZEN_HARNESS, toolCommit: execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim(),
    startedAt: new Date().toISOString(), node: process.version, engines: SAME_HOST_ENGINES,
    cpu: cpus()[0]?.model, logicalCpus: cpus().length, flags: [], buildInfo,
    workflowRun: process.env.GITHUB_RUN_ID, job: process.env.GITHUB_JOB,
    orders: SAME_HOST_ORDERS, pairs: [],
    limitations: ['One hosted VM per runtime; host load, JIT settling and thermal state are not controlled',
        'Distinct runtime jobs do not establish Node-version causality or statistical significance',
        'All selected engine-cycle floors are retained; no all-target/browser/hardware qualification or promotion']};
const save = () => writeFileSync(join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
let first;
try {
    for (const [index, reverse] of SAME_HOST_ORDERS.entries()) {
        const directory = join(out, 'pair-' + (index + 1)); mkdirSync(directory);
        const pair = {index, reverse, startedAt: new Date().toISOString(),
            cpu: cpus()[0]?.model, loadBefore: loadavg(), freeMemoryBefore: freemem(), children: []};
        assert.equal(pair.cpu, receipt.cpu); receipt.pairs.push(pair); save();
        for (const [label, script, output] of [['motion', 'probe-labwired-motion-ab.mjs', join(directory, 'abba.json')], ['f0', 'probe-labwired-f0-ab.mjs', join(directory, 'f0-abba')]]) {
            const args = [join(harness, 'scripts', script), '--baseline', directories.baseline,
                '--candidate', directories.candidate, '--out', output, '--paired-glue', ...(reverse ? ['--reverse'] : [])];
            const child = spawnSync(process.execPath, args, {cwd: harness, encoding: 'utf8',
                timeout: 900_000, maxBuffer: 16 * 1024 * 1024});
            for (const [stream, text] of [['stdout', child.stdout || ''], ['stderr', child.stderr || '']]) {
                writeFileSync(join(directory, label + '-' + stream + '.txt'), text, {flag: 'wx'});
            }
            pair.children.push({label, args, exitCode: child.status, signal: child.signal, error: child.error?.message}); save();
            assert.equal(child.status, 0, 'Diagnostic child failed; retained original partial outputs');
            assert.equal(child.signal, null);
        }
        // Bind raw receipts before parsing or deciding any floor outcome.
        pair.receipts = Object.fromEntries(['abba.json', 'f0-abba/abba.json'].map(path => {
            const bytes = readFileSync(join(directory, path)); return [path, {bytes: bytes.length, sha256: hash(bytes)}];
        })); save();
        const motion = JSON.parse(readFileSync(join(directory, 'abba.json')));
        const f0 = JSON.parse(readFileSync(join(directory, 'f0-abba/abba.json')));
        assert.equal(motion.cpu, receipt.cpu); assert.equal(f0.cpu, receipt.cpu);
        const parsed = verifySameHostPair({motion, f0,
            stdoutFor: (i, label) => readFileSync(join(directory, `f0-abba/${i + 1}-${label}/ordinary-stdout.txt`), 'utf8')}, index, process.version);
        if (first) { assertSameMotionGuest(first.motionGuest, parsed.motionGuest); assertSameF0Guest(first.f0Guest, parsed.f0Guest); }
        else first = parsed;
        pair.summary = {motion: parsed.motion, f0: parsed.f0}; pair.completedAt = new Date().toISOString();
        pair.loadAfter = loadavg(); pair.freeMemoryAfter = freemem(); save();
        console.log(JSON.stringify({pair: index + 1, reverse, ...pair.summary}));
    }
    assert.equal(git(['rev-parse', 'HEAD']), FROZEN_HARNESS);
    assert.equal(git(['status', '--porcelain', '--untracked-files=no']), '');
    receipt.completedAt = new Date().toISOString(); save();
} catch (error) { receipt.error = error.message; receipt.stoppedAt = new Date().toISOString(); save(); throw error; }
