// Reparse original ordinary evidence. No timing, writes or acceptance override.
import {readFileSync} from 'node:fs';
import {resolve, join} from 'node:path';
import assert from 'node:assert/strict';
import {motionProbeResult, assertSameMotionGuest, median} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/f0-timing-receipt.mjs';
const [directory, nodeVersion, reverseString] = process.argv.slice(2);
assert(['20.20.2', '22.23.3'].includes(nodeVersion));
assert(['true', 'false'].includes(reverseString));
const root = resolve(directory);
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const order = reverseString === 'true' ? ['candidate', 'baseline', 'baseline', 'candidate'] :
    ['baseline', 'candidate', 'candidate', 'baseline'];
const hashes = Object.fromEntries(['baseline', 'candidate'].map(label => {
    const info = json(`${label}-build-info.json`);
    const expected = label === 'baseline' ? '43b2d62f5a0fa24ae0b38a645069f5aaa78af685' :
        '59232bb1f54aca4decc5312da895d533980788dc';
    assert.equal(info.ref, expected);
    return [label, info.targets.nodejs['labwired_wasm_bg.wasm'].sha256];
}));
const checkSummary = (summary, values) => {
    assert.equal(values.length, 10);
    assert.equal(summary.samples, 10);
    assert.equal(summary.medianRtx, median(values));
    assert.equal(summary.minimumRtx, Math.min(...values));
    assert.equal(summary.allWindowsMeet1x, values.every(v => v >= 1));
};
for (const [path, f0] of [['abba.json', false], ['f0-abba/abba.json', true]]) {
    const receipt = json(path);
    assert(receipt.completedAt && receipt.guestObservationsMatch);
    assert.equal(receipt.node, `v${nodeVersion}`);
    assert.deepEqual(receipt.order, order);
    assert.deepEqual(receipt.runs.map(r => r.label), order);
    assert.equal(receipt.runs.length, 4);
    for (const label of ['baseline', 'candidate']) assert.equal(receipt.artifacts[label].wasmSha256, hashes[label]);
    const parsed = receipt.runs.map((r, i) => {
        if (!f0) return motionProbeResult(r.stdout, r.exitCode);
        assert.equal(r.capture.node, `v${nodeVersion}`);
        const result = f0TimingResult(readFileSync(join(root, `f0-abba/${i + 1}-${r.label}/ordinary-stdout.txt`), 'utf8'), r.capture.ordinary.exitCode);
        assert.deepEqual(result.workloads, r.capture.ordinary.workloads);
        return result;
    });
    for (const result of parsed) (f0 ? assertSameF0Guest : assertSameMotionGuest)(parsed[0], result);
    for (const workload of f0 ? ['ram', 'gpio'] : ['motion']) {
        const summary = f0 ? receipt.summary[workload] : receipt.summary;
        for (const label of ['baseline', 'candidate']) {
            const values = parsed.flatMap((r, i) => receipt.runs[i].label === label ?
                (f0 ? r.workloads[workload] : r).samples.map(s => s.rtx) : []);
            checkSummary(summary[label], values);
        }
        assert.equal(summary.candidateMedianRatio, summary.candidate.medianRtx / summary.baseline.medianRtx);
        console.log(JSON.stringify({path, nodeVersion, order, workload, summary}));
    }
}
