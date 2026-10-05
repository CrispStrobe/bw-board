/** Finite pending native PF protocol. No addon, provider, CPU or filesystem execution. */
import assert from 'node:assert/strict';
import {selector,dataSelector,romInstructions,faultEip,handlerEip,terminalEip,bootStores,adTransitions,expectedPages,wordAt} from './profile.mjs';
export const nativeFaultAuthority=Object.freeze({status:'PENDING_NATIVE_FAULT_RUNTIME_BUILD_AND_EXECUTION',abi:4,sliceBytes:160,rawWords:166,maxResumes:512,maxPrefetchReturns:8,ownerProof:'SOURCE_ATTESTED_OWNER_INFERENCE_NOT_DIRECT_TELEMETRY'});
export const nativeFaultSource=Object.freeze({abiSha256:'3cb214dfa1a1cf74c5aea4ef3642d73d8ca1cc9e9c8362d2513dc3483f284990',heldRuntimeSha256:'44d6166807419eebc02f6e69f767e22fed21ead738b2a10e71d87791c364b796',savedJsSha256:'6ea098a534da4681cdbb3bcaadf6918a9ed4a882ab230d87ff16c394e00803c7'});
const executionKeys=['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'];
const fallbackKeys=['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'];
const callbackKeys=['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'];
const transferKeys=['transfers','commits','words'];
const inspectKeys=['state','extra','segments','system','debug','nativeTicks','successfulQuanta','mappingEpoch','boardA20','fallback','execution','callbacks','clockTransfers'];
function keys(v,want){assert.ok(v&&typeof v==='object'&&!Array.isArray(v));assert.deepEqual(Object.keys(v).sort(),[...want].sort());}
function integer(v,max=0xffffffff){assert.ok(Number.isSafeInteger(v)&&v>=0&&v<=max);return v;}
function count(v){assert.equal(typeof v,'string');assert.match(v,/^(0|[1-9][0-9]*)$/);const n=Number(v);return integer(n,1_000_000);}
function bytes(v,size){assert.ok(v instanceof Uint8Array||Array.isArray(v));assert.equal(v.length,size);for(const b of v)integer(b,255);return Uint8Array.from(v);}
export function rawNativeWords(n,returned=false){
 keys(n,[...inspectKeys,...(returned?['sliceBytes','reason','activityState','chargedNativeTicks','chargedQuanta']:[])]);
 const words=[];for(const [key,size]of [['state',20],['extra',20],['segments',90],['system',30],['debug',6]]){assert.ok(Array.isArray(n[key]));assert.equal(n[key].length,size);for(const w of n[key])words.push(integer(w));}
 assert.equal(words.length,166);integer(n.mappingEpoch);assert.equal(n.mappingEpoch,0);assert.equal(n.boardA20,1);
 for(const [key,fields]of [['execution',executionKeys],['fallback',fallbackKeys],['callbacks',callbackKeys],['clockTransfers',transferKeys]]){keys(n[key],fields);for(const f of fields)count(n[key][f]);}
 for(const v of Object.values(n.fallback))assert.equal(count(v),0,'no fallback');
 for(const f of executionKeys.slice(2))if(f!=='faults')assert.equal(count(n.execution[f]),0,'no REP/ports/IRQ/HLT');
 const N=count(n.nativeTicks),Q=count(n.successfulQuanta),A=count(n.execution.attempts),F=count(n.execution.faults);
 assert.ok(N<=512&&Q<=512&&A<=512&&F<=1);assert.equal(count(n.execution.completed),Q);assert.equal(A,Q+F);assert.equal(N,A,'fixed ordinary-plus-one-fault source accounting');
 return words;
}
export function decodeFaultSlice(n){
 rawNativeWords(n,true);const b=bytes(n.sliceBytes,160),v=new DataView(b.buffer);
 const u=o=>v.getUint32(o,true),q=o=>{const x=v.getBigUint64(o,true);assert.ok(x<=1_000_000n);return Number(x);};
 const s={reason:u(0),requestedN:u(4),effectiveN:u(8),dn:u(12),requestedQ:u(16),dq:u(20),n:q(24),q:q(32),attempts:q(40),completed:q(48),repIterations:q(56),repPartial:q(64),faults:q(72),portCommits:q(80),irqDeliveries:q(88),haltIdleCuts:q(96),cs:v.getUint16(104,true),eip:u(108),pendingFault:u(112),vector:u(116),error:u(120),cr2:u(124),portCommitted:u(128),eventDue:u(132),pendingIrq:u(136),irqDelivered:u(140),irqVector:u(144),ifFlag:u(148),activityState:u(152),pendingEvent:u(156)};
 assert.deepEqual([s.requestedN,s.effectiveN,s.requestedQ],[1,1,1]);assert.equal(s.reason,n.reason);assert.equal(s.dn,n.chargedNativeTicks);assert.equal(s.dq,n.chargedQuanta);assert.equal(s.activityState,n.activityState);assert.equal(s.activityState,0);
 assert.equal(s.n,count(n.nativeTicks));assert.equal(s.q,count(n.successfulQuanta));for(const f of executionKeys)assert.equal(s[f],count(n.execution[f]));assert.deepEqual([s.cs,s.eip],[n.state[13],n.state[8]]);
 assert.deepEqual([s.portCommitted,s.eventDue,s.pendingIrq,s.irqDelivered,s.irqVector,s.ifFlag],[0,0,0,0,0,0]);assert.equal((n.state[9]>>>9)&1,s.ifFlag);
 assert.ok(s.reason===1||s.reason===2);if(s.reason===2)assert.deepEqual([s.pendingFault,s.vector,s.error,s.cr2,s.faults,n.state[11]],[1,14,2,0x8000,1,0x8000]);else assert.deepEqual([s.pendingFault,s.vector,s.error,s.cr2],[0,0,0,0]);
 // pending_event is a raw source field; it is retained, never given an invented zero default.
 return s;
}
const codeRow=[1,selector,3,0,0,1,1,0,1,11,0,65535,0,0,0];
const dataRow=(reg,valid)=>[reg,dataSelector,2,0,0,valid,1,0,1,3,0,65535,0,0,0];
function cache(n,afterFault){assert.deepEqual(n.segments.slice(15,30),codeRow);assert.deepEqual(n.segments.slice(30,45),dataRow(2,afterFault?7:1));assert.deepEqual(n.segments.slice(45,60),dataRow(3,afterFault?7:1));}
function state(n,ip,sp,flags,cr2,edx){assert.deepEqual([n.state[0],n.state[2],n.state[4],n.state[8],n.state[9],n.state[10],n.state[11],n.state[12],n.state[13],n.state[14],n.state[15]],[0x80001234,edx,sp,ip,flags,0xfffffff1,cr2,0x1000,selector,dataSelector,dataSelector]);cache(n,cr2!==0);}
function pages(p){keys(p,Object.keys(expectedPages()));for(const key of Object.keys(p))bytes(p[key],4096);return p;}
function samePages(a,b){pages(a);pages(b);for(const k of Object.keys(a))assert.deepEqual([...a[k]],[...b[k]],'entire physical '+k+' page');}
function expectedBeforePages(){return expectedPages(bootStores,adTransitions.slice(0,4));}
function afterFaultPages(){const p=expectedBeforePages();p.table.set([0x23,0x30,0,0],0xc);p.table.set([0x63,0xc0,0,0],0x34);p.stack.set([2,0,3,0x70,24,0,2,0],0xff8);return p;}
function effectPages(phase){const p=afterFaultPages();if(phase>=1){p.table.set([3,0xb0,0,0],0x20);p.table.set([0x63,0x20,0,0],8);}if(phase>=6){p.table.set([0x63,0xb0,0,0],0x20);p.data.set([0x34,0x12],0);}return p;}
export const faultRecoveryPhases=Object.freeze([
 {owner:handlerEip,ip:0x7029,sp:0xdff8,flags:2,edx:0,effect:'ordinary-fixed-PTE-repair'},
 {owner:0x7029,ip:0x702c,sp:0xdff8,flags:2,edx:0x1000,effect:'read-CR3-into-EDX'},
 {owner:0x702c,ip:0x702f,sp:0xdff8,flags:2,edx:0x1000,effect:'legal-386-same-CR3-reload'},
 {owner:0x702f,ip:0x7032,sp:0xdffa,flags:0x86,edx:0x1000,effect:'discard-real-error-word'},
 {owner:0x7032,ip:faultEip,sp:0xe000,flags:2,edx:0x1000,effect:'IRET-to-real-restart-IP'},
 {owner:faultEip,ip:0x7006,sp:0xe000,flags:2,edx:0x1000,effect:'once-only-retried-data-commit'},
 {owner:0x7006,ip:terminalEip,sp:0xe000,flags:2,edx:0x1000,effect:'readback-before-HLT'},
].map(Object.freeze));
export function beginFaultLedger(before,beforePages){
 rawNativeWords(before);assert.equal(count(before.execution.faults),0);assert.equal(count(before.execution.attempts),romInstructions.length+2,'source ROM/reset/MOV-AX count before fixed fault');state(before,faultEip,0xe000,2,0,0);samePages(beforePages,expectedBeforePages());
 return Object.freeze({schema:'bw.paged-pagefault.native-pending-ledger.v1',authority:nativeFaultAuthority.status,n:count(before.nativeTicks),q:count(before.successfulQuanta),attemptOrdinal:count(before.execution.attempts),resumes:0,prefetchReturns:0,faultSerial:0,phase:-1,retryCommits:0,ownerProof:null,classification:'AUTHENTICATED_PAUSED_BEFORE_FAULT'});
}
function ledger(l,before){keys(l,['schema','authority','n','q','attemptOrdinal','resumes','prefetchReturns','faultSerial','phase','retryCommits','ownerProof','classification']);assert.equal(l.schema,'bw.paged-pagefault.native-pending-ledger.v1');assert.equal(l.authority,nativeFaultAuthority.status);assert.equal(l.n,count(before.nativeTicks));assert.equal(l.q,count(before.successfulQuanta));assert.equal(l.attemptOrdinal,count(before.execution.attempts));assert.equal(l.faultSerial,count(before.execution.faults));assert.ok(Number.isSafeInteger(l.phase)&&l.phase>=-1&&l.phase<=7);integer(l.resumes,511);integer(l.prefetchReturns,8);integer(l.faultSerial,1);integer(l.retryCommits,1);assert.equal(l.n,l.q+l.faultSerial);assert.equal(l.retryCommits,l.phase>=6?1:0);assert.equal(l.faultSerial,l.phase===-1?0:1);assert.equal(l.ownerProof,l.phase===-1?null:nativeFaultAuthority.ownerProof);assert.equal(l.q,romInstructions.length+2+Math.max(l.phase,0),'fixed phase successful-instruction count');}
export function advanceFaultLedger(l,before,after,beforePages,afterPages){
 rawNativeWords(before);ledger(l,before);const s=decodeFaultSlice(after),dn=s.n-l.n,dq=s.q-l.q,da=s.attempts-l.attemptOrdinal,df=s.faults-l.faultSerial;
 for(const key of ['callbacks','clockTransfers'])for(const field of Object.keys(before[key]))assert.ok(count(after[key][field])>=count(before[key][field]),'monotonic source counters');
 assert.deepEqual([dn,dq],[s.dn,s.dq]);assert.ok(dn>=0&&dn<=1&&dq>=0&&dq<=1);
 const next={...l,n:s.n,q:s.q,attemptOrdinal:s.attempts,resumes:l.resumes+1};
 if(dn===0&&dq===0){
  assert.deepEqual([s.reason,da,df,s.pendingFault,s.vector,s.error,s.cr2],[1,0,0,0,0,0,0]);assert.deepEqual(after.state,before.state);assert.ok(l.prefetchReturns<8);pages(beforePages);pages(afterPages);
  return Object.freeze({...next,prefetchReturns:l.prefetchReturns+1,classification:'PREFETCH_RAW_UNMATCHED'});
 }
 if(s.reason===2){
  assert.deepEqual([l.faultSerial,l.phase,dn,dq,da,df,s.pendingFault,s.vector,s.error,s.cr2],[0,-1,1,0,1,1,1,14,2,0x8000]);state(before,faultEip,0xe000,2,0,0);state(after,handlerEip,0xdff8,2,0x8000,0);
  for(const i of [0,1,2,3,5,6,7,9,10,12,13,14,15,16,17,18,19])assert.equal(after.state[i],before.state[i],'fault preserves represented native register '+i);
  samePages(beforePages,expectedBeforePages());samePages(afterPages,afterFaultPages());assert.equal(wordAt(afterPages.table,0x20),0,'no PTE repair or failed operand commit before handler');
  return Object.freeze({...next,faultSerial:1,phase:0,ownerProof:nativeFaultAuthority.ownerProof,classification:'EXACT_SINGLE_FAULT_DELIVERY'});
 }
 assert.deepEqual([s.reason,dn,dq,da,df,s.pendingFault,s.vector,s.error,s.cr2],[1,1,1,1,0,0,0,0,0]);assert.equal(l.faultSerial,1);assert.ok(l.phase>=0&&l.phase<7,'finite handler/retry sequence');const p=faultRecoveryPhases[l.phase];
 assert.deepEqual([before.state[13],before.state[8]],[selector,p.owner]);state(after,p.ip,p.sp,p.flags,0x8000,p.edx);samePages(beforePages,effectPages(l.phase));samePages(afterPages,effectPages(l.phase+1));
 if(l.phase===6)assert.equal(after.state[1],0x1234);else assert.equal(after.state[1],before.state[1]);
 return Object.freeze({...next,phase:l.phase+1,retryCommits:l.phase===5?1:l.retryCommits,classification:p.effect});
}
export function completedFaultLedger(l){assert.equal(l.phase,7);assert.deepEqual([l.faultSerial,l.retryCommits,l.n-l.q],[1,1,1]);assert.equal(l.ownerProof,nativeFaultAuthority.ownerProof);return 'FINITE_MANUFACTURED_PROTOCOL_ONLY_NOT_NATIVE_EXECUTION';}
