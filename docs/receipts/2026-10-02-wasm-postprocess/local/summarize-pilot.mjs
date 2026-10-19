// Bind and reparse the completed local pilot; never qualify mixed results.
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {motionProbeResult, assertSameMotionGuest, median} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/f0-timing-receipt.mjs';
const root = '/mnt/volume1/code/lego/.t16-register-evidence.qZjhRa';
const json = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const out = join(root, 'postopt-main-pilot.json');
assert(!existsSync(out), 'Do not overwrite evidence');
const original = json('baseline/BUILD-INFO.json'), optimized = json('postopt-main-O3/BUILD-INFO.json');
assert.equal(original.ref, '43b2d62f5a0fa24ae0b38a645069f5aaa78af685');
assert.equal(optimized.ref, original.ref);
assert.equal(optimized.postprocess.sourceBuildInfoSha256, hash(readFileSync(join(root, 'baseline/BUILD-INFO.json'))));
assert.equal(optimized.postprocess.toolSha256, 'd66c6724c07334155720eb2def29c434dcaaf741ce859b4f7f389e22674f9c4a');
assert.deepEqual(optimized.postprocess.sourceTargets, original.targets);
const artifactHashes = {};
for (const [label, directory, info] of [['baseline', 'baseline', original], ['candidate', 'postopt-main-O3', optimized]]) {
    for (const target of ['nodejs', 'web']) for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
        const bytes = readFileSync(join(root, directory, target, file)), meta = info.targets[target][file];
        assert.equal(hash(bytes), meta.sha256);
        assert.equal(bytes.length, meta.bytes);
    }
    artifactHashes[label] = info.targets.nodejs['labwired_wasm_bg.wasm'].sha256;
}
const comparisons = [];
const checkSummary = (s, values) => {
    assert.equal(values.length, 10);
    assert.equal(s.samples, 10);
    assert.equal(s.medianRtx, median(values));
    assert.equal(s.minimumRtx, Math.min(...values));
    assert.equal(s.allWindowsMeet1x, values.every(v => v >= 1));
};
for (const [file, f0, reverse] of [
    ['postopt-vps-motion-primary.json', false, false],
    ['postopt-vps-motion-reverse.json', false, true],
    ['postopt-vps-motion-repeat.json', false, false],
    ['postopt-vps-f0-primary/abba.json', true, false],
    ['postopt-vps-f0-reverse/abba.json', true, true]
]) {
    const r = json(file);
    assert(r.completedAt && r.guestObservationsMatch);
    assert.equal(r.node, 'v20.20.2');
    assert.deepEqual(r.order, reverse ? ['candidate', 'baseline', 'baseline', 'candidate'] : ['baseline', 'candidate', 'candidate', 'baseline']);
    assert.deepEqual(r.runs.map(row => row.label), r.order);
    for (const label of ['baseline', 'candidate']) assert.equal(r.artifacts[label].wasmSha256, artifactHashes[label]);
    const parsed = r.runs.map((row, i) => {
        if (!f0) return motionProbeResult(row.stdout, row.exitCode);
        const directory = file.slice(0, -'/abba.json'.length);
        const value = f0TimingResult(readFileSync(join(root, directory, `${i + 1}-${row.label}/ordinary-stdout.txt`), 'utf8'), row.capture.ordinary.exitCode);
        assert.deepEqual(value.workloads, row.capture.ordinary.workloads);
        return value;
    });
    for (const p of parsed) (f0 ? assertSameF0Guest : assertSameMotionGuest)(parsed[0], p);
    for (const workload of f0 ? ['ram', 'gpio'] : ['motion']) {
        const s = f0 ? r.summary[workload] : r.summary;
        for (const label of ['baseline', 'candidate']) checkSummary(s[label], parsed.flatMap((p, i) =>
            r.runs[i].label === label ? (f0 ? p.workloads[workload] : p).samples.map(v => v.rtx) : []));
        assert.equal(s.candidateMedianRatio, s.candidate.medianRtx / s.baseline.medianRtx);
    }
    comparisons.push({file, summary: r.summary, rawSha256: hash(readFileSync(join(root, file)))});
}
const integration = json('postopt-main-integration-retry1.json');
assert.equal(integration.exitCode, 0);
assert.equal(integration.counts.tests, 101);
assert.equal(integration.wasmSha256, artifactHashes.candidate);
for (const key of ['fail', 'skipped', 'cancelled', 'todo']) assert.equal(integration.counts[key], 0);
const first = json('postopt-main-integration.json');
assert.equal(first.exitCode, 1);
const receipt = {schema: 'labwired.binaryen-local-pilot.v1', diagnosticOnly: true,
    completedAt: new Date().toISOString(), source: original.ref, artifactHashes,
    optimizer: optimized.postprocess, originalModuleBytes: original.targets.nodejs['labwired_wasm_bg.wasm'].bytes,
    optimizedModuleBytes: optimized.targets.nodejs['labwired_wasm_bg.wasm'].bytes,
    integration, excludedFirstIntegrationAttempt: {file: 'postopt-main-integration.json',
        reason: 'locked avr8js/rp2040js dependencies missing; 42 tests and four failures, not an engine acceptance pass', counts: first.counts},
    comparisons, acceptance: false, publication: false, appPinChanges: false, hardwareAcknowledgementChanges: false,
    limitations: ['mixed sequential local shared-VPS comparisons; no owned compiler/optimizer/overlapping benchmark during timings',
        'no independent-machine optimizer determinism, hosted Node20/22 comparisons or browser/UI qualification yet',
        'module size and passing integration do not establish a workload-wide speedup'],
    next: 'opt-in pinned optimizer CI on unchanged main, independently reproduce output and test runtime/order controls before considering production'};
writeFileSync(out, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({source: receipt.source, artifactHashes, integration: integration.counts,
    comparisons: comparisons.map(c => ({file: c.file, summary: c.summary})), acceptance: false}));
