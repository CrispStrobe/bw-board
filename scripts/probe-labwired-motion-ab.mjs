#!/usr/bin/env node
/** Diagnostic A/B/B/A of actual engine bytes; never changes the qualification test. */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus, loadavg} from 'node:os';
import {median, motionProbeResult, gluePolicy} from './lib/motion-ab-receipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => {
    const i = process.argv.indexOf(`--${name}`);
    if (i < 0 || !process.argv[i + 1] || process.argv[i + 1].startsWith('--')) {
        throw Error(`Required: --${name} <path>`);
    }
    return resolve(process.argv[i + 1]);
};
const baseline = option('baseline'), candidate = option('candidate'), output = option('out');
if (existsSync(output)) throw Error('Refusing to overwrite an existing receipt');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const artifact = directory => ({directory,
    glueSha256: hash(join(directory, 'labwired_wasm.js')),
    wasmSha256: hash(join(directory, 'labwired_wasm_bg.wasm'))});
const artifacts = {baseline: artifact(baseline), candidate: artifact(candidate)};
const selectedGluePolicy = gluePolicy(artifacts.baseline.glueSha256,
    artifacts.candidate.glueSha256, process.argv.includes('--paired-glue'));
if (artifacts.baseline.wasmSha256 === artifacts.candidate.wasmSha256) {
    throw Error('Baseline and candidate WASM bytes are identical');
}
const receipt = {schema: 1, diagnosticOnly: true, startedAt: new Date().toISOString(),
    node: process.version, cpu: cpus()[0]?.model, logicalCpus: cpus().length,
    harnessSha256: hash(join(root, 'test/labwired-microbit-motion.test.mjs')),
    artifacts, gluePolicy: selectedGluePolicy,
    order: ['baseline', 'candidate', 'candidate', 'baseline'], runs: [],
    limitations: ['shared VPS; CPU availability is uncontrolled',
        'NODEJS held motion workload, not browser/UI/circuit qualification',
        'no artifact publication or engine-pin promotion']};
const save = () => writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n');
for (const label of receipt.order) {
    console.log(`Starting ${receipt.runs.length + 1}/4: ${label}`);
    const before = loadavg();
    const result = spawnSync(process.execPath, ['test/labwired-microbit-motion.test.mjs'], {
        cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
        env: {...process.env, LABWIRED_WASM: artifacts[label].directory,
            LABWIRED_MOTION_REQUIRED: '1', LABWIRED_REQUIRE_MOTION_RTX: '1'}
    });
    const stdout = result.stdout || '', stderr = result.stderr || '';
    const run = {label, loadBefore: before, loadAfter: loadavg(), exitCode: result.status,
        signal: result.signal, error: result.error?.message, stdout, stderr};
    receipt.runs.push(run);
    save(); // Preserve failures and raw output before checking the probe itself.
    Object.assign(run, motionProbeResult(stdout, result.status));
    save();
    console.log(`${label}: median ${run.medianRtx.toFixed(6)}x, minimum ${run.minimumRtx.toFixed(6)}x`);
}
receipt.completedAt = new Date().toISOString();
receipt.summary = Object.fromEntries(['baseline', 'candidate'].map(label => {
    const samples = receipt.runs.filter(run => run.label === label).flatMap(run => run.samples);
    return [label, {samples: samples.length, medianRtx: median(samples.map(s => s.rtx)),
        minimumRtx: Math.min(...samples.map(s => s.rtx)),
        allWindowsMeet1x: samples.every(s => s.rtx >= 1)}];
}));
receipt.summary.candidateMedianRatio = receipt.summary.candidate.medianRtx / receipt.summary.baseline.medianRtx;
save();
console.log(JSON.stringify(receipt.summary));
