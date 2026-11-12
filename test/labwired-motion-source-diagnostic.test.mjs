import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MOTION_SOURCE as S, admitMotionTransfer, validateMotionEngine, validateMotionSources, motionElfImage}
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
    assert.match(source, /guest.sha256, MOTION_SOURCE.guestImageSha256/);
    assert.match(source, /guest.fullElfSha256 === receipt.guestSha256/);
    assert.match(source, /MOTION_SOURCE.gcc/);
    assert.match(source, /MOTION_SOURCE.linker/);
});

const tinyElf = () => {
    const b = Buffer.alloc(192);
    Buffer.from([0x7f,69,76,70,1,1,1]).copy(b);
    b.writeUInt16LE(2,16); b.writeUInt16LE(40,18); b.writeUInt32LE(1,20);
    b.writeUInt32LE(0x101,24); b.writeUInt32LE(52,28); b.writeUInt32LE(0x5000200,36);
    b.writeUInt16LE(52,40); b.writeUInt16LE(32,42); b.writeUInt16LE(1,44);
    [1,128,0x100,0x100,8,8,5,1].forEach((value,i)=>b.writeUInt32LE(value,52+4*i));
    Buffer.from([0,1,2,3,4,5,6,7]).copy(b,128);
    return b;
};
test('ELF image preserves entry, flags and exact loaded bytes while excluding non-loadable names', () => {
    const a=tinyElf(), b=Buffer.from(a);b[180]=99;
    const x=motionElfImage(a),y=motionElfImage(b);
    assert.equal(x.sha256,y.sha256);
    assert.notEqual(x.fullElfSha256,y.fullElfSha256);
    assert.deepEqual(x.segments,[{vaddr:256,paddr:256,filesz:8,memsz:8,flags:5,align:1}]);
    for(const change of [b=>{b[128]^=1;},b=>b.writeUInt32LE(0x103,24),b=>b.writeUInt32LE(0x5000000,36),b=>b.writeUInt32LE(9,72)]) {
        const mutant=tinyElf();change(mutant);
        assert.notEqual(motionElfImage(mutant).sha256,x.sha256,'loadable/header mutation must change binding');
    }
});
const elfCuts=[
    ['wrong byte order',b=>{b[5]=2;}],
    ['wrong CPU',b=>b.writeUInt16LE(3,18)],
    ['not executable',b=>b.writeUInt16LE(1,16)],
    ['truncated header table',b=>b.writeUInt32LE(190,28)],
    ['excess program headers',b=>b.writeUInt16LE(17,44)],
    ['no load image',b=>b.writeUInt32LE(0,52)],
    ['truncated load bytes',b=>b.writeUInt32LE(190,56)],
    ['file exceeds memory',b=>b.writeUInt32LE(4,72)],
    ['entry outside load',b=>b.writeUInt32LE(0x201,24)],
    ['non Thumb entry',b=>b.writeUInt32LE(0x100,24)],
    ['non executable entry',b=>b.writeUInt32LE(4,76)],
    ['overlapping loads',b=>{b.writeUInt16LE(2,44);[1,136,0x104,0x104,4,4,5,1].forEach((v,i)=>b.writeUInt32LE(v,84+4*i));}],
    ['physical alias',b=>{b.writeUInt16LE(2,44);[1,136,0x200,0x100,4,4,5,1].forEach((v,i)=>b.writeUInt32LE(v,84+4*i));}]
];
for(const [name,change] of elfCuts)test('ELF load-image refusal: '+name,()=>{
    const bytes=tinyElf();change(bytes);assert.throws(()=>motionElfImage(bytes),{name:'AssertionError'});
});
