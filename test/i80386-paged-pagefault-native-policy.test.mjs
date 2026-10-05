import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import {rawNativeWords,decodeFaultSlice,beginFaultLedger,advanceFaultLedger,completedFaultLedger,nativeFaultAuthority,faultRecoveryPhases,nativeFaultSource} from '../scripts/bochs-cpu3-native-paged-pagefault/native-fault-policy.mjs';
import {expectedPages,bootStores,adTransitions,selector,dataSelector} from '../scripts/bochs-cpu3-native-paged-pagefault/profile.mjs';
const actual=JSON.parse(fs.readFileSync(new URL('../scripts/bochs-cpu3-native-paged-pagefault/saved-js-fault-phases.json',import.meta.url),'utf8'));
// Every native snapshot/slice below is MANUFACTURED; saved JS records are authentic projections only.
const clone=v=>structuredClone(v),data=(reg,valid)=>[reg,dataSelector,2,0,0,valid,1,0,1,3,0,65535,0,0,0];
function snap(q=49,faults=0,ip=0x7003,sp=0xe000,flags=2,edx=0){
 const n={state:Array(20).fill(0),extra:Array(20).fill(0),segments:Array(90).fill(0),system:Array(30).fill(0),debug:Array(6).fill(0),nativeTicks:String(q+faults),successfulQuanta:String(q),mappingEpoch:0,boardA20:1};
 n.execution=Object.fromEntries(['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].map(k=>[k,String(k==='attempts'?q+faults:k==='completed'?q:k==='faults'?faults:0)]));
 n.fallback=Object.fromEntries(['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'].map(k=>[k,'0']));n.callbacks=Object.fromEntries(['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'].map(k=>[k,'0']));n.clockTransfers={transfers:'0',commits:'0',words:'0'};
 [n.state[0],n.state[2],n.state[4],n.state[8],n.state[9],n.state[10],n.state[11],n.state[12],n.state[13],n.state[14],n.state[15]]=[0x80001234,edx,sp,ip,flags,0xfffffff1,faults?0x8000:0,0x1000,selector,dataSelector,dataSelector];
 n.segments.splice(15,15,1,selector,3,0,0,1,1,0,1,11,0,65535,0,0,0);n.segments.splice(30,15,...data(2,faults?7:1));n.segments.splice(45,15,...data(3,faults?7:1));return n;
}
function returned(n,reason=1,dn=1,dq=1){
 n=clone(n);Object.assign(n,{reason,activityState:0,chargedNativeTicks:dn,chargedQuanta:dq,sliceBytes:new Uint8Array(160)});const v=new DataView(n.sliceBytes.buffer),u=(o,x)=>v.setUint32(o,x,true),q=(o,x)=>v.setBigUint64(o,BigInt(x),true);
 for(const [o,x]of [[0,reason],[4,1],[8,1],[12,dn],[16,1],[20,dq]])u(o,x);q(24,n.nativeTicks);q(32,n.successfulQuanta);for(const [i,k]of ['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].entries())q(40+8*i,n.execution[k]);v.setUint16(104,n.state[13],true);u(108,n.state[8]);if(reason===2)for(const [o,x]of [[112,1],[116,14],[120,2],[124,0x8000]])u(o,x);u(156,0x40);return n;
}
function stagePages(phase=-1){
 const p=expectedPages(bootStores,adTransitions.slice(0,4));if(phase>=0){p.table.set([0x23,0x30,0,0],0xc);p.table.set([0x63,0xc0,0,0],0x34);p.stack.set([2,0,3,0x70,24,0,2,0],0xff8);}if(phase>=1){p.table.set([3,0xb0,0,0],0x20);p.table.set([0x63,0x20,0,0],8);}if(phase>=6){p.table.set([0x63,0xb0,0,0],0x20);p.data.set([0x34,0x12],0);}return p;
}
function fixture(){const before=snap(),after=returned(snap(49,1,0x7020,0xdff8),2,1,0),bp=stagePages(),ap=stagePages(0);return {before,after,bp,ap,l:beginFaultLedger(before,bp)};}
function inspect(n){n=clone(n);for(const k of ['sliceBytes','reason','activityState','chargedNativeTicks','chargedQuanta'])delete n[k];return n;}
test('manufactured ABI4 slice agrees with exact offsets and 166 words without direct owner telemetry',()=>{
 const f=fixture();assert.equal(rawNativeWords(f.before).length,166);const s=decodeFaultSlice(f.after);assert.deepEqual([s.reason,s.dn,s.dq,s.cs,s.eip,s.vector,s.error,s.cr2,s.pendingEvent],[2,1,0,24,0x7020,14,2,0x8000,0x40]);assert.equal(nativeFaultAuthority.ownerProof,'SOURCE_ATTESTED_OWNER_INFERENCE_NOT_DIRECT_TELEMETRY');
 for(const change of [n=>n.sliceBytes=new Uint8Array(168),n=>n.state.pop(),n=>n.extra[0]=-1,n=>n.chargedQuanta=1,n=>new DataView(n.sliceBytes.buffer).setUint32(116,13,true),n=>n.nativeTicks='050',n=>n.faultOwnerEip=0x7003]){const n=clone(f.after);change(n);assert.throws(()=>decodeFaultSlice(n));}
});
test('single manufactured FAULT requires paused owner genuine-format frame and no failed operand effect',()=>{
 const f=fixture(),l=advanceFaultLedger(f.l,f.before,f.after,f.bp,f.ap);assert.deepEqual([l.n,l.q,l.attemptOrdinal,l.faultSerial,l.phase,l.ownerProof],[50,49,50,1,0,nativeFaultAuthority.ownerProof]);assert.deepEqual([...f.ap.stack.subarray(0xff8)],[2,0,3,0x70,24,0,2,0]);
 for(const mutate of [f=>f.before.state[8]=0x7000,f=>f.after.state[8]=0x7029,f=>f.after.state[4]=0xdffa,f=>new DataView(f.after.sliceBytes.buffer).setUint32(120,0,true),f=>new DataView(f.after.sliceBytes.buffer).setUint32(124,0x8001,true),f=>f.after.execution.faults='2',f=>f.ap.stack[0xffa]=6,f=>f.ap.data[0]=0x34,f=>f.ap.table[0x20]=3,f=>f.ap.code[4095]=1,f=>f.after.segments[35]=3,f=>f.after.segments[50]=3]){const x=fixture();mutate(x);assert.throws(()=>advanceFaultLedger(x.l,x.before,x.after,x.bp,x.ap));}
});
test('zero-charge prefetch remains unmatched and cannot smuggle FAULT or attempted instruction',()=>{
 const f=fixture(),r=returned(f.before,1,0,0);const p=clone(f.bp);p.table[0xc]=0x23;const l=advanceFaultLedger(f.l,f.before,r,f.bp,p);assert.equal(l.classification,'PREFETCH_RAW_UNMATCHED');assert.deepEqual([l.faultSerial,l.phase,l.attemptOrdinal],[0,-1,49]);
 for(const mutate of [r=>r.reason=2,r=>new DataView(r.sliceBytes.buffer).setUint32(112,1,true),r=>r.state[8]=0x7020,r=>r.execution.attempts='50']){const r=returned(f.before,1,0,0);mutate(r);assert.throws(()=>advanceFaultLedger(f.l,f.before,r,f.bp,f.bp));}
 assert.throws(()=>advanceFaultLedger({...f.l,prefetchReturns:8},f.before,r,f.bp,f.bp));
});
test('manufactured finite repair CR3 reload error discard IRET retry ledger rejects duplicate and early writes',()=>{
 const f=fixture();let l=advanceFaultLedger(f.l,f.before,f.after,f.bp,f.ap),before=inspect(f.after),pages=f.ap;assert.throws(()=>advanceFaultLedger(l,before,f.after,pages,pages));
 for(const [i,p]of faultRecoveryPhases.entries()){
  const n=snap(50+i,1,p.ip,p.sp,p.flags,p.edx);if(i===6)n.state[1]=0x1234;const r=returned(n),nextPages=stagePages(i+1);
  if(i===0){const bad=clone(nextPages);bad.data.set([0x34,0x12]);assert.throws(()=>advanceFaultLedger(l,before,r,pages,bad));}
  for(const [phase,index,value]of [[2,12,0x2000],[3,9,2],[4,8,0x7006]])if(i===phase){const bad=clone(r);bad.state[index]=value;assert.throws(()=>advanceFaultLedger(l,before,bad,pages,nextPages));}
  l=advanceFaultLedger(l,before,r,pages,nextPages);before=inspect(r);pages=nextPages;
 }
 assert.equal(completedFaultLedger(l),'FINITE_MANUFACTURED_PROTOCOL_ONLY_NOT_NATIVE_EXECUTION');assert.deepEqual([l.n,l.q,l.retryCommits],[57,56,1]);assert.throws(()=>advanceFaultLedger(l,before,returned(snap(57,1,0x700a)),pages,pages));
});
test('genuine saved JS 58-frame projection anchors zero-Q fault and handler phases without native order claims',()=>{
 assert.equal(actual.origin.sha256,nativeFaultSource.savedJsSha256);assert.equal(actual.frames.length,58);assert.equal(actual.frames[0].attemptOrdinal,0);const f=actual.frames.slice(49);assert.deepEqual(f.map(v=>[v.attemptOrdinal,v.q,v.cpu.eip]),[[49,49,0x7003],[50,49,0x7020],...faultRecoveryPhases.map((p,i)=>[51+i,50+i,p.ip])]);
 const fault=f[1];assert.deepEqual([fault.lastAttempt.cs,fault.lastAttempt.eip,fault.lastAttempt.completed,fault.lastAttempt.faultDelivered],[24,0x7003,0,true]);assert.deepEqual([actual.deliveries[0].vector,actual.deliveries[0].errorCode,actual.deliveries[0].returnEip,actual.deliveries[0].cr2],[14,2,0x7003,0x8000]);assert.deepEqual(actual.reloads.map(v=>[v.attemptOrdinal,v.cr3,v.translationGenerationBefore,v.translationGenerationAfter]),[[53,0x1000,5,6]]);
 assert.equal(fault.physicalPageSha256.data,f[0].physicalPageSha256.data);assert.notEqual(f[7].physicalPageSha256.data,f[0].physicalPageSha256.data);assert.equal(actual.frames.at(-1).cpu.eax,0x80001234);for(const frame of actual.frames){assert.equal(Object.keys(frame.physicalPageSha256).length,10);assert.equal(frame.attemptOrdinal,frame.q+frame.faultSerial);}
});
test('pending source policy confers no old DSO authority and malformed starting state or page refuses',()=>{
 assert.equal(nativeFaultAuthority.status,'PENDING_NATIVE_FAULT_RUNTIME_BUILD_AND_EXECUTION');assert.equal(nativeFaultAuthority.abi,4);assert.equal(nativeFaultSource.heldRuntimeSha256,'44d6166807419eebc02f6e69f767e22fed21ead738b2a10e71d87791c364b796');const f=fixture();const n=clone(f.before);n.execution.faults='1';assert.throws(()=>beginFaultLedger(n,f.bp));const p=clone(f.bp);p.aliasData[8]=1;assert.throws(()=>beginFaultLedger(f.before,p));assert.throws(()=>completedFaultLedger(f.l));
});
