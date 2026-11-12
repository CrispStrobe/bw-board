import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MOTION_SOURCE as S, admitMotionTransfer, validateMotionEngine, validateMotionSources}
    from '../scripts/prepare-labwired-motion-diagnostic.mjs';
const run = (id, head, conclusion = 'success') => ({id, head_sha: head, status: 'completed',
    run_attempt: 1, event: 'workflow_dispatch', conclusion,
    repository: {full_name: S.repository}, head_repository: {full_name: S.repository}});
const fixture = () => ({
    originalRun: {...run(S.run, S.producer, 'failure'), path: '.github/workflows/labwired-wasm.yml'},
    originalJobs: {jobs: [{name: 'build (a)', status: 'completed', conclusion: 'success'}]},
    originalArtifacts: {artifacts: [{id: S.artifact, name: 'labwired-wasm-a', digest: S.archive}]},
    release: {id: S.release.id, tag_name: S.release.tag, draft: false, prerelease: false,
        assets: Object.entries(S.release.assets).map(([name,id]) => {
            const expected = S.files[name.replace(/^nodejs-/, '')] || S.notices[name];
            return {id,name,size:expected.bytes,digest:'sha256:' + expected.sha256};
        })},
    transferRun: run(9001, 'a'.repeat(40)),
    transferArtifacts: {artifacts: [{id: 9002, name: 'motion-source-retained-engine', expired: false,
        digest: 'sha256:' + 'b'.repeat(64), size_in_bytes: 100}]},
    request: {custodyAcknowledged: true, transferRun: 9001, transferArtifact: 9002,
        transferHead: 'a'.repeat(40), transferDigest: 'sha256:' + 'b'.repeat(64)}
});
test('metadata admits only a separate declared retained-byte transfer, preserves failure', () => {
    const result = admitMotionTransfer(fixture());
    assert.equal(result.referenceRun, S.run);
    assert.equal(result.transferArtifact, 9002);
    assert.equal(result.diagnosticOnly, true);
});
const cuts = [
    ['reference release draft', p => {p.release.draft = true;}],
    ['wrong release asset', p => {p.release.assets[0].id++;}],
    ['wrong release digest', p => {p.release.assets[0].digest = 'sha256:' + '0'.repeat(64);}],
    ['custody ACK', p => {p.request.custodyAcknowledged = false;}],
    ['original run reacquisition', p => {p.request.transferRun = S.run;}],
    ['original artifact reacquisition', p => {p.request.transferArtifact = S.artifact;}],
    ['foreign transfer repository', p => {p.transferRun.repository.full_name = 'another/repo';}],
    ['foreign head repository', p => {p.transferRun.head_repository.full_name = 'another/repo';}],
    ['wrong transfer head', p => {p.transferRun.head_sha = 'c'.repeat(40);}],
    ['unfinished run', p => {p.transferRun.status = 'in_progress';}],
    ['rerun', p => {p.transferRun.run_attempt = 2;}],
    ['unsupported event', p => {p.transferRun.event = 'pull_request';}],
    ['unsuccessful transfer', p => {p.transferRun.conclusion = 'failure';}],
    ['wrong producer', p => {p.originalRun.head_sha = 'd'.repeat(40);}],
    ['erased original failure', p => {p.originalRun.conclusion = 'success';}],
    ['wrong original workflow', p => {p.originalRun.path = '.github/workflows/other.yml';}],
    ['build A failed', p => {p.originalJobs.jobs[0].conclusion = 'failure';}],
    ['build B substituted', p => {p.originalJobs.jobs[0].name = 'build (b)';}],
    ['ambiguous build A', p => {p.originalJobs.jobs.push({...p.originalJobs.jobs[0]});}],
    ['wrong original digest', p => {p.originalArtifacts.artifacts[0].digest = 'sha256:' + 'f'.repeat(64);}],
    ['wrong transfer identity', p => {p.transferArtifacts.artifacts[0].id++;}],
    ['expired transfer', p => {p.transferArtifacts.artifacts[0].expired = true;}],
    ['wrong transfer digest', p => {p.transferArtifacts.artifacts[0].digest = S.archive;}],
    ['oversized transfer', p => {p.transferArtifacts.artifacts[0].size_in_bytes = 64 * 1024 * 1024 + 1;}],
    ['ambiguous transfer', p => {p.transferArtifacts.artifacts.push({...p.transferArtifacts.artifacts[0]});}]
];
for (const [name, mutate] of cuts) test('refuses before any engine access: ' + name, () => {
    const packet = fixture(); mutate(packet);
    assert.throws(() => admitMotionTransfer(packet), {name: 'AssertionError'});
});
test('runtime/source/retained-byte evidence refuses before engine code could execute', () => {
    const input = {info: {schema: 'labwired.retained-byte-manifest.v1', ref: S.core, targets: {nodejs: S.files}},
        transfer: {referenceRun: S.run, referenceArtifact: S.artifact, referenceArchive: S.archive,
            retainedSource: {kind: 'byte-equivalent-release-assets', tag: S.release.tag, assets: {...S.release.assets}},
            verifiedRetainedBytes: true}, read: () => {throw Error('engine read');}, nodeVersion: S.node};
    for (const field of ['nodeVersion', 'info', 'transfer']) {
        const changed = structuredClone({nodeVersion: input.nodeVersion, info: input.info, transfer: input.transfer});
        if (field === 'nodeVersion') changed.nodeVersion = 'v22.23.3';
        if (field === 'info') changed.info.ref = '0'.repeat(40);
        if (field === 'transfer') changed.transfer.verifiedRetainedBytes = false;
        assert.throws(() => validateMotionEngine({...input, ...changed}), {name: 'AssertionError'});
    }
    assert.throws(() => validateMotionEngine({...input, read: () => Buffer.alloc(0)}), /exact retained bytes/);
    assert.throws(() => validateMotionEngine({...input, transfer: {...input.transfer, retainedSource: {kind: 'original-artifact'}}}), /retained-byte source kind/);
    assert.throws(() => validateMotionEngine({...input, info: {...input.info, schema: 'producer-build-info'}}), /normalized retained-byte manifest/);
});
test('actual held harness, guest, adapter, bridge and diagnostic sources remain exact', () => {
    const read = name => readFileSync(new URL('../' + name, import.meta.url));
    validateMotionSources(read);
    assert.throws(() => validateMotionSources(name => Buffer.concat([read(name), Buffer.from('\n')])));
});
test('workflow selects only manual execution, verified transfer, exact runtime and separate profile modes', () => {
    const source = readFileSync(new URL('../.github/workflows/labwired-motion-source-profile.yml', import.meta.url), 'utf8');
    assert.match(source, /on:\n  workflow_dispatch:/);
    assert.doesNotMatch(source, /^  (push|pull_request|schedule):/m);
    assert.match(source, /node-version: 22\.23\.4/);
    assert.match(source, /metadata evidence evidence\/admission.json/);
    assert.ok(source.indexOf('metadata evidence') < source.indexOf('Acquire admitted transfer once'));
    assert.match(source, /engine \.\.\/engine \.\.\/evidence\/engine-admission.json/);
    assert.ok(source.indexOf('engine ../engine ../evidence/engine-admission.json') < source.indexOf('scripts\/profile-labwired-motion.mjs --wasm'));
    assert.match(source, /for mode in trace-default sampled-default; do/);
    assert.match(source, /git worktree add --detach producer-source 0f78a4a873f3126c24717903ab09de1a34031c2c/);
    assert.match(source, /cd producer-source && node scripts\/profile-labwired-motion.mjs/);
    assert.match(source, /if: always\(\)/);
    assert.doesNotMatch(source, /actions\/download-artifact|workflow_run|vercel|publish: true/);
    assert.match(source, /artifact==13932494417: raise ValueError\('original acquisition forbidden'\)/);
    assert.match(source, /hashlib.sha256\(raw\).hexdigest\(\)!=admitted\['transferDigest'\]/);
    assert.match(source, /receipt.guestSha256, MOTION_SOURCE.guest/);
});
