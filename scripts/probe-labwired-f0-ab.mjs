#!/usr/bin/env node
/** Ordinary verified F0 A/B/B/A; no sampled timings or artifact promotion. */
import {spawnSync} from 'node:child_process';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {resolve, join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';
import {gluePolicy, median} from './lib/motion-ab-receipt.mjs';
import {assertSameF0Guest} from './lib/f0-timing-receipt.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const option = name => {
    const index = process.argv.indexOf('--' + name), value = process.argv[index + 1];
    if (index < 0 || !value || value.startsWith('--')) throw Error('Required: --' + name);
    return resolve(value);
};
const out = option('out'), directories = {baseline: option('baseline'), candidate: option('candidate')};
if (process.env.NODE_OPTIONS) throw Error('Unset NODE_OPTIONS for ordinary comparison');
if (existsSync(out)) throw Error('Refusing to overwrite comparison evidence');
const hash = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const artifacts = Object.fromEntries(Object.entries(directories).map(([key, directory]) =>
    [key, {directory, glueSha256: hash(join(directory, 'labwired_wasm.js')),
        wasmSha256: hash(join(directory, 'labwired_wasm_bg.wasm'))}]));
const policy = gluePolicy(artifacts.baseline.glueSha256, artifacts.candidate.glueSha256,
    process.argv.includes('--paired-glue'));
if (artifacts.baseline.wasmSha256 === artifacts.candidate.wasmSha256) throw Error('Identical modules');
mkdirSync(out, {recursive: true});
const receipt = {schema: 'labwired.f0-abba.v1', diagnosticOnly: true,
    startedAt: new Date().toISOString(), node: process.version, cpu: cpus()[0]?.model,
    artifacts, gluePolicy: policy, toolSha256: hash(fileURLToPath(import.meta.url)),
    order: ['baseline', 'candidate', 'candidate', 'baseline'], runs: [],
    limitations: ['ordinary selected F0 workloads; not browser or all-target qualification',
        'shared host; failed realtime floors are retained, never waived',
        'each child verifies original source/artifact provenance; no publication or app pin changes']};
const save = () => writeFileSync(join(out, 'abba.json'), JSON.stringify(receipt, null, 2) + '\n');
save();
for (const label of receipt.order) {
    const childOut = join(out, `${receipt.runs.length + 1}-${label}`);
    const child = spawnSync(process.execPath, ['scripts/probe-labwired-f0.mjs',
        '--wasm', directories[label], '--out', childOut], {cwd: root, encoding: 'utf8',
        timeout: 240_000, maxBuffer: 4 * 1024 * 1024});
    writeFileSync(join(out, `${receipt.runs.length + 1}-capture-stdout.txt`), child.stdout || '');
    writeFileSync(join(out, `${receipt.runs.length + 1}-capture-stderr.txt`), child.stderr || '');
    receipt.runs.push({label, directory: childOut, exitCode: child.status, signal: child.signal,
        error: child.error?.message});
    save();
    if (child.status !== 0) throw Error('F0 capture failed; inspect preserved child evidence');
    const result = JSON.parse(readFileSync(join(childOut, 'receipt.json')));
    if (!result.completedAt || result.sampled || result.ordinary.flags.length) throw Error('Incomplete or nonordinary capture');
    receipt.runs.at(-1).capture = result;
    assertSameF0Guest(receipt.runs[0].capture.ordinary, result.ordinary);
    save();
}
receipt.guestObservationsMatch = true;
receipt.summary = Object.fromEntries(['ram', 'gpio'].map(workload => {
    const pooled = Object.fromEntries(['baseline', 'candidate'].map(label => {
        const samples = receipt.runs.filter(r => r.label === label)
            .flatMap(r => r.capture.ordinary.workloads[workload].samples);
        return [label, {samples: samples.length, medianRtx: median(samples.map(s => s.rtx)),
            minimumRtx: Math.min(...samples.map(s => s.rtx)), allWindowsMeet1x: samples.every(s => s.rtx >= 1)}];
    }));
    pooled.candidateMedianRatio = pooled.candidate.medianRtx / pooled.baseline.medianRtx;
    return [workload, pooled];
}));
receipt.completedAt = new Date().toISOString();
save();
console.log(JSON.stringify(receipt.summary));
