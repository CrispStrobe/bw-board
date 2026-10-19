import assert from 'node:assert/strict';
import {median, motionProbeResult, assertSameMotionGuest} from './motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from './f0-timing-receipt.mjs';

// Two of each order, with the sequence balanced across early/late pairs.
export const SAME_HOST_ORDERS = Object.freeze([false, true, true, false]);
export const FROZEN_HARNESS = 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162';
export const SAME_HOST_ENGINES = Object.freeze({
    baseline: {run: '36915940413', core: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685',
        wasm: '7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d',
        glue: 'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73'},
    candidate: {run: '37117416202', core: '14a275f63daaf3cd4af4b1845e52678032553522',
        wasm: '7311d6240fc5ea92489adbcd5d396e13f30113652f70bb0515825fb7ef46d07d',
        glue: 'aa623d1543276fb7ea3dc4bd4efe66bc109202e8d863737c6ac5106313560351'}
});

export function summarizeOrdinaryRuns (runs, samplesFor) {
    const result = {};
    for (const label of ['baseline', 'candidate']) {
        const samples = runs.filter(run => run.label === label).flatMap(samplesFor);
        assert.equal(samples.length, 10);
        assert(samples.every(s => Number.isFinite(s.rtx) && s.rtx > 0));
        result[label] = {samples: samples.length, medianRtx: median(samples.map(s => s.rtx)),
            minimumRtx: Math.min(...samples.map(s => s.rtx)),
            allWindowsMeet1x: samples.every(s => s.rtx >= 1)};
    }
    result.candidateMedianRatio = result.candidate.medianRtx / result.baseline.medianRtx;
    return result;
}

export function verifySameHostPair ({motion, f0, stdoutFor}, index, node) {
    assert(Number.isInteger(index) && index >= 0 && index < SAME_HOST_ORDERS.length);
    assert(['v20.20.2', 'v22.23.3'].includes(node));
    const order = SAME_HOST_ORDERS[index]
        ? ['candidate', 'baseline', 'baseline', 'candidate']
        : ['baseline', 'candidate', 'candidate', 'baseline'];
    assert.equal(motion.cpu, f0.cpu);
    for (const receipt of [motion, f0]) {
        assert.equal(receipt.node, node);
        assert.equal(receipt.diagnosticOnly, true);
        assert.equal(receipt.guestObservationsMatch, true);
        assert.deepEqual(receipt.order, order);
        assert.deepEqual(receipt.runs.map(run => run.label), order);
        assert.match(receipt.gluePolicy, /explicit paired-glue comparison/);
        for (const label of ['baseline', 'candidate']) {
            assert.equal(receipt.artifacts[label].wasmSha256, SAME_HOST_ENGINES[label].wasm);
            assert.equal(receipt.artifacts[label].glueSha256, SAME_HOST_ENGINES[label].glue);
        }
    }
    const parsedMotion = motion.runs.map(run => {
        assert.equal(run.signal, null);
        const parsed = motionProbeResult(run.stdout, run.exitCode);
        for (const [key, value] of Object.entries(parsed)) assert.deepEqual(run[key], value);
        return parsed;
    });
    parsedMotion.slice(1).forEach(run => assertSameMotionGuest(parsedMotion[0], run));
    const parsedF0 = f0.runs.map((run, index) => {
        assert.equal(run.exitCode, 0); assert.equal(run.signal, null);
        const capture = run.capture;
        assert.equal(capture.node, node); assert(capture.completedAt);
        assert.deepEqual(capture.ordinary.flags, []);
        assert.equal(capture.sampled, undefined); assert.equal(capture.profiling, undefined);
        assert.equal(capture.buildInfo.ref, SAME_HOST_ENGINES[run.label].core);
        assert.equal(capture.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256, SAME_HOST_ENGINES[run.label].wasm);
        assert.equal(capture.buildInfo.targets.nodejs['labwired_wasm.js'].sha256, SAME_HOST_ENGINES[run.label].glue);
        const parsed = f0TimingResult(stdoutFor(index, run.label), capture.ordinary.exitCode);
        assert.deepEqual(parsed.workloads, capture.ordinary.workloads);
        assert.equal(parsed.allWindowsMeet1x, capture.ordinary.allWindowsMeet1x);
        return parsed;
    });
    parsedF0.slice(1).forEach(run => assertSameF0Guest(parsedF0[0], run));
    const motionSummary = summarizeOrdinaryRuns(motion.runs, run => run.samples);
    assert.deepEqual(motion.summary, motionSummary);
    const f0Summary = Object.fromEntries(['ram', 'gpio'].map(workload => [workload,
        summarizeOrdinaryRuns(f0.runs, run => run.capture.ordinary.workloads[workload].samples)]));
    assert.deepEqual(f0.summary, f0Summary);
    return {motion: motionSummary, f0: f0Summary,
        motionGuest: parsedMotion[0], f0Guest: parsedF0[0]};
}
