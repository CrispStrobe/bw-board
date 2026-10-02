import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {motionProbeResult, assertSameMotionGuest, median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const root = new URL('../docs/receipts/2026-10-02-wasm-t16-register-inline/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const json = name => JSON.parse(read(name));
const sources = {baseline: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685',
    candidate: '59232bb1f54aca4decc5312da895d533980788dc'};
const hashes = Object.fromEntries(Object.entries(sources).map(([label, source]) => {
    const info = json(`${label}/BUILD-INFO.json`);
    assert.equal(info.ref, source);
    return [label, info.targets.nodejs['labwired_wasm_bg.wasm'].sha256];
}));
const hosted = Array.from({length: 4}, (_, i) => ({directory: `hosted-ab-${i + 1}`,
    node: i < 2 ? 'v20.20.2' : 'v22.23.3', reverse: i % 2 === 1}));
const expectedOrder = reverse => reverse ? ['candidate', 'baseline', 'baseline', 'candidate'] :
    ['baseline', 'candidate', 'candidate', 'baseline'];
const summary = (actual, values) => {
    assert.equal(values.length, 10);
    assert.equal(actual.samples, 10);
    assert.equal(actual.medianRtx, median(values));
    assert.equal(actual.minimumRtx, Math.min(...values));
    assert.equal(actual.allWindowsMeet1x, values.every(value => value >= 1));
};
const bindReceipt = (receipt, node, reverse) => {
    assert.ok(receipt.completedAt && receipt.guestObservationsMatch);
    assert.equal(receipt.node, node);
    assert.deepEqual(receipt.order, expectedOrder(reverse));
    assert.deepEqual(receipt.runs.map(r => r.label), expectedOrder(reverse));
    assert.equal(receipt.runs.length, 4);
    for (const label of ['baseline', 'candidate']) assert.equal(receipt.artifacts[label].wasmSha256, hashes[label]);
};

test('T16 specialization motion evidence reparses every ordinary observation, order and failed floor', () => {
    for (const {file, node, reverse} of [
        ...hosted.map(h => ({...h, file: `${h.directory}/abba.json`})),
        {file: 'vps-motion-primary.json', node: 'v20.20.2', reverse: false},
        {file: 'vps-motion-reverse.json', node: 'v20.20.2', reverse: true},
        {file: 'vps-motion-repeat.json', node: 'v20.20.2', reverse: false}
    ]) {
        const receipt = json(file);
        bindReceipt(receipt, node, reverse);
        const parsed = receipt.runs.map(r => motionProbeResult(r.stdout, r.exitCode));
        for (const result of parsed) assertSameMotionGuest(parsed[0], result);
        for (const label of ['baseline', 'candidate']) summary(receipt.summary[label],
            parsed.flatMap((r, i) => receipt.runs[i].label === label ? r.samples.map(s => s.rtx) : []));
        assert.equal(receipt.summary.candidateMedianRatio,
            receipt.summary.candidate.medianRtx / receipt.summary.baseline.medianRtx);
    }
});

test('T16 specialization F0 evidence retains exact child stdout and all workload tradeoffs', () => {
    for (const {directory, node, reverse} of [
        ...hosted.map(h => ({...h, directory: `${h.directory}/f0-abba`})),
        {directory: 'vps-f0-primary', node: 'v20.20.2', reverse: false},
        {directory: 'vps-f0-reverse', node: 'v20.20.2', reverse: true}
    ]) {
        const receipt = json(`${directory}/abba.json`);
        bindReceipt(receipt, node, reverse);
        const parsed = receipt.runs.map((r, i) => {
            assert.equal(r.capture.node, node);
            const result = f0TimingResult(read(`${directory}/${i + 1}-${r.label}/ordinary-stdout.txt`), r.capture.ordinary.exitCode);
            assert.deepEqual(result.workloads, r.capture.ordinary.workloads);
            return result;
        });
        for (const result of parsed) assertSameF0Guest(parsed[0], result);
        for (const workload of ['ram', 'gpio']) {
            for (const label of ['baseline', 'candidate']) summary(receipt.summary[workload][label],
                parsed.flatMap((r, i) => receipt.runs[i].label === label ? r.workloads[workload].samples.map(s => s.rtx) : []));
            assert.equal(receipt.summary[workload].candidateMedianRatio,
                receipt.summary[workload].candidate.medianRtx / receipt.summary[workload].baseline.medianRtx);
        }
    }
    for (const directory of ['hosted-ab-1/f0-abba', 'hosted-ab-2/f0-abba', 'vps-f0-reverse']) {
        const r = json(`${directory}/abba.json`);
        assert.ok(r.summary.gpio.candidateMedianRatio < 1);
        assert.ok(r.summary.ram.candidateMedianRatio < 1);
    }
});

test('T16 code-size inspection binds original sources and does not assert a speedup', () => {
    const inspection = json('code-size-inspection.json');
    for (const label of ['baseline', 'candidate']) {
        assert.equal(inspection.artifacts[label].source, sources[label]);
        assert.equal(inspection.artifacts[label].wasmSha256, hashes[label]);
    }
    const step = label => inspection.artifacts[label].cortexM.find(f => f.name.includes('::step_batch::')).bodyBytes;
    assert.equal(step('baseline'), 77390);
    assert.equal(step('candidate'), 77388);
    assert.match(inspection.limitations.join(' '), /not timing/);
});

test('independent build/integration receipt preserves failed motion qualification and disabled publication', () => {
    const pipeline = json('pipeline.json');
    assert.ok(pipeline.completedAt);
    assert.equal(pipeline.automaticMerge, false);
    assert.equal(pipeline.publication, false);
    assert.equal(pipeline.appPinChanges, false);
    assert.equal(pipeline.comparisons.length, 4);
    for (const label of ['baseline', 'candidate']) {
        assert.equal(pipeline.sources[label].commit, sources[label]);
        assert.equal(pipeline.verifications[label].integrationTests, 101);
        assert.equal(pipeline.verifications[label].qualification.allWindowsMeet1x, false);
    }
});
