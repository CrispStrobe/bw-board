import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BINARYEN, FLAGS, sha256} from '../scripts/postprocess-labwired-wasm.mjs';
import {motionProbeResult, assertSameMotionGuest, median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';

const root = new URL('../docs/receipts/2026-10-02-wasm-postprocess/', import.meta.url);
const read = name => readFileSync(new URL(name, root), 'utf8');
const json = name => JSON.parse(read(name));
const sources = {baseline: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685',
    candidate: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685'};
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
    for (const label of ['baseline', 'candidate']) {
        assert.equal(receipt.artifacts[label].wasmSha256, hashes[label]);
        assert.equal(receipt.artifacts[label].glueSha256, json(`${label}/BUILD-INFO.json`).targets.nodejs['labwired_wasm.js'].sha256);
    }
};

test('postprocessing provenance binds original metadata, optimizer and unchanged glue', () => {
    const baseline = json('baseline/BUILD-INFO.json');
    assert.equal(sha256(read('baseline/BUILD-INFO.json')), 'd3052e87f1be597cf7e9665ab1720a9a89355aebadaf147ad86266a630cd1d16');
    for (const directory of ['candidate', 'local']) {
        const info = json(`${directory}/BUILD-INFO.json`), p = info.postprocess;
        assert.equal(read(`${directory}/SOURCE-BUILD-INFO.json`), read('baseline/BUILD-INFO.json'));
        assert.deepEqual(p.sourceTargets, baseline.targets);
        assert.equal(p.sourceBuildInfoSha256, sha256(read('baseline/BUILD-INFO.json')));
        assert.equal(p.toolSha256, BINARYEN.toolSha256);
        assert.equal(p.releaseArchiveSha256, BINARYEN.archiveSha256);
        assert.equal(p.versionOutput, BINARYEN.versionOutput);
        assert.deepEqual(p.flags, FLAGS);
        assert.equal(p.publication, false);
        assert.equal(p.appPinChanges, false);
        assert.equal(p.diagnosticOnly, true);
        for (const target of ['nodejs', 'web']) {
            assert.deepEqual(info.targets[target]['labwired_wasm.js'], baseline.targets[target]['labwired_wasm.js']);
            assert.equal(info.targets[target]['labwired_wasm_bg.wasm'].sha256, '880fcdde04b581675c89cf5c638cf2c198c276478532c4a013dd36cb2e135b29');
            assert.equal(info.targets[target]['labwired_wasm_bg.wasm'].bytes, 24492963);
        }
    }
});

test('independent integration success does not erase failed qualification or rejected local attempts', () => {
    const p = json('pipeline.json');
    assert.ok(p.completedAt && !p.error);
    assert.equal(p.toolHead, 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162');
    for (const key of ['automaticMerge', 'publication', 'appPinChanges']) assert.equal(p[key], false);
    assert.equal(p.comparisons.length, 4);
    for (const label of ['baseline', 'candidate']) {
        assert.equal(p.sources[label].commit, sources[label]);
        assert.equal(p.verifications[label].integrationTests, 101);
        assert.match(read(`${label}-integration.txt`), /^tests=101 fail=0 skipped=0\s*$/m);
        const result = motionProbeResult(read(`${label}-qualification.txt`), 1);
        assert.deepEqual(result, p.verifications[label].qualification);
        assert.equal(result.allWindowsMeet1x, false);
    }
    for (const comparison of p.comparisons) {
        const directory = `hosted-ab-${comparison.repeat}`;
        assert.deepEqual(comparison.summary, json(`${directory}/abba.json`).summary);
        assert.deepEqual(comparison.f0Summary, json(`${directory}/f0-abba/abba.json`).summary);
    }
    const retry = json('local/postopt-main-integration-retry1.json');
    assert.equal(retry.exitCode, 0);
    assert.deepEqual(retry.counts, {tests: 101, fail: 0, skipped: 0, cancelled: 0, todo: 0});
    assert.match(read('local/postopt-main-integration-retry1-stdout.txt'), /^# tests 101$/m);
    assert.match(read('local/postopt-main-integration-retry1-stdout.txt'), /^# fail 0$/m);
    const failed = json('local/postopt-main-integration.json');
    assert.equal(failed.exitCode, 1);
    assert.equal(failed.counts.tests, 42);
    assert.equal(failed.counts.fail, 4);
    const pilot = json('local/pilot.json');
    for (const key of ['acceptance', 'publication', 'appPinChanges', 'hardwareAcknowledgementChanges']) assert.equal(pilot[key], false);
    assert.match(read('LOCAL-REPEAT-INCOMPLETE.md'), /partial tree has no final BUILD-INFO/);
});

test('archived evidence remains byte-identical to the original receipts', () => {
    const manifest = json('EVIDENCE-SHA256.json');
    assert.equal(manifest.schema, 1);
    assert.ok(manifest.files.length > 100);
    for (const file of manifest.files) {
        assert.ok(!file.path.startsWith('/') && !file.path.split('/').includes('..'));
        const bytes = readFileSync(new URL(file.path, root));
        assert.equal(bytes.length, file.bytes, file.path);
        assert.equal(sha256(bytes), file.sha256, file.path);
    }
});

test('Binaryen O3 motion evidence reparses every ordinary observation, order and failed floor', () => {
    for (const {file, node, reverse} of [
        ...hosted.map(h => ({...h, file: `${h.directory}/abba.json`})),
        {file: 'local/postopt-vps-motion-primary.json', node: 'v20.20.2', reverse: false},
        {file: 'local/postopt-vps-motion-reverse.json', node: 'v20.20.2', reverse: true},
        {file: 'local/postopt-vps-motion-repeat.json', node: 'v20.20.2', reverse: false}
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

test('Binaryen O3 F0 evidence retains exact child stdout and all workload tradeoffs', () => {
    for (const {directory, node, reverse} of [
        ...hosted.map(h => ({...h, directory: `${h.directory}/f0-abba`})),
        {directory: 'local/postopt-vps-f0-primary', node: 'v20.20.2', reverse: false},
        {directory: 'local/postopt-vps-f0-reverse', node: 'v20.20.2', reverse: true}
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
    for (const directory of hosted.map(h => `${h.directory}/f0-abba`)) {
        const r = json(`${directory}/abba.json`);
        assert.ok(r.summary.gpio.candidateMedianRatio < 1);
        assert.ok(r.summary.ram.candidateMedianRatio < 1);
    }
});
