#!/usr/bin/env node
// Admit retained, unpublished engine bytes before a fresh hosted qualification.
// This never imports or executes the engine and never changes its bytes.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {lstatSync, readFileSync, readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const recordPath = path.join(root, 'test/fixtures/labwired/uarte-stack/retained-build.json');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const fullSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const names = ['build (a)', 'build (b)', 'determinism', 'test', 'motion', 'publish'];
const outcomes = ['success', 'success', 'success', 'failure', 'skipped', 'skipped'];

export function validateMetadata (record, {run, jobs, artifacts}, sourceRef) {
    assert.equal(record.schema, 1, 'retained record schema');
    assert.equal(record.repository, 'CrispStrobe/bw-board', 'owned repository');
    assert.equal(record.workflowPath, '.github/workflows/labwired-wasm.yml', 'canonical original workflow');
    assert.ok(fullSha(record.sourceRef) && fullSha(record.producerHead), 'exact source and producer');
    assert.equal(sourceRef, record.sourceRef, 'requested source');
    assert.equal(run.id, record.runId, 'original run identity');
    assert.equal(run.repository.full_name, record.repository, 'run repository');
    assert.equal(run.head_sha, record.producerHead, 'original producer head');
    assert.equal(run.path, record.workflowPath, 'original workflow');
    assert.equal(run.event, 'workflow_dispatch', 'original event');
    assert.equal(run.status, 'completed', 'original run terminal');
    assert.equal(run.conclusion, 'failure', 'original failure stays failed');
    assert.equal(jobs.total_count, jobs.jobs.length, 'complete job page');
    assert.equal(jobs.jobs.length, names.length, 'original job inventory');
    for (const [index, name] of names.entries()) {
        const matches = jobs.jobs.filter(job => job.name === name);
        assert.equal(matches.length, 1, `unique original job: ${name}`);
        const job = matches[0];
        assert.equal(job.id, record.originalJobs[name].id, `original job ID: ${name}`);
        assert.equal(job.run_id, record.runId, `original job run: ${name}`);
        assert.equal(job.head_sha, record.producerHead, `original job head: ${name}`);
        assert.equal(job.status, 'completed', `original job terminal: ${name}`);
        assert.equal(job.conclusion, outcomes[index], `original job result: ${name}`);
        assert.equal(record.originalJobs[name].conclusion, outcomes[index], `recorded result: ${name}`);
    }
    assert.equal(artifacts.total_count, artifacts.artifacts.length, 'complete artifact page');
    assert.equal(artifacts.artifacts.length, 2, 'original artifact inventory');
    for (const leg of ['a', 'b']) {
        const expected = record.artifacts[leg];
        const matches = artifacts.artifacts.filter(artifact => artifact.name === expected.name);
        assert.equal(matches.length, 1, `unique artifact: ${leg}`);
        const artifact = matches[0];
        assert.equal(artifact.id, expected.id, `artifact ID: ${leg}`);
        assert.equal(artifact.expired, false, `artifact expiry: ${leg}`);
        assert.equal(artifact.workflow_run.id, record.runId, `artifact run: ${leg}`);
        assert.equal(artifact.workflow_run.head_sha, record.producerHead, `artifact head: ${leg}`);
        assert.equal(artifact.size_in_bytes, expected.sizeInBytes, `artifact size: ${leg}`);
        assert.equal(artifact.digest, `sha256:${expected.archiveSha256}`, `artifact digest: ${leg}`);
    }
}

export function validateFiles (record, leg, directory) {
    assert.ok(leg === 'a' || leg === 'b', 'retained build leg');
    const expected = record.artifacts[leg].files;
    const actual = [];
    function walk (relative = '') {
        const full = path.join(directory, relative);
        const stat = lstatSync(full);
        assert.equal(stat.isSymbolicLink(), false, 'no retained symlink');
        if (stat.isDirectory()) {
            for (const name of readdirSync(full)) walk(relative ? `${relative}/${name}` : name);
        } else {
            assert.ok(stat.isFile(), 'regular retained file');
            actual.push(relative);
        }
    }
    walk();
    assert.deepEqual(actual.sort(), Object.keys(expected).sort(), 'exact retained file inventory');
    for (const name of actual) {
        assert.ok(!name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'), 'safe retained member');
        const bytes = readFileSync(path.join(directory, name));
        assert.equal(bytes.length, expected[name].bytes, `retained byte count: ${name}`);
        assert.equal(sha256(bytes), expected[name].sha256, `retained hash: ${name}`);
    }
    const info = JSON.parse(readFileSync(path.join(directory, 'BUILD-INFO.json')));
    assert.equal(info.ref, record.sourceRef, 'retained manifest source');
    assert.equal(info.wasmBindgen, record.wasmBindgen, 'retained bindings version');
    assert.deepEqual(Object.keys(info.targets).sort(), ['nodejs', 'web'], 'retained targets');
    for (const target of ['nodejs', 'web']) {
        assert.deepEqual(Object.keys(info.targets[target]).sort(), ['labwired_wasm.js', 'labwired_wasm_bg.wasm'], 'engine inventory');
        for (const name of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
            const manifest = info.targets[target][name];
            const original = expected[`${target}/${name}`];
            assert.equal(manifest.bytes, original.bytes, 'manifest byte count');
            assert.equal(manifest.sha256, original.sha256, 'manifest hash');
        }
        const wasm = readFileSync(path.join(directory, target, 'labwired_wasm_bg.wasm'));
        assert.deepEqual([...wasm.subarray(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0], 'WASM header');
    }
}

function main () {
    const [mode, leg, sourceRef, directory] = process.argv.slice(2);
    assert.ok(mode === 'metadata' || mode === 'files', 'mode must be metadata or files');
    assert.ok(leg === 'a' || leg === 'b', 'leg must be a or b');
    const record = JSON.parse(readFileSync(recordPath));
    assert.equal(record.repository, 'CrispStrobe/bw-board', 'owned repository before API access');
    assert.ok(Number.isSafeInteger(record.runId) && record.runId > 0, 'exact original run ID');
    assert.ok(fullSha(sourceRef) && fullSha(record.producerHead), 'exact retained source and producer');
    assert.equal(sourceRef, record.sourceRef, 'explicit retained source');
    const producer = readFileSync(path.join(root, 'scripts/build-labwired-wasm.mjs'), 'utf8');
    assert.ok(producer.includes(`const PIN = '${sourceRef}';`), 'retained source must equal current producer PIN');
    if (mode === 'metadata') {
        assert.equal(directory, undefined, 'metadata mode takes no directory');
        const api = endpoint => JSON.parse(execFileSync('gh', ['api', `repos/${record.repository}/actions/${endpoint}`], {encoding: 'utf8'}));
        validateMetadata(record, {
            run: api(`runs/${record.runId}`),
            jobs: api(`runs/${record.runId}/jobs?per_page=100`),
            artifacts: api(`runs/${record.runId}/artifacts?per_page=100`)
        }, sourceRef);
    } else {
        assert.ok(directory, 'files mode requires the downloaded directory');
        validateFiles(record, leg, directory);
    }
    console.log(`Admitted retained ${mode}: run=${record.runId} producer=${record.producerHead} source=${record.sourceRef} leg=${leg}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
