import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {motionProbeResult, assertSameMotionGuest, median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const archive = new URL('../docs/receipts/2026-10-02-wasm-literal-barrier/', import.meta.url);
const bytes = path => readFileSync(new URL(path, archive));
const manifest = JSON.parse(bytes('manifest.json'));
const hash = data => createHash('sha256').update(data).digest('hex');
const original = path => {
    const file = manifest.files.find(f => (f.original?.path ?? f.path) === path);
    assert.ok(file, `Missing original ${path}`);
    const data = bytes(file.path);
    return file.original ? Buffer.from(JSON.parse(data).data, file.original.encoding) : data;
};
const json = path => JSON.parse(original(path));
const sources = {
    baseline: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685',
    candidate: '45463b863decbe085ffb890edb8d11041594b7f2'
};
const moduleHashes = {
    baseline: '7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d',
    candidate: '8971cf34cd228ec9f4e94bb843b1f37acbe978986a1379a17a7f4d5deaa5340f'
};
const glueHash = 'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73';
const combined = samples => ({samples:samples.length, medianRtx:median(samples.map(s => s.rtx)),
    minimumRtx:Math.min(...samples.map(s => s.rtx)), allWindowsMeet1x:samples.every(s => s.rtx >= 1)});
function summary(runs, samples) {
    const result = {};
    for (const label of ['baseline', 'candidate']) {
        result[label] = combined(runs.filter(run => run.label === label).flatMap(samples));
        assert.equal(result[label].samples, 10);
    }
    result.candidateMedianRatio = result.candidate.medianRtx / result.baseline.medianRtx;
    return result;
}
test('literal bypass archive preserves original bytes, including empty logs and failed monitor state', () => {
    assert.equal(manifest.diagnosticOnly, true);
    assert.equal(manifest.timingHarness, 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162');
    assert.equal(manifest.files.length, 179);
    assert.equal(new Set(manifest.files.map(f => f.path)).size, manifest.files.length);
    for (const file of manifest.files) {
        const data = bytes(file.path);
        assert.equal(data.length, file.bytes);
        assert.equal(hash(data), file.sha256, file.path);
        if (file.original) {
            const wrapper = JSON.parse(data);
            assert.equal(wrapper.originalPath, file.original.path);
            assert.equal(wrapper.encoding, file.original.encoding);
            const decoded = original(file.original.path);
            assert.equal(decoded.length, file.original.bytes);
            assert.equal(hash(decoded), file.original.sha256);
        }
    }
    assert.equal(json('initial-monitor-failure.json').comparisons.length, 0);
});
test('native tests, two deterministic original builds and 101 actual integration tests remain auditable', () => {
    const pipeline = json('pipeline.json');
    assert.equal(pipeline.automaticMerge, false);
    assert.equal(pipeline.publication, false);
    assert.equal(pipeline.appPinChanges, false);
    assert.equal(pipeline.nativeCorrectness.headSha, sources.candidate);
    assert.equal(pipeline.nativeCorrectness.conclusion, 'success');
    for (const label of ['baseline', 'candidate']) {
        const run = json(`${label}-build-run.json`);
        assert.equal(run.id, pipeline.sources[label].run);
        assert.equal(run.status, 'completed');
        // Baseline failed only the unchanged motion floor; do not relabel it.
        assert.equal(run.conclusion, label === 'baseline' ? 'failure' : 'success');
        const jobs = json(`${label}-build-run-jobs.json`).jobs;
        for (const name of ['build (a)', 'build (b)', 'test', 'determinism']) {
            assert.equal(jobs.find(job => job.name === name)?.conclusion, 'success');
        }
        assert.equal(jobs.find(job => job.name === 'publish')?.conclusion, 'skipped');
        assert.equal(jobs.find(job => job.name === 'motion')?.conclusion, label === 'baseline' ? 'failure' : 'success');
        const build = json(`${label}/BUILD-INFO.json`);
        assert.equal(build.ref, sources[label]);
        assert.equal(build.targets.nodejs['labwired_wasm_bg.wasm'].sha256, moduleHashes[label]);
        assert.equal(build.targets.nodejs['labwired_wasm.js'].sha256, glueHash);
        const log = original(`${label}-integration.txt`).toString();
        for (const [key, value] of [['tests',101], ['pass',101], ['fail',0], ['skipped',0]]) {
            assert.match(log, new RegExp(`^# ${key} ${value}$`, 'm'));
        }
    }
    const qualification = pipeline.verifications.candidate.qualification;
    assert.equal(qualification.allWindowsMeet1x, true);
    assert.equal(qualification.medianRtx, 1.236513910034015);
    assert.equal(qualification.minimumRtx, 1.1701592393882565);
});
test('all six order-controlled comparisons reparse actual guest output and retain every failed floor', () => {
    const pipeline = json('pipeline.json');
    assert.equal(pipeline.comparisons.length, 4);
    const comparisons = [
        ...pipeline.comparisons.map(c => ({motion:`hosted-ab-${c.repeat}/abba.json`, f0:`hosted-ab-${c.repeat}/f0-abba/abba.json`,
            reverse:c.reverse, node:`v${c.nodeVersion}`, hosted:c})),
        ...['primary', 'reverse'].map(order => ({motion:`vps-motion-${order}.json`, f0:`vps-f0-${order}/abba.json`,
            reverse:order === 'reverse', node:'v20.20.2'}))
    ];
    for (const c of comparisons) {
        const expected = c.reverse ? ['candidate','baseline','baseline','candidate'] : ['baseline','candidate','candidate','baseline'];
        const motion = json(c.motion), f0 = json(c.f0);
        for (const receipt of [motion, f0]) {
            assert.equal(receipt.node, c.node);
            assert.equal(receipt.diagnosticOnly, true);
            assert.equal(receipt.guestObservationsMatch, true);
            assert.deepEqual(receipt.order, expected);
            assert.deepEqual(receipt.runs.map(r => r.label), expected);
            assert.equal(receipt.runs.length, 4);
            for (const label of ['baseline','candidate']) {
                assert.equal(receipt.artifacts[label].wasmSha256, moduleHashes[label]);
                assert.equal(receipt.artifacts[label].glueSha256, glueHash);
            }
        }
        const parsedMotion = motion.runs.map(run => {
            const parsed = motionProbeResult(run.stdout, run.exitCode);
            for (const [key, value] of Object.entries(parsed)) assert.deepEqual(run[key], value);
            assert.equal(run.signal, null);
            return parsed;
        });
        parsedMotion.slice(1).forEach(parsed => assertSameMotionGuest(parsedMotion[0], parsed));
        const motionSummary = summary(motion.runs, run => run.samples);
        assert.deepEqual(motionSummary, motion.summary);
        const parsedF0 = f0.runs.map((run, index) => {
            const prefix = c.f0.slice(0, -'abba.json'.length) + `${index+1}-${run.label}/`;
            const ordinary = run.capture.ordinary;
            assert.equal(run.capture.node, c.node);
            assert.equal(run.capture.buildInfo.ref, sources[run.label]);
            assert.equal(run.capture.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256, moduleHashes[run.label]);
            assert.deepEqual(ordinary.flags, []);
            assert.equal(run.capture.profiling, undefined);
            const parsed = f0TimingResult(original(`${prefix}ordinary-stdout.txt`).toString(), ordinary.exitCode);
            assert.deepEqual(parsed.workloads, ordinary.workloads);
            assert.equal(parsed.allWindowsMeet1x, ordinary.allWindowsMeet1x);
            return parsed;
        });
        parsedF0.slice(1).forEach(parsed => assertSameF0Guest(parsedF0[0], parsed));
        for (const workload of ['ram', 'gpio']) {
            assert.deepEqual(summary(f0.runs, run => run.capture.ordinary.workloads[workload].samples), f0.summary[workload]);
        }
        for (const label of ['baseline','candidate']) {
            assert.equal(motion.summary[label].allWindowsMeet1x, false);
            assert.equal(f0.summary.ram[label].allWindowsMeet1x, true);
            assert.equal(f0.summary.gpio[label].allWindowsMeet1x, false);
        }
        if (c.hosted) {
            assert.deepEqual(c.hosted.summary, motion.summary);
            assert.deepEqual(c.hosted.f0Summary, f0.summary);
            const run = json(`comparison-${c.hosted.repeat}-run.json`);
            assert.equal(run.id, c.hosted.run);
            assert.equal(run.head_sha, manifest.timingHarness);
            assert.equal(run.conclusion, 'success');
        } else assert.ok(f0.summary.gpio.candidateMedianRatio < 1, 'Both VPS GPIO orders regress');
    }
});
