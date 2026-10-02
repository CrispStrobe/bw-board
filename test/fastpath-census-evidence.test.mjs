import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {validateCensus} from '../scripts/lib/fastpath-census-receipt.mjs';

const archive = new URL('../docs/receipts/2026-10-02-wasm-fastpath-census/', import.meta.url);
const repo = fileURLToPath(new URL('../', import.meta.url));
const bytes = path => readFileSync(new URL(path, archive));
const json = path => JSON.parse(bytes(path));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = '16c501c0506d4bde312a04fc4f9d4ae5f8e4b2ec';

test('census archive preserves all manifest files and reversible originals', () => {
    const manifest = json('manifest.json');
    assert.equal(manifest.files.length, 17);
    assert.equal(new Set(manifest.files.map(file => file.path)).size, 17);
    for (const file of manifest.files) {
        const data = bytes(file.path);
        assert.equal(data.length, file.bytes);
        assert.equal(hash(data), file.sha256, file.path);
        if (file.original) {
            const wrapper = JSON.parse(data);
            assert.equal(wrapper.originalPath, file.original.path);
            assert.equal(wrapper.encoding, file.original.encoding);
            const decoded = Buffer.from(wrapper.data, wrapper.encoding);
            assert.equal(decoded.length, file.original.bytes);
            assert.equal(hash(decoded), file.original.sha256);
            if (wrapper.sha256) assert.equal(hash(decoded), wrapper.sha256);
            if (wrapper.bytes) assert.equal(decoded.length, wrapper.bytes);
        }
    }
});
test('all twelve actual windows have exact accounting and repeat identically', () => {
    const first = json('vps-first/receipt.json'), repeat = json('vps-repeat/receipt.json');
    for (const name of ['ram', 'gpio']) {
        assert.deepEqual(first.workloads[name].samples, repeat.workloads[name].samples);
        for (const key of ['imageSha256', 'chipYamlSha256', 'systemYamlSha256']) {
            assert.equal(first.workloads[name][key], repeat.workloads[name][key]);
        }
    }
    for (const [directory, run] of [['vps-first', first], ['vps-repeat', repeat]]) {
        assert.equal(run.diagnosticOnly, true);
        assert.equal(run.source, source);
        assert.equal(run.node, 'v20.20.2');
        assert.equal(run.warmupCycles, 200_000);
        assert.equal(run.windowCycles, 2_000_000);
        for (const [path, declared] of Object.entries(run.files)) {
            assert.equal(hash(readFileSync(resolve(repo, path))), declared, path);
        }
        assert.deepEqual(Object.keys(run.workloads).sort(), ['gpio', 'ram']);
        for (const [name, result] of Object.entries(run.workloads)) {
            for (const [extension, declared] of [['elf', result.elfSha256], ['bin', result.imageSha256]]) {
                const wrapper = json(`${directory}/${name}.${extension}.base64.json`);
                assert.equal(hash(Buffer.from(wrapper.data, 'base64')), declared);
            }
            assert.deepEqual(result.samples.map(sample => sample.high), [false, true, false]);
            let previous = 0;
            for (const sample of result.samples) {
                assert.deepEqual(validateCensus(sample.counts), sample.summary);
                assert.equal(sample.summary.countedRetired, 2_000_000);
                assert.equal(sample.cycles, 2_000_000);
                const guest = sample.guest;
                assert.ok(guest.iterations > previous);
                assert.ok([(guest.checksum ^ 255) >>> 0, guest.mirror].every(prior =>
                    prior === guest.iterations || prior === guest.iterations - 1));
                assert.equal(guest.input, name === 'gpio' && sample.high ? 2 : 0);
                assert.equal(guest.output, name === 'gpio' ? (sample.high ? 1 : 0) : null);
                if (name === 'ram') {
                    assert.equal(sample.counts.BlockRetired, 2_000_000);
                    assert.equal(sample.counts.FastZero, 0);
                    assert.equal(sample.counts.GpioColdCalls, 0);
                } else {
                    assert.equal(sample.counts.BlockCalls, sample.counts.BlockZero);
                    assert.equal(sample.counts.GpioColdCalls, sample.counts.GpioNoEdgeDevices);
                    assert.equal(sample.counts.GpioHostedServices, 0);
                }
                previous = guest.iterations;
            }
        }
    }
});
test('CI source provenance and actual 101-test integration are retained', () => {
    const run = JSON.parse(json('diagnostic-run.json.utf8.json').data);
    assert.equal(run.head_sha, source);
    assert.equal(run.id, 37009962397);
    assert.equal(run.conclusion, 'success');
    assert.equal(bytes('artifact/source-head.txt').toString().trim(), source);
    const receipt = json('vps-first/receipt.json');
    for (const [name, artifact] of Object.entries(receipt.artifact)) {
        const line = bytes('artifact/sha256.txt').toString().split('\n')
            .find(line => line.endsWith(`  fastpath-census/nodejs/${name}`));
        assert.ok(line);
        assert.equal(line.slice(0, 64), artifact.sha256);
    }
    const log = bytes('integration-tool-output.txt').toString();
    assert.match(log, /^# tests 101$/m);
    assert.match(log, /^# pass 101$/m);
    assert.match(log, /^# fail 0$/m);
    assert.match(log, /^# skipped 0$/m);
});
