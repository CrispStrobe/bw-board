/** Pure controls: retained ordinary baseline snapshots reconstructed as candidate typed shape; no addon/machine/step. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {validateTypedSlots,plainSnapshot,retainSnapshot,validateRetainedSnapshot,serializeEvidence,validateAddonProfile,slotLengths,stateExportProfile} from '../scripts/cold-native-typed-state-performance/snapshot.mjs';
import {validateCandidateBinding,validateCandidateBuildAudit} from '../scripts/cold-native-typed-state-performance/admission.mjs';
import {wholeNativeWords} from '../scripts/bochs-cpu3-native-cold-bios/parity.mjs';
import {validateInspectMetadata,validateFinalReturn} from '../scripts/cold-native-typed-state-performance/held-protocol.mjs';
const fixture=JSON.parse(readFileSync(new URL('../scripts/cold-native-typed-state-performance/actual-snapshot-fixtures.json',import.meta.url)));
function live(n){const out=structuredClone(n);for(const key of Object.keys(slotLengths))out[key]=Uint32Array.from(n[key]);if(out.sliceBytes)out.sliceBytes=Uint8Array.from(out.sliceBytes);return out;}
test('candidate five typed slots preserve genuine baseline words and JSON evidence exactly',()=>{
 for(const n of [fixture.reset,fixture.finalInspect,fixture.resume]){const typed=live(n);validateTypedSlots(typed);assert.deepEqual(wholeNativeWords(plainSnapshot(typed)),wholeNativeWords(n));assert.deepEqual(JSON.parse(serializeEvidence(typed)),n);}
 validateInspectMetadata(plainSnapshot(live(fixture.reset)));validateInspectMetadata(plainSnapshot(live(fixture.finalInspect)));
});
test('wrong type, length, offset, shared or detached storage refuse',()=>{
 for(const change of [n=>n.state=Array.from(n.state),n=>n.extra=new Uint16Array(20),n=>n.debug=new Uint32Array(5),n=>n.state=new Uint32Array(new ArrayBuffer(84),4,20),n=>n.extra=new Uint32Array(n.state.buffer),n=>n.state=new Uint32Array(new ArrayBuffer(80,{maxByteLength:160})),n=>n.system=new Uint32Array(new SharedArrayBuffer(120)),n=>structuredClone(n.debug.buffer,{transfer:[n.debug.buffer]})]){const n=live(fixture.reset);change(n);assert.throws(()=>validateTypedSlots(n));}
});
test('owned old snapshot remains stable and cannot alias any later slot',()=>{
 const old=live(fixture.reset),next=live(fixture.finalInspect),token=retainSnapshot(old);validateRetainedSnapshot(token,next);next.state[0]^=1;validateRetainedSnapshot(token,next);old.debug[0]^=1;assert.throws(()=>validateRetainedSnapshot(token,next));
 const old2=live(fixture.reset),token2=retainSnapshot(old2),alias=live(fixture.finalInspect);alias.extra=old2.state;assert.throws(()=>validateRetainedSnapshot(token2,alias));assert.throws(()=>validateRetainedSnapshot({kind:'owned-typed-snapshot'},next));
});
test('profile admission requires distinct export plus unchanged ABI4 and methods',()=>{
 const api={abiVersion:4,stateExportProfile,create(){},resume(){},inspect(){},setIRQ(){},close(){}};validateAddonProfile(api);
 for(const change of [{stateExportProfile:undefined},{stateExportProfile:'ordinary-array'},{abiVersion:3},{resume:null}])assert.throws(()=>validateAddonProfile({...api,...change}));
});
test('terminal reconstruction keeps real live slice type and raw166 strict outside timing',()=>{
 // Manufactured terminal-return metadata, not a retained terminal resume.
 const final=live(fixture.finalInspect),last={...live(fixture.finalInspect),activityState:0,reason:1,chargedNativeTicks:1,chargedQuanta:1,sliceBytes:Uint8Array.from(fixture.resume.sliceBytes)};
 validateFinalReturn(plainSnapshot(last),plainSnapshot(final));for(const change of [n=>n.activityState=1,n=>n.state[0]^=1,n=>n.nativeTicks='0',n=>n.sliceBytes=Array.from(n.sliceBytes)]){const n=structuredClone(last);change(n);assert.throws(()=>validateFinalReturn(plainSnapshot(n),plainSnapshot(final)));}
});
test('source-owned pending candidate artifact refuses before execution authority',()=>{
 const b=JSON.parse(readFileSync(new URL('../scripts/cold-native-typed-state-performance/capture-binding.json',import.meta.url)));const input={compiledRevision:b.candidateBuild.sourceRevision,sha256:b.candidateBuild.addonSha256};validateCandidateBinding(b,input);
 const pending=structuredClone(b);pending.status='PENDING_CANDIDATE_BUILD_STATIC_AUDIT';pending.candidateBuild.addonSha256=null;pending.candidateBuild.officialArtifact=null;assert.throws(()=>validateCandidateBinding(pending,input));
 const forged=structuredClone(pending);forged.status='CANDIDATE_BUILD_STATIC_AUDIT_READY';assert.throws(()=>validateCandidateBinding(forged,input));
 const audit=JSON.parse(readFileSync(new URL('../scripts/cold-native-typed-state-performance/build-audit.json',import.meta.url)));validateCandidateBuildAudit(audit,b);for(const change of [{head:'0'.repeat(40)},{addonSha256:'0'.repeat(64)},{stateExportProfile:'ordinary-array'},{sourceInputs:125},{typedNapiSha256:'e4f4e55d139971ba073aa0ff422a6f6f1206587b80fccc88e5f6aba10f8cf1a7'}])assert.throws(()=>validateCandidateBuildAudit({...audit,...change},b));
});

test('complete worker inverse and exact held guards retain b01 measured loop bytes',async()=>{
 const worker=await import('../scripts/cold-native-typed-state-performance/worker.mjs');assert.equal(typeof worker.validateWorkerInput,'function');const {createHash}=await import('node:crypto');const sha=b=>createHash('sha256').update(b).digest('hex');
 const proof=JSON.parse(readFileSync(new URL('../scripts/cold-native-typed-state-performance/worker-derivation.json',import.meta.url)));const source=readFileSync(new URL('../scripts/cold-native-typed-state-performance/worker.mjs',import.meta.url),'utf8');let inverse=source;
 for(const e of [...proof.edits].reverse()){assert.equal(inverse.split(e.next).length,2);inverse=inverse.replace(e.next,e.old);}assert.equal(sha(Buffer.from(inverse)),proof.baseSha256);assert.equal(proof.baseRevision,'b01c922c2d634aba9367f6e2a70d109370e4adee');
 const held=readFileSync(new URL('../scripts/cold-native-typed-state-performance/held-protocol.mjs',import.meta.url));assert.equal(sha(held),proof.heldProtocolSha256);
 const loop=s=>s.slice(s.indexOf('  const startCpu='),s.indexOf('  // Evidence, settlement'));assert.ok(loop(source).length>1000);assert.equal(loop(source),loop(inverse));
});
test('retained fixture origin is genuine ordinary baseline; typed reconstruction is explicit',async()=>{
 const {createHash}=await import('node:crypto');const origin=JSON.parse(readFileSync(new URL('../scripts/cold-native-typed-state-performance/fixture-origin.json',import.meta.url)));const raw=readFileSync(new URL('../scripts/cold-native-typed-state-performance/actual-snapshot-fixtures.json',import.meta.url));assert.equal(createHash('sha256').update(raw).digest('hex'),origin.sourceSha256);assert.equal(origin.rawCaptureSha256,fixture.captureSha256);assert.match(origin.candidateTypeReconstruction,/manufactured/);assert.equal(origin.sourceRevision,'b01c922c2d634aba9367f6e2a70d109370e4adee');
});
