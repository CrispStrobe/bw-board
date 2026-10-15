import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync, writeFileSync, appendFileSync, rmSync, mkdirSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateMetadata, validateFiles} from '../scripts/admit-labwired-retained-build.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const source = 'a'.repeat(40);
const producer = 'b'.repeat(40);
function fixture () {
    const originalJobs = {};
    const jobs = ['build (a)', 'build (b)', 'determinism', 'test', 'motion', 'publish'].map((name, index) => {
        const conclusion = ['success', 'success', 'success', 'failure', 'skipped', 'skipped'][index];
        originalJobs[name] = {id: 10 + index, conclusion};
        return {name, id: 10 + index, run_id: 1, head_sha: producer, status: 'completed', conclusion};
    });
    const artifacts = ['a', 'b'].map((leg, index) => ({id: 20 + index, name: `labwired-wasm-${leg}`,
        size_in_bytes: 100, digest: `sha256:${'c'.repeat(64)}`, expired: false,
        workflow_run: {id: 1, head_sha: producer}}));
    const record = {schema: 1, repository: 'CrispStrobe/bw-board', sourceRef: source,
        producerHead: producer, runId: 1, workflowPath: '.github/workflows/labwired-wasm.yml',
        wasmBindgen: 'test-version', originalJobs, artifacts: Object.fromEntries(artifacts.map((a, i) =>
            [['a', 'b'][i], {id: a.id, name: a.name, sizeInBytes: a.size_in_bytes,
                archiveSha256: a.digest.slice(7), files: {}}]))};
    return {record, metadata: {run: {id: 1, repository: {full_name: record.repository}, head_sha: producer,
        path: record.workflowPath, event: 'workflow_dispatch', status: 'completed', conclusion: 'failure'},
    jobs: {total_count: jobs.length, jobs}, artifacts: {total_count: 2, artifacts}}};
}
function fileFixture (t) {
    const {record} = fixture();
    const directory = mkdtempSync(path.join(tmpdir(), 'retained-engine-admission-'));
    t.after(() => rmSync(directory, {recursive: true, force: true}));
    const files = {};
    const info = {ref: source, wasmBindgen: record.wasmBindgen, targets: {nodejs: {}, web: {}}};
    for (const target of ['nodejs', 'web']) {
        mkdirSync(path.join(directory, target));
        for (const name of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
            const bytes = name.endsWith('.wasm') ? Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]) : Buffer.from('// retained test glue\n');
            files[`${target}/${name}`] = {bytes: bytes.length, sha256: hash(bytes)};
            info.targets[target][name] = files[`${target}/${name}`];
            writeFileSync(path.join(directory, target, name), bytes);
        }
    }
    const bytes = Buffer.from(JSON.stringify(info));
    writeFileSync(path.join(directory, 'BUILD-INFO.json'), bytes);
    files['BUILD-INFO.json'] = {bytes: bytes.length, sha256: hash(bytes)};
    record.artifacts.a.files = files;
    return {record, directory};
}

test('admits terminal original pair metadata while preserving its failed suite', () => {
    const {record, metadata} = fixture();
    validateMetadata(record, metadata, source);
    assert.equal(metadata.run.conclusion, 'failure');
    assert.equal(metadata.jobs.jobs.find(j => j.name === 'test').conclusion, 'failure');
});
test('refuses another requested core source', () => {
    const {record, metadata} = fixture();
    assert.throws(() => validateMetadata(record, metadata, producer), /requested source/);
});
test('refuses a failed independent comparison', () => {
    const {record, metadata} = fixture();
    metadata.jobs.jobs.find(j => j.name === 'determinism').conclusion = 'failure';
    assert.throws(() => validateMetadata(record, metadata, source), /original job result/);
});
test('refuses a different producer even on the same run ID', () => {
    const {record, metadata} = fixture();
    metadata.run.head_sha = source;
    assert.throws(() => validateMetadata(record, metadata, source), /producer head/);
});
test('refuses duplicate same-name jobs and incomplete pages', () => {
    const {record, metadata} = fixture();
    metadata.jobs.jobs[2].name = 'test';
    assert.throws(() => validateMetadata(record, metadata, source), /unique original job/);
    metadata.jobs.total_count++;
    assert.throws(() => validateMetadata(record, metadata, source), /complete job page/);
});
test('refuses expired or replaced artifact bytes', () => {
    const {record, metadata} = fixture();
    metadata.artifacts.artifacts[0].expired = true;
    assert.throws(() => validateMetadata(record, metadata, source), /artifact expiry/);
    metadata.artifacts.artifacts[0].expired = false;
    metadata.artifacts.artifacts[0].digest = `sha256:${'d'.repeat(64)}`;
    assert.throws(() => validateMetadata(record, metadata, source), /artifact digest/);
});
test('admits only the recorded manifest, glue and actual WASM headers', t => {
    const {record, directory} = fileFixture(t);
    validateFiles(record, 'a', directory);
});
test('refuses modified retained executable bytes', t => {
    const {record, directory} = fileFixture(t);
    appendFileSync(path.join(directory, 'nodejs/labwired_wasm.js'), 'changed');
    assert.throws(() => validateFiles(record, 'a', directory), /retained byte count/);
});
test('refuses an added executable not in the retained inventory', t => {
    const {record, directory} = fileFixture(t);
    writeFileSync(path.join(directory, 'nodejs/extra.js'), 'extra');
    assert.throws(() => validateFiles(record, 'a', directory), /exact retained file inventory/);
});
test('refuses a symlink before reading retained payloads', t => {
    const {record, directory} = fileFixture(t);
    symlinkSync('labwired_wasm.js', path.join(directory, 'nodejs/extra.js'));
    assert.throws(() => validateFiles(record, 'a', directory), /no retained symlink/);
});
