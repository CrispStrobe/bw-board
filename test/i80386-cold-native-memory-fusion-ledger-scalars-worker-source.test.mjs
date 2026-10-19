import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateScalarOverlay} from '../scripts/cold-native-memory-fusion-ledger-scalars-performance/admission.mjs';
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root),'utf8');
const base='scripts/cold-native-memory-fusion-ledger-scalars-performance/';
test('owned pending scalar profile refuses; manufactured ready metadata is closed',()=>{
 const b=JSON.parse(read(base+'scalar-overlay.json'));const pending=structuredClone(b);pending.status='PENDING_ROOT_SOURCE_REVIEW';assert.throws(()=>validateScalarOverlay(pending),/pending/);
 const ready=structuredClone(b);ready.status='ROOT_REVIEWED_SCALAR_WORKER_SOURCE_READY';assert.equal(validateScalarOverlay(ready),ready);
 for(const key of ['profile','providerRevision','heldWorkerRevision']){const bad=structuredClone(ready);bad[key]='changed';assert.throws(()=>validateScalarOverlay(bad));}
 const bad=structuredClone(ready);bad.files[Object.keys(bad.files)[0]]='0'.repeat(64);assert.throws(()=>validateScalarOverlay(bad));
});
test('held timer loop and strict terminal protocol remain exact',()=>{
 const d=JSON.parse(read(base+'scalar-worker-derivation.json')),old=read('scripts/cold-native-memory-fusion-performance/worker.mjs'),candidate=read(base+'worker.mjs');
 let inverse=old;for(const e of d.workerEdits){assert.equal(inverse.split(e.before).length-1,e.count);inverse=inverse.replace(e.before,e.after);}assert.equal(inverse,candidate);
 const sha=s=>createHash('sha256').update(s).digest('hex');assert.equal(sha(old),d.heldWorkerSha256);
 const begin='  const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();',end='  // Evidence, settlement';
 const loop=s=>s.slice(s.indexOf(begin),s.indexOf(end));assert.equal(loop(candidate),loop(old));assert.equal(sha(loop(candidate)),d.timerLoopSha256);
 assert.equal(read(base+'protocol.mjs'),read('scripts/cold-native-memory-fusion-performance/protocol.mjs'));assert.equal(sha(read(base+'protocol.mjs')),d.heldProtocolSha256);
 assert.equal(read(base+'snapshot.mjs'),read('scripts/cold-native-memory-fusion-performance/snapshot.mjs'));
});
test('fixed overlay gate precedes compiled imports and fixed own factory construction',()=>{
 const s=read(base+'worker.mjs');assert.ok(s.indexOf('receipt.scalarOverlay=authenticateScalarOverlay()')<s.indexOf('identity=await import'));
 assert.ok(s.includes("resolve(sourceRoot,'scripts/bochs-cpu3-native-cold-memory-fusion-ledger-scalars/factory.mjs')"));assert.ok(s.includes('providers.createOwnedMemoryFusionLedgerScalarProvider()'));
 assert.ok(!s.includes('providers.createOwnedMemoryFusionProvider()'));
 const b=JSON.parse(read(base+'capture-binding.json'));assert.equal(b.candidateBuild.sourceRevision,'85fc1599af0ee71e32208da9d36caac86daa3b8c');assert.equal(b.candidateBuild.sourceInputs,151);assert.equal(b.candidateBuild.addonSha256,'7de755f02b385149e17abfb086972bc73cbcb3fac5294f758eda5a4ab97d2351');
});
