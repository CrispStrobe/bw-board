import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {motionProbeResult, assertSameMotionGuest, median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const root = new URL('../docs/receipts/2026-10-02-wasm-register-inline/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const json = name => JSON.parse(read(name));
const hashes = Object.fromEntries(['baseline', 'candidate'].map(label =>
    [label, json(`${label}/BUILD-INFO.json`).targets.nodejs['labwired_wasm_bg.wasm'].sha256]));

function verifySummary (summary, values) {
    assert.equal(summary.samples, 10);
    assert.equal(values.length, 10);
    assert.equal(summary.medianRtx, median(values));
    assert.equal(summary.minimumRtx, Math.min(...values));
    assert.equal(summary.allWindowsMeet1x, values.every(value => value >= 1));
}

test('original register-inline motion receipts preserve observations, hashes and every failed floor', () => {
    for (const file of ['hosted-ab-1/abba.json', 'hosted-ab-2/abba.json', 'hosted-reverse/abba.json',
        'vps-motion-primary.json', 'vps-motion-repeat.json', 'vps-motion-reverse-clean.json',
        'hosted-node20-primary/abba.json', 'hosted-node20-reverse/abba.json']) {
        const receipt = json(file);
        assert.ok(receipt.completedAt && receipt.guestObservationsMatch);
        assert.equal(receipt.runs.length, 4);
        const parsed = receipt.runs.map(r => motionProbeResult(r.stdout, r.exitCode));
        for (const result of parsed) assertSameMotionGuest(parsed[0], result);
        for (const label of ['baseline', 'candidate']) {
            assert.equal(receipt.artifacts[label].wasmSha256, hashes[label]);
            const values = parsed.flatMap((r, i) => receipt.runs[i].label === label ? r.samples.map(s => s.rtx) : []);
            verifySummary(receipt.summary[label], values);
        }
        assert.equal(receipt.summary.candidateMedianRatio,
            receipt.summary.candidate.medianRtx / receipt.summary.baseline.medianRtx);
    }
});

test('original register-inline F0 stdout reparses all workloads and negative medians', () => {
    for (const directory of ['hosted-ab-1/f0-abba', 'hosted-ab-2/f0-abba', 'hosted-reverse/f0-abba',
        'vps-f0-clean-primary', 'vps-f0-clean-reverse',
        'hosted-node20-primary/f0-abba', 'hosted-node20-reverse/f0-abba']) {
        const receipt = json(`${directory}/abba.json`);
        assert.ok(receipt.completedAt && receipt.guestObservationsMatch);
        assert.equal(receipt.runs.length, 4);
        const parsed = receipt.runs.map((r, i) => {
            const result = f0TimingResult(read(`${directory}/${i + 1}-${r.label}/ordinary-stdout.txt`), r.capture.ordinary.exitCode);
            assert.deepEqual(result.workloads, r.capture.ordinary.workloads);
            return result;
        });
        for (const result of parsed) assertSameF0Guest(parsed[0], result);
        for (const label of ['baseline', 'candidate']) {
            assert.equal(receipt.artifacts[label].wasmSha256, hashes[label]);
            for (const workload of ['ram', 'gpio']) {
                const values = parsed.flatMap((r, i) => receipt.runs[i].label === label ? r.workloads[workload].samples.map(s => s.rtx) : []);
                verifySummary(receipt.summary[workload][label], values);
            }
        }
        for (const workload of ['ram', 'gpio']) assert.equal(receipt.summary[workload].candidateMedianRatio,
            receipt.summary[workload].candidate.medianRtx / receipt.summary[workload].baseline.medianRtx);
    }
    const negative = json('vps-f0-clean-reverse/abba.json');
    assert.equal(negative.summary.ram.baseline.allWindowsMeet1x, true);
    assert.equal(negative.summary.ram.candidate.allWindowsMeet1x, false);
    assert.ok(negative.summary.ram.candidateMedianRatio < 1);
    assert.ok(negative.summary.gpio.candidateMedianRatio < 1);
    assert.ok(json('hosted-node20-reverse/f0-abba/abba.json').summary.ram.candidateMedianRatio < 0.8);
});

test('contaminated captures remain explicitly excluded and aborted motion stays incomplete', () => {
    const note = read('CONTAMINATED-CAPTURES.md');
    assert.match(note, /do not count/);
    assert.match(note, /incomplete and contaminated/);
    assert.equal(json('vps-motion-reverse.json').completedAt, undefined);
});

test('code-size inspection binds original modules, not a timing prediction', () => {
    const inspection = json('code-size-inspection.json');
    for (const label of ['baseline', 'candidate']) assert.equal(inspection.artifacts[label].wasmSha256, hashes[label]);
    const step = label => inspection.artifacts[label].cortexM.find(f => f.name.includes('::step_batch::')).bodyBytes;
    assert.equal(step('baseline'), 77390);
    assert.equal(step('candidate'), 217959);
    assert.match(inspection.limitations.join(' '), /not timing/);
});
