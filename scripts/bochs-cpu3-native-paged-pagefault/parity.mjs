/** Fixed PF recovery differential contract. Native source expectations are unobserved. */
import assert from 'node:assert/strict';
import {comparePageFaultCpu} from './cpu-comparison.mjs';
import {rawNativeWords,decodeFaultSlice,beginFaultLedger,advanceFaultLedger,completedFaultLedger} from './native-fault-policy.mjs';
import {nativePageFaultProfile,nativeFrameStores,nativeSources,nativeAdUpdate} from './provider-profile.mjs';
import {namedCuts,layout,selector,dataSelector,bootStores,repairStore,retryStore,expectedShadow,validateMilestone,validateLedger,wordAt,entries,terminalEip,handlerEip,faultEip,ramInstructions} from './profile.mjs';
export const wholeNativeWords=n=>rawNativeWords(n,Object.hasOwn(n,'reason'));
export function inspectFields(n){const {sliceBytes,reason,activityState,chargedNativeTicks,chargedQuanta,...inspect}=n;rawNativeWords(inspect);return inspect;}
export const pageFaultNativeSources=Object.freeze([
 {path:'bochs/cpu/descriptor.h',sha256:'2cea747965fcb0523db6826929fbe9cfc2b59893102c789e01ece67c10e00b10',contract:'Exact15-word rows; ValidCache1/ROK2/WOK4, selector index is not valid'},
 {path:'bochs/cpu/ctrl_xfer_pro.cc',sha256:'a70b7ee89237e5058e44e07095ea7d52d621dcff6fd727e75bfd1be544577d62',contract:'Protected CS valid1'},
 {path:'bochs/cpu/segment_ctrl_pro.cc',sha256:'737fea13e5e6dc97d7b24d17b3cfe249dbbfba7aae37304abdf3e783b54af714',contract:'DS/SS load valid1'},
 ...Object.entries(nativeSources).map(([key,s])=>({path:'bochs/cpu/'+({fault:'exception.cc',paging:'paging.cc',access:'access.cc',cpu:'cpu.cc',cr3:'crregs.cc'}[key]),...s})),
 {path:'bochs/cpu/event.cc',sha256:'3f1603ed7e9b668cda9264821af0e03439577a617ba63cea69e95122b6cd2b12',contract:'Native MOVSS interrupt/debug inhibit is source-attested, not JS returned-shadow telemetry'},
].map(Object.freeze));
export const pageFaultParityPolicy=Object.freeze({
 cpu:'Strict every represented JS CPU counterpart; retain all166 native words without a flags mask or normalization. Native-only descriptor rows are separate exact source hypotheses, not full166 cross-engine equality.',
 accounting:'One actual reasonFAULT2/vector14/error2/CR28000 at paused18:7003: +1 native tick/attempt and zero completedQ. Genuine JS faulting step runs once at this return. NativeN equals JSattemptOrdinal; nativeQ equals JScompletedQ. Ordinary zero-progress prefetch never steps JS.',
 phases:'Reset, PG-off retirements, actual RAM ordinary/fault-delivery/recovery retirements and final inspect comparable. PG-enabled/far-jump entry/zero-progress/line phases and staging records unmatched: raw wholeboards/ten pages retained, CPU/NQ only, no indirect RAM-hash comparison or parity PASS.',
 effects:'Native31 boot+FLAGS/CS/IP/error4+repair1+retry1 and eight combined A/D effects are pending source expectations. Genuine native callback order/generations are retained independently of JS eleven A/D updates and ascending frame stores.',
 pages:'Ten unmodified4096-byte physical host-provider copies/full board at comparable cuts and final settle; no masks. WholeRAM hash-only, native fetch/cache/inhibit ownership source-attested.',
 scope:'Owned strict386 CPL0 code16 PF14/error2, ordinary PTE repair and same-value CR3reload/error-discard/IRET/exactly-once retry. No INVLPG/PSE/CR4/IRQ/REP/PIO/HLT/OS/speed claim; fresh profile build pending.',
});
const count=v=>{if(typeof v==='string'){assert.match(v,/^(0|[1-9][0-9]*)$/);v=BigInt(v);}else assert.equal(typeof v,'bigint');assert.ok(v>=0n&&v<=512n);return Number(v);};
const row=(index,s,valid,type)=>[index,s,s>>>3,0,0,valid,1,0,1,type,0,65535,0,0,0];
export function validateDescriptorRows(n,js,board){wholeNativeWords(n);const c=js.cpu;
 if(c.cs===selector)assert.deepEqual(n.segments.slice(15,30),row(1,selector,1,11),'strict protected CS row');
 if(c.ds===dataSelector)assert.deepEqual(n.segments.slice(45,60),row(3,dataSelector,js.faultSerial?7:1,3),'DS cache: failed write permission check precedes fault');
 if(c.ss===dataSelector)assert.deepEqual(n.segments.slice(30,45),row(2,dataSelector,board.ram.writes.some(w=>w.kind==='frame')?7:1,3),'SS cache changes only after real frame write');
}
export function pageFaultProgress(previous,n){const s=decodeFaultSlice(n),dn=s.n-previous.n,dq=s.q-previous.q,df=s.faults-(previous.faults??0);
 assert.deepEqual([dn,dq],[s.dn,s.dq]);assert.ok(s.n<=nativePageFaultProfile.maxNativeTicks&&s.q<=nativePageFaultProfile.maxQuanta);
 let classification;if(s.reason===2){assert.deepEqual([dn,dq,df],[1,0,1]);assert.equal(previous.faults??0,0);classification='EXACT_SINGLE_FAULT_DELIVERY';}
 else if(dn===0&&dq===0){assert.equal(df,0);classification='PREFETCH_RAW_UNMATCHED';}
 else{assert.deepEqual([dn,dq,df],[1,1,0]);classification='ORDINARY_COMPLETION';}
 return {n:s.n,q:s.q,dn,dq,faults:s.faults,attemptOrdinal:s.attempts,classification};
}
export function stepReferenceForReturn(oracle,progress){if(progress.classification==='PREFETCH_RAW_UNMATCHED')return null;
 const result=oracle.step();assert.deepEqual([result.attemptOrdinal,result.q,result.completed,result.faultDelivered],[progress.attemptOrdinal,progress.q,progress.dq,progress.classification==='EXACT_SINGLE_FAULT_DELIVERY'],'genuine once-only JS step follows actual native attempt, including N1/Q0 fault');return result;
}
export function startOrAdvanceFaultLedger(ledger,before,n,beforePages,pages){
 if(!ledger&&before.state[13]===selector&&before.state[8]===faultEip&&count(before.execution.faults)===0)ledger=beginFaultLedger(inspectFields(before),beforePages);
 if(n.reason===2)assert.ok(ledger,'fault cannot arrive without authenticated paused owner');
 return ledger?advanceFaultLedger(ledger,inspectFields(before),n,beforePages,pages):null;
}
export function comparablePhase(kind,js,classification){assert.ok(['reset','resume','line','final-inspect'].includes(kind));
 if(kind==='reset')return true;if(kind==='final-inspect')return js.cpu.cs===selector&&js.cpu.eip===terminalEip;
 if(kind!=='resume'||classification==='PREFETCH_RAW_UNMATCHED')return false;
 return !(js.cpu.cr0&0x80000000)||js.cpu.cs===selector&&(js.cpu.eip===handlerEip||ramInstructions.some(i=>i.ip!==0x7000&&i.ip===js.cpu.eip)||js.cpu.eip===terminalEip);
}
function pagesShape(pages,js){assert.deepEqual(Object.keys(pages).sort(),Object.keys(layout).sort());assert.deepEqual(Object.keys(js.pages).sort(),Object.keys(layout).sort());for(const key of Object.keys(layout)){assert.ok(pages[key] instanceof Uint8Array&&js.pages[key] instanceof Uint8Array);assert.equal(pages[key].length,4096);assert.equal(js.pages[key].length,4096);}}
export function validateNativeEffects(board,js,terminal=false){const writes=board.ram.writes;assert.ok(Array.isArray(writes)&&writes.length<=1024);const group=kind=>writes.filter(w=>w.kind===kind),boot=group('boot'),frame=group('frame'),repair=group('repair'),retry=group('retry'),ad=group('ad');
 assert.equal(writes.length,boot.length+frame.length+repair.length+retry.length+ad.length,'unknown native write kind refused');
 assert.deepEqual(boot.map(w=>[w.raw,w.bytes]),bootStores.slice(0,boot.length).map(w=>[w.raw,w.bytes]),'owned ordered boot prefix');assert.equal(boot.length,js.stores.filter(w=>bootStores.some(b=>b.raw===w.raw&&b.cs===w.cs&&b.ip===w.ip)).length);
 assert.deepEqual(frame.map(w=>[w.raw,w.bytes]),nativeFrameStores.slice(0,frame.length).map(w=>[w.raw,w.bytes]),'native FLAGS/CS/IP/error order, independent of JS');assert.equal(frame.length,js.stores.filter(w=>w.raw>=0xcff8&&w.raw<=0xcffe).length);
 for(const [actual,expected]of [[repair,repairStore],[retry,retryStore]]){assert.ok(actual.length<=1);for(const w of actual)assert.deepEqual([w.raw,w.bytes],[expected.raw,expected.bytes]);assert.equal(actual.length,js.stores.filter(w=>w.raw===expected.raw&&w.cs===expected.cs&&w.ip===expected.ip).length);}
 assert.deepEqual([board.ram.bootStores,board.ram.frameWords,board.ram.storeCount,board.ram.repaired,board.ram.dataWritten],[boot.length,frame.length,writes.length,repair.length===1,retry.length===1]);
 const seen=new Set();for(const e of ad){assert.ok(!seen.has(e.raw),'exactly one combined native AD effect per entry');seen.add(e.raw);nativeAdUpdate(e.raw,e.before,e.after);assert.deepEqual(e.bytes,[e.after&255,e.after>>>8&255,e.after>>>16&255,e.after>>>24]);}
 if(terminal){assert.deepEqual([boot.length,frame.length,repair.length,retry.length,ad.length],[31,4,1,1,8]);assert.deepEqual([...seen].sort((a,b)=>a-b),Object.values(entries).map(e=>e.raw).sort((a,b)=>a-b));}
 return {bootWrites:boot.length,frameWrites:frame.length,repairWrites:repair.length,retryWrites:retry.length,nativeAdWrites:ad.length,order:'independent successful native callback tape; no JS order/generation equality'};
}
export function compareBoundary(n,board,js,pages,kind='resume',classification='ORDINARY_COMPLETION'){
 wholeNativeWords(n);validateLedger(js);comparePageFaultCpu(n,js.cpu);assert.deepEqual([count(n.nativeTicks),count(n.successfulQuanta),count(n.execution.faults)],[js.attemptOrdinal,js.q,js.faultSerial]);assert.equal(board.successfulQuanta,js.q);assert.equal(board.nativeTicks,js.attemptOrdinal);assert.equal(js.cpu.cr4,0);assert.deepEqual([js.cpu.interruptShadow,js.cpu.nmiShadow,js.cpu.debugShadow],expectedShadow(js.cpu.cs,js.cpu.eip));pagesShape(pages,js);
 if(!comparablePhase(kind,js,classification))return {status:'UNMATCHED_PHASE',coverage:'representedCPU/attemptN/completedQ only; raw boards/ten fullpages retained, no RAM hash/page parity'};
 validateDescriptorRows(n,js,board);assert.deepEqual(board.board,js.board,'whole actual comparable board');for(const key of Object.keys(layout))assert.deepEqual(pages[key],js.pages[key],'whole comparable '+key+' page');validateNativeEffects(board,js);assert.equal(board.ram.admitted,js.cpu.cs===selector,'actual RAM fetch admission');return {status:'COMPARABLE_PARITY_PASS',coverage:'strict representedCPU/source-backed full CS DS SS rows/fullboard/ten unmodified pages/independent owned effects'};
}
export function validateMilestones(cuts){assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));let prior=-1,comparable=0,unmatched=0;
 for(const c of cuts){assert.ok(Number.isSafeInteger(c.attemptOrdinal)&&c.attemptOrdinal>prior&&c.attemptOrdinal<=512);prior=c.attemptOrdinal;assert.deepEqual([c.q,c.attemptOrdinal,c.faultSerial],[c.javascript.q,c.javascript.attemptOrdinal,c.javascript.faultSerial]);validateMilestone(c.name,c.javascript);const phase=compareBoundary(c.native,c.board,c.javascript,c.pages,c.name==='reset'?'reset':'resume',c.classification);assert.deepEqual(c.comparison,phase);if(phase.status==='COMPARABLE_PARITY_PASS')comparable++;else unmatched++;}assert.equal(unmatched,2);return {milestones:cuts.length,comparableCuts:comparable,unmatchedCuts:unmatched,pageBytesPerBoundary:10*4096};
}
export function validateFinalPages(pages){pagesShape(pages,{pages});assert.equal(wordAt(pages.directory,0),0x2023);for(const [key,v]of [['gdt',0x23],['table',0x2063],['idt',0x3023],['code',0xa023],['data',0xb063],['stack',0xc063],['rom',0xf0023]])assert.equal(wordAt(pages.table,entries[key].raw&4095),v);
 for(const [key,v]of [['aliasCode',[0xf4,0xcc,0xcc,0xcc]],['aliasData',[0xad,0xde,0xef,0xbe]],['aliasStack',[0xcc,0xcc,0xcc,0xcc]],['data',[0x34,0x12,0x9a,0xbc]]])assert.deepEqual([...pages[key].subarray(0,4)],v);assert.deepEqual([...pages.stack.subarray(0xff8)],[2,0,3,0x70,24,0,2,0]);
}
export function validateMemoryTape(events,board){assert.ok(Array.isArray(events)&&events.length<=1024);for(const [i,e]of events.entries()){assert.equal(e.ordinal,i);assert.ok(['read','write'].includes(e.direction));for(const k of ['raw','generation','nativeTicks','successfulQuanta'])assert.ok(Number.isSafeInteger(e[k])&&e[k]>=0&&e[k]<=(k==='raw'?0xffffffff:512));assert.ok(e.nativeTicks===e.successfulQuanta||e.nativeTicks===e.successfulQuanta+1);assert.ok(Array.isArray(e.bytes)&&e.bytes.length>0&&e.bytes.length<=16);for(const b of e.bytes)assert.ok(Number.isInteger(b)&&b>=0&&b<=255);}
 assert.deepEqual(events.filter(e=>e.direction==='read').map(({direction,ordinal,...e})=>e),board.ram.reads);assert.deepEqual(events.filter(e=>e.direction==='write').map(({direction,ordinal,...e})=>e),board.ram.writes);return {events:events.length,coverage:'successful actual provider callbacks; no direct C owner/kind telemetry or JS ordering assertion'};
}
export function finishFaultLedger(l){completedFaultLedger(l);return {faultSerial:l.faultSerial,retryCommits:l.retryCommits,attemptOrdinal:l.attemptOrdinal,n:l.n,q:l.q,ownerProof:l.ownerProof,coverage:'exact source-inferred owner protocol; actual native qualification requires complete differential capture'};}
