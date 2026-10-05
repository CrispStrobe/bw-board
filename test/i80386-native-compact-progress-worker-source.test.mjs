import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {validateCandidateBinding} from '../scripts/cold-native-compact-progress-performance/admission.mjs';
import {validateProgressProfile,validateProgressReturn} from '../scripts/cold-native-compact-progress-performance/protocol.mjs';
const own=new URL('../scripts/cold-native-compact-progress-performance/',import.meta.url);
test('closed pending compact binding refuses before caller artifact effects',()=>{
 const b=JSON.parse(readFileSync(new URL('capture-binding.json',own)));assert.equal(b.status,'PENDING_INDEPENDENT_COMPACT_BUILD');assert.equal(b.candidateBuild.addonSha256,null);let touched=0;const input={get compiledRevision(){touched++;throw Error('caller effect');}};assert.throws(()=>validateCandidateBinding(b,input),/PENDING compact artifact/);assert.equal(touched,0);
});
test('actual compact progress guards reject fallback/full snapshots and mutations',()=>{
 const api={progressExportProfile:'bw.cold-native.compact-progress.v1',resumeProgress(){},inspect(){}};validateProgressProfile(api);assert.throws(()=>validateProgressProfile({...api,resumeProgress:undefined}));assert.throws(()=>validateProgressProfile({...api,progressExportProfile:'old'}));
 const n={sliceBytes:new Uint8Array(160),reason:1,activityState:0,chargedNativeTicks:2,chargedQuanta:2,nativeTicks:2n,successfulQuanta:2n,mappingEpoch:0,boardA20:1},budget={maxN:600,maxQ:300};assert.deepEqual(validateProgressReturn({n:0,q:0},n,budget,10),{n:2,q:2,dn:2,dq:2});
 for(const [key,value] of [['state',new Uint32Array(20)],['nativeTicks',601n],['chargedQuanta',1],['reason',9],['mappingEpoch',1],['boardA20',0],['activityState',1],['sliceBytes',new Uint8Array(159)]])assert.throws(()=>validateProgressReturn({n:0,q:0},{...n,[key]:value},budget,10));
});
test('complete counted worker inverse and honest requested-cut wiring',()=>{
 const s=readFileSync(new URL('worker.mjs',own),'utf8'),d=JSON.parse(readFileSync(new URL('worker-derivation.json',own)));let inverse=s;for(const e of [...d.edits].reverse()){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}assert.equal(inverse,readFileSync(new URL('held-worker.mjs',own),'utf8'));assert.equal(createHash('sha256').update(inverse).digest('hex'),d.heldSha256);
 assert.match(s,/native=api.resumeProgress\(/);assert.doesNotMatch(s,/api.resume\(/);assert.match(s,/receipt.lastResumeInspect=api.inspect\(\)/);assert.match(s,/receipt.lastReturnedProgress=native/);assert.match(s,/compareProgressFinalEvidence/);assert.match(s,/const zeroCut=api.inspect\(\)/);assert.match(s,/validateProgressProfile\(api\)/);
});
