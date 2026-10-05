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
// Manufactured composition fixture, reconstructed from pinned held raw166.
import {compareProgressFinalEvidence} from '../scripts/cold-native-compact-progress-performance/protocol.mjs';
import {clockReasons,memoryReasons,plainSnapshot} from '../scripts/cold-native-compact-progress-performance/snapshot.mjs';
function compositionFixture(){
 const f=JSON.parse(readFileSync(new URL('actual-snapshot-fixtures.json',own))),origin=JSON.parse(readFileSync(new URL('fixture-origin.json',own)));assert.equal(createHash('sha256').update(readFileSync(new URL('actual-snapshot-fixtures.json',own))).digest('hex'),origin.sha256);
 function typed(x){const y=structuredClone(x);for(const k of ['state','extra','segments','system','debug'])y[k]=new Uint32Array(y[k]);for(const k of ['nativeTicks','successfulQuanta'])y[k]=BigInt(y[k]);y.bridgeClockEntryAttempts=Object.fromEntries(clockReasons.map(k=>[k,k==='INIT'?1n:0n]));y.bridgeMemoryEntryAttempts=Object.fromEntries(memoryReasons.map(k=>[k,0n]));return y;}
 function cpu(n){const c={};['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'].forEach((k,i)=>c[k]=n.state[i]);c.gdtr={base:n.state[16],limit:n.state[17]};c.idtr={base:n.state[18],limit:n.state[19]};[c.es,c.fs,c.gs]=n.extra.slice(2,5);c.segmentCaches=Array.from({length:6},(_,i)=>{const s=n.segments.slice(i*15,i*15+15);return {base:s[10],limit:s[11],default32:!!s[13],present:!!s[6]};});for(const [i,k]of ['ldtr','tr'].entries()){const s=n.system.slice(i*15,i*15+15);c[k]={selector:s[1],base:s[10],limit:s[11],present:!!s[6],type:s[9]};}c.debugRegisters=[...n.debug.slice(0,4),0,0,n.debug[4],n.debug[5]];c.pc=(n.segments[25]+n.state[8])>>>0;c.halted=c.shutdown=false;return c;}
 const final=typed(f.finalInspect),cut=typed(f.finalInspect);
 // Manufactured terminal progress and opaque slice bytes: f.resume is an early
 // genuine return, so it must not be relabelled as terminal native evidence.
 const last={reason:1,activityState:0,chargedNativeTicks:300,chargedQuanta:300,nativeTicks:final.nativeTicks,successfulQuanta:final.successfulQuanta,mappingEpoch:final.mappingEpoch,boardA20:final.boardA20,sliceBytes:new Uint8Array(160)};
 const q=Number(final.successfulQuanta),n=Number(final.nativeTicks),board={cycles:4+6*q,debt:0,a20Enabled:true},ram='a'.repeat(64),reset=plainSnapshot(typed(f.reset)),terminal=plainSnapshot(final);const cuts=Array.from({length:15},(_,i)=>({name:i===0?'reset':i===14?'before-F000-E16':'manufactured-cut',native:i===0?reset:terminal,javascript:{cpu:cpu(i===0?reset:terminal)}}));
 const jp={ordinal:1,dir:'out',port:0x80,width:8,value:0,q:1,cycles:4},ports=[{ordinal:1,dir:'out',port:0x80,width:8,value:0,successfulQuanta:0,cycles:4}];
 const capture={cuts,progress:{n,q},javascriptFinal:{board,ramSha256:ram},javascriptPorts:[jp]},settled={state:{board:structuredClone(board),nativeTicks:n,successfulQuanta:q,mappingEpoch:0,cold:{phase:'complete',portEventCount:1}},ramSha256:ram};return {final,cut,last,capture,settled,ports};
}
test('actual final composition validates real-format full cuts and preserves compact return',()=>{
 const run=f=>compareProgressFinalEvidence(f.final,f.settled,f.ports,f.capture,f.last,f.cut),f=compositionFixture(),before=structuredClone(f.last);assert.equal(run(f).ports,1);assert.deepEqual(f.last,before);assert.equal(Object.keys(f.last).length,9);assert.equal('state' in f.last,false);
 for(const key of ['nativeTicks','successfulQuanta','mappingEpoch','boardA20']){const x=compositionFixture();x.last[key]+=typeof x.last[key]==='bigint'?1n:1;assert.throws(()=>run(x),new RegExp('last progress matches actual requested cut '+key));}
 for(const field of ['bridgeClockEntryAttempts','bridgeMemoryEntryAttempts']){const x=compositionFixture();x.cut[field][Object.keys(x.cut[field])[0]]+=1n;assert.throws(()=>run(x));}
 for(const field of ['state','extra','segments','system','debug']){const x=compositionFixture();x.cut[field][0]^=1;assert.throws(()=>run(x));}
 for(const mutate of [x=>x.settled.ramSha256='b'.repeat(64),x=>x.settled.state.board.debt=1,x=>x.ports[0].value=1]){const x=compositionFixture();mutate(x);assert.throws(()=>run(x));}
});
