// Reparse actual archived observations; never run benchmarks or waive floors.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BINARYEN, modeFlags, sha256} from '../scripts/postprocess-labwired-wasm.mjs';
import {motionProbeResult, assertSameMotionGuest, median} from '../scripts/lib/motion-ab-receipt.mjs';
import {f0TimingResult, assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';
const root = new URL('../docs/receipts/2026-10-02-wasm-targeted-postprocess/', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const json = p => JSON.parse(read(p));
const ref = '43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const sourceInfo = 'd3052e87f1be597cf7e9665ab1720a9a89355aebadaf147ad86266a630cd1d16';
const modes = ['instructions', 'locals'];
const order = reverse => reverse ? ['candidate', 'baseline', 'baseline', 'candidate'] : ['baseline', 'candidate', 'candidate', 'baseline'];
function bind (r, mode, node, reverse) {
    assert.ok(r.completedAt && r.guestObservationsMatch);
    assert.equal(r.node, node);
    assert.deepEqual(r.order, order(reverse));
    assert.deepEqual(r.runs.map(r => r.label), order(reverse));
    for (const label of ['baseline', 'candidate']) {
        const info = json(`${mode}/${label}/BUILD-INFO.json`);
        assert.equal(r.artifacts[label].wasmSha256, info.targets.nodejs['labwired_wasm_bg.wasm'].sha256);
        assert.equal(r.artifacts[label].glueSha256, info.targets.nodejs['labwired_wasm.js'].sha256);
    }
}
function summary (actual, values) {
    assert.equal(values.length, 10);
    assert.equal(actual.samples, 10);
    assert.equal(actual.medianRtx, median(values));
    assert.equal(actual.minimumRtx, Math.min(...values));
    assert.equal(actual.allWindowsMeet1x, values.every(v => v >= 1));
}
function captures (mode, workload) {
    return [
        ...Array.from({length: 4}, (_, i) => ({directory: `${mode}/hosted-ab-${i + 1}`,
            node: i < 2 ? 'v20.20.2' : 'v22.23.3', reverse: i % 2 === 1})).map(c =>
            ({...c, file: `${c.directory}/${workload === 'motion' ? 'abba.json' : 'f0-abba/abba.json'}`})),
        ...[false, true].map(reverse => ({node: 'v20.20.2', reverse,
            file: `${mode}/vps-${workload}-${reverse ? 'reverse' : 'primary'}${workload === 'motion' ? '.json' : '/abba.json'}`}))
    ];
}
test('targeted recipes bind pinned optimizer, exact original source metadata and unchanged glue', () => {
    for (const mode of modes) {
        const baseline = json(`${mode}/baseline/BUILD-INFO.json`), candidate = json(`${mode}/candidate/BUILD-INFO.json`);
        assert.equal(baseline.ref, ref); assert.equal(candidate.ref, ref);
        assert.equal(sha256(read(`${mode}/baseline/BUILD-INFO.json`)), sourceInfo);
        assert.equal(read(`${mode}/candidate/SOURCE-BUILD-INFO.json`), read(`${mode}/baseline/BUILD-INFO.json`));
        const p = candidate.postprocess;
        assert.equal(p.mode, mode); assert.deepEqual(p.flags, modeFlags(mode));
        assert.equal(p.sourceBuildInfoSha256, sourceInfo);
        assert.equal(p.toolSha256, BINARYEN.toolSha256);
        assert.equal(p.releaseArchiveSha256, BINARYEN.archiveSha256);
        assert.equal(p.versionOutput, BINARYEN.versionOutput);
        assert.deepEqual(p.sourceTargets, baseline.targets);
        assert.equal(p.publication, false); assert.equal(p.appPinChanges, false);
        assert.equal(p.diagnosticOnly, true);
        for (const target of ['nodejs', 'web']) {
            assert.deepEqual(candidate.targets[target]['labwired_wasm.js'], baseline.targets[target]['labwired_wasm.js']);
            assert.equal(baseline.targets[target]['labwired_wasm_bg.wasm'].sha256, '7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d');
            assert.notEqual(candidate.targets[target]['labwired_wasm_bg.wasm'].sha256, baseline.targets[target]['labwired_wasm_bg.wasm'].sha256);
        }
        assert.deepEqual(candidate.targets.nodejs['labwired_wasm_bg.wasm'], candidate.targets.web['labwired_wasm_bg.wasm']);
    }
});
test('targeted motion receipts retain every observation, median, minimum and qualification result', () => {
    for (const mode of modes) for (const {file, node, reverse} of captures(mode, 'motion')) {
        const r = json(file); bind(r, mode, node, reverse);
        const parsed = r.runs.map(run => motionProbeResult(run.stdout, run.exitCode));
        for (const [i, p] of parsed.entries()) assert.deepEqual(p.samples, r.runs[i].samples);
        for (const p of parsed) assertSameMotionGuest(parsed[0], p);
        for (const label of ['baseline', 'candidate']) summary(r.summary[label], parsed.flatMap((p, i) =>
            r.runs[i].label === label ? p.samples.map(s => s.rtx) : []));
        assert.equal(r.summary.candidateMedianRatio, r.summary.candidate.medianRtx / r.summary.baseline.medianRtx);
    }
});
test('targeted F0 receipts reparse actual child stdout and all RAM/GPIO tradeoffs', () => {
    for (const mode of modes) for (const {file, node, reverse} of captures(mode, 'f0')) {
        const r = json(file); bind(r, mode, node, reverse);
        const directory = file.slice(0, -'/abba.json'.length);
        const parsed = r.runs.map((run, i) => {
            assert.equal(run.capture.node, node);
            assert.deepEqual(run.capture.buildInfo, json(`${mode}/${run.label}/BUILD-INFO.json`));
            const p = f0TimingResult(read(`${directory}/${i + 1}-${run.label}/ordinary-stdout.txt`), run.capture.ordinary.exitCode);
            assert.deepEqual(p.workloads, run.capture.ordinary.workloads); return p;
        });
        for (const p of parsed) assertSameF0Guest(parsed[0], p);
        for (const w of ['ram', 'gpio']) {
            for (const label of ['baseline', 'candidate']) summary(r.summary[w][label], parsed.flatMap((p, i) =>
                r.runs[i].label === label ? p.workloads[w].samples.map(s => s.rtx) : []));
            assert.equal(r.summary[w].candidateMedianRatio, r.summary[w].candidate.medianRtx / r.summary[w].baseline.medianRtx);
        }
    }
});
test('targeted integration and fresh floors stay separate from A/B and disabled production', () => {
    for (const mode of modes) {
        const p = json(`${mode}/pipeline.json`);
        assert.ok(p.completedAt && !p.error);
        assert.equal(p.toolHead, 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162');
        for (const key of ['automaticMerge', 'publication', 'appPinChanges']) assert.equal(p[key], false);
        for (const label of ['baseline', 'candidate']) {
            assert.equal(p.sources[label].commit, ref);
            assert.equal(p.verifications[label].integrationTests, 101);
            assert.match(read(`${mode}/${label}-integration.txt`), /^tests=101 fail=0 skipped=0\s*$/m);
            const q = p.verifications[label].qualification;
            assert.deepEqual(motionProbeResult(read(`${mode}/${label}-qualification.txt`), q.allWindowsMeet1x ? 0 : 1), q);
        }
        assert.equal(p.comparisons.length, 4);
        for (const c of p.comparisons) {
            assert.deepEqual(c.summary, json(`${mode}/hosted-ab-${c.repeat}/abba.json`).summary);
            assert.deepEqual(c.f0Summary, json(`${mode}/hosted-ab-${c.repeat}/f0-abba/abba.json`).summary);
        }
    }
    const v = json('vps-summary.json');
    assert.ok(v.completedAt && !v.error); assert.equal(v.runs.length, 8);
    for (const key of ['publication', 'appPinChanges', 'hardwareAcknowledgementChanges']) assert.equal(v[key], false);
    const combinations = new Set();
    for (const run of v.runs) {
        assert.ok(modes.includes(run.mode) && ['motion', 'f0'].includes(run.workload));
        assert.equal(typeof run.reverse, 'boolean');
        combinations.add(`${run.mode}/${run.workload}/${run.reverse}`);
        const file = `${run.mode}/vps-${run.workload}-${run.reverse ? 'reverse' : 'primary'}${run.workload === 'motion' ? '.json' : '/abba.json'}`;
        assert.equal(sha256(read(file)), run.sha256);
        assert.deepEqual(json(file).summary, run.summary);
    }
    assert.equal(combinations.size, 8);
});
test('targeted raw receipts are byte-identical to original measurement outputs', () => {
    const m = json('EVIDENCE-SHA256.json'); assert.equal(m.schema, 1);
    assert.ok(m.files.length > 200);
    for (const f of m.files) {
        assert.ok(!f.path.startsWith('/') && !f.path.split('/').includes('..'));
        const bytes = readFileSync(new URL(f.path, root));
        assert.equal(bytes.length, f.bytes, f.path); assert.equal(sha256(bytes), f.sha256, f.path);
        if (f.encoding) {
            assert.equal(f.encoding, 'base64');
            const wrapper = JSON.parse(bytes), original = Buffer.from(wrapper.data, 'base64');
            assert.equal(wrapper.encoding, 'base64');
            assert.equal(wrapper.originalPath, f.originalPath);
            assert.equal(original.length, f.originalBytes);
            assert.equal(sha256(original), f.originalSha256);
            assert.equal(wrapper.originalSha256, f.originalSha256);
        }
    }
});
