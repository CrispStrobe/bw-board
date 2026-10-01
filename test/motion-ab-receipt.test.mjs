import {test} from 'node:test';
import assert from 'node:assert/strict';
import {median, motionProbeResult, gluePolicy, assertSameMotionGuest} from '../scripts/lib/motion-ab-receipt.mjs';

test('different original glue requires an explicit paired-build comparison', () => {
    assert.equal(gluePolicy('same', 'same'), 'identical original glue');
    assert.throws(() => gluePolicy('baseline', 'candidate'), /explicit --paired-glue/);
    assert.match(gluePolicy('baseline', 'candidate', true), /each engine loads its own unmodified/);
});
// Synthetic log fixtures validate parsing only, never emulator functionality.
const fixture = values => [
    'ok 1 - reads both sensor identities, poses, actual DMA, matrix and buttons',
    'MICROBIT_WASM_GUEST_SHA256=' + 'a'.repeat(64),
    ...values.map((rtx, index) => 'MICROBIT_WASM_SAMPLE ' + JSON.stringify({index,
        cycles: 64_000_000, cpuHz: 64_000_000, wallSeconds: 1 / rtx, rtx,
        accelRaw: [16384, -8192, 4096], magRaw: [200, -100, 50],
        accelSamples: 112 + index, magSamples: 112 + index, scans: 2145 + index})),
    '# tests 2', '# skipped 0', `# pass ${values.every(v => v >= 1) ? 2 : 1}`,
    `# fail ${values.every(v => v >= 1) ? 0 : 1}`].join('\n');
test('median handles both five windows and ten pooled windows', () => {
    assert.equal(median([1, 5, 2, 4, 3]), 3);
    assert.equal(median([1, 2, 3, 4]), 2.5);
    assert.throws(() => median([]));
});
test('failed RTx samples are retained as failures, not passing qualification', () => {
    const result = motionProbeResult(fixture([.6, .7, .8, .9, .5]), 1);
    assert.equal(result.samples.length, 5);
    assert.equal(result.allWindowsMeet1x, false);
    assert.equal(result.medianRtx, .7);
    assert.equal(result.minimumRtx, .5);
});
test('every window must pass; a passing median cannot hide a failed minimum', () => {
    assert.equal(motionProbeResult(fixture([2, 2, .99, 2, 2]), 1).allWindowsMeet1x, false);
    assert.equal(motionProbeResult(fixture([1, 1, 1, 1, 1]), 0).allWindowsMeet1x, true);
});
test('missing samples, skips, functional failure and unexpected exits fail closed', () => {
    const log = fixture([.5, .5, .5, .5, .5]);
    for (const mutated of [log.replace(/MICROBIT_WASM_SAMPLE .*\n/, ''),
        log.replace('# skipped 0', '# skipped 1'), log.replace('ok 1 - reads', 'not ok 1 - reads'),
        log.replace('# tests 2', '# tests 1')]) assert.throws(() => motionProbeResult(mutated, 1));
    assert.throws(() => motionProbeResult(log, 0));
    assert.throws(() => motionProbeResult(log, null));
});
test('wrong cycle counts and inconsistent timing cannot be reported as RTx', () => {
    const log = fixture([.5, .5, .5, .5, .5]);
    assert.throws(() => motionProbeResult(log.replace('"cycles":64000000', '"cycles":64000'), 1));
    assert.throws(() => motionProbeResult(log.replace('"wallSeconds":2', '"wallSeconds":1'), 1));
});
test('A/B requires every cycle-indexed observation and retains ELF hashes as provenance', () => {
    const a = motionProbeResult(fixture([.5, .5, .5, .5, .5]), 1);
    const b = motionProbeResult(fixture([.6, .7, .8, .9, .6]), 1);
    assert.doesNotThrow(() => assertSameMotionGuest(a, b));
    b.guestSha256 = 'b'.repeat(64);
    assert.doesNotThrow(() => assertSameMotionGuest(a, b));
    for (const mutate of [r => { r.guestObservations[2].scans++; },
        r => { r.guestObservations[3].magRaw[0]++; },
        r => { r.guestObservations.pop(); }, r => { delete r.guestSha256; }]) {
        const changed = structuredClone(b); mutate(changed);
        assert.throws(() => assertSameMotionGuest(a, changed));
    }
});
test('missing, duplicate guest hash and malformed guest observations fail closed', () => {
    const log = fixture([.5, .5, .5, .5, .5]);
    for (const changed of [log.replace(/^MICROBIT_WASM_GUEST_SHA256=.*\n/m, ''),
        log + '\nMICROBIT_WASM_GUEST_SHA256=' + 'a'.repeat(64),
        log.replace('"accelRaw":[16384,-8192,4096]', '"accelRaw":[16384]'),
        log.replace('"scans":2145', '"scans":null')]) {
        assert.throws(() => motionProbeResult(changed, 1));
    }
});
