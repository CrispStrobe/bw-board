/** Finite differential phases. Raw unmatched pages never become parity PASS. */
import assert from 'node:assert/strict';
import {wholeNativeWords,validateProgress,boundedCount} from '../bochs-cpu3-native-cold-bios/parity.mjs';
import {compareIntIretCpu} from './cpu-comparison.mjs';
import {nativeIntIretProfile,nativeFrameStores,nativeSources} from './provider-profile.mjs';
import {namedCuts,layout,selector,dataSelector,bootStores,expectedShadow,validateMilestone,wordAt,entries,terminalEip} from './profile.mjs';
export {wholeNativeWords};
export const intIretNativeSources=Object.freeze([
 {path:'bochs/cpu/descriptor.h',sha256:'2cea747965fcb0523db6826929fbe9cfc2b59893102c789e01ece67c10e00b10',lines:'56–60',contract:'ValidCache1/ROK2/WOK4; selector index is not valid'},
 {path:'bochs/cpu/ctrl_xfer_pro.cc',sha256:'a70b7ee89237e5058e44e07095ea7d52d621dcff6fd727e75bfd1be544577d62',lines:'80–112',contract:'protected CS cache valid1'},
 {path:'bochs/cpu/segment_ctrl_pro.cc',sha256:'737fea13e5e6dc97d7b24d17b3cfe249dbbfba7aae37304abdf3e783b54af714',lines:'87–94,149–153',contract:'DS/SS load valid1'},
 ...[['access','access.cc'],['paging','paging.cc'],['interrupt','exception.cc'],['iret','iret.cc'],['stack','stack.cc']].map(([key,file])=>({path:'bochs/cpu/'+file,...nativeSources[key]})),
 {path:'bochs/cpu/soft_int.cc',sha256:'b17cf49a58770b37423d689090a3a23d5774b93a8e7c8af28bb4d76118c01074',lines:'122–155',contract:'actual software INT; no external IRQ or synthetic frame'},
 {path:'bochs/cpu/event.cc',sha256:'3f1603ed7e9b668cda9264821af0e03439577a617ba63cea69e95122b6cd2b12',lines:'387–400',contract:'native MOVSS inhibit consumed by following MOVSP; not JS shadow equivalence'},
 {path:'bochs/cpu/cpu.cc',sha256:'16a7b2a3640f2fb3d8df92f8916f8d5bc628e6ed8a7658c07b8db1c101ec80d9',lines:'138–151,633–685',contract:'native quantum completion and actual physical prefetch; future first guest must establish phases'},
].map(Object.freeze));
export const intIretParityPolicy=Object.freeze({
 cpu:'Strict equality of every represented JS CPU counterpart at paired Q; fixed source-backed reset/MOVCR0 model, no masks/normalization. All166 native words retained, not all166 cross-engine equality.',
 nativeOnly:'Native-only selector decomposition/cache attributes, pending events and unrepresented words retained. CS/DS/SS entire15-word rows separately checked at comparable phases; SS valid1 before first frame store and7 after.',
 phases:'Reset, PG-off ordinary retirements, then RAM MOV/INT/handlerMOV/IRET retirements and final inspect comparable. PG-enable, far-jump entry, zero-Q and line comparison boundaries UNMATCHED: CPU/NQ only, raw full boards/ten pages retained; no indirect RAM-hash equality or parity PASS. Separate stage records retain raw provider/JS checkpoints without comparison or parity claim.',
 effects:'Native successful callbacks independently retained. Native FLAGS→CS→IP writes versus JS IP→CS→FLAGS, native combined stackAD versus JS splitA/D. Exact effects and final pages checked, no equal callback order/generation assertion.',
 pages:'Ten complete4096-byte physical host-provider copies versus private JS memory at comparable cuts and settle, no AD masking. Native cache/ownership remains source-attested; wholeRAM hash-only.',
 scope:'Fixed same-CPL0 strict386 code16 softwareINT30/type6/IRET, IF0/no paging extensions/fault/externalIRQ/REP/HLT/PIO; stop before HLT. No OS or speed qualification.',
});
const row=(index,s,valid,type)=>[index,s,s>>>3,0,0,valid,1,0,1,type,0,0xffff,0,0,0];
export function validateDescriptorRows(n,js,board){const c=js.cpu;wholeNativeWords(n);
 if(c.cs===selector)assert.deepEqual(n.segments.slice(15,30),row(1,selector,1,11),'strict CS row');
 if(c.ds===dataSelector)assert.deepEqual(n.segments.slice(45,60),row(3,dataSelector,1,3),'strict DS loaded-only row');
 if(c.ss===dataSelector){const written=board.ram.writes.some(w=>w.kind==='frame');assert.deepEqual(n.segments.slice(30,45),row(2,dataSelector,written?7:1,3),'strict SS first-real-frame-write cache phase');}
}
export const nativeAdEffects=Object.freeze(Object.values(entries).map(e=>Object.freeze({raw:e.raw,before:e.value,after:e.value|(e===entries.stack?0x60:0x20)})));
export function validateNativeEffects(board,js,terminal=false){const writes=board.ram.writes;assert.ok(Array.isArray(writes)&&writes.length<=1024);
 const boot=writes.filter(w=>w.kind==='boot'),frame=writes.filter(w=>w.kind==='frame'),ad=writes.filter(w=>w.kind==='ad');assert.equal(writes.length,boot.length+frame.length+ad.length,'no unknown native write kind');
 const jsBoot=js.stores.filter(w=>w.raw<0xcffa||w.raw>0xcffe),jsFrame=js.stores.filter(w=>w.raw>=0xcffa&&w.raw<=0xcffe);
 assert.deepEqual(boot.map(w=>[w.raw,w.bytes]),jsBoot.map(w=>[w.raw,w.bytes]),'ordered actual boot writes');assert.deepEqual(boot.map(w=>[w.raw,w.bytes]),bootStores.slice(0,boot.length).map(w=>[w.raw,w.bytes]),'owned boot prefix');
 assert.equal(frame.length,jsFrame.length);assert.deepEqual(frame.map(w=>[w.raw,w.bytes]),nativeFrameStores.slice(0,frame.length).map(w=>[w.raw,w.bytes]),'native FLAGS/CS/IP order independent of JS');
 assert.equal(board.ram.bootStores,boot.length);assert.equal(board.ram.frameWords,frame.length);assert.equal(board.ram.storeCount,writes.length);
 const seen=new Set();for(const e of ad){assert.ok(!seen.has(e.raw),'one native first AD effect per table entry');seen.add(e.raw);const want=nativeAdEffects.find(w=>w.raw===e.raw);assert.ok(want);assert.deepEqual([e.raw,e.before,e.after,e.bytes],[want.raw,want.before,want.after,[e.after&255,(e.after>>>8)&255,(e.after>>>16)&255,e.after>>>24]],'exact native monotonic AD effect');}
 if(terminal){assert.equal(boot.length,20);assert.equal(frame.length,3);assert.equal(ad.length,6);assert.deepEqual([...seen].sort((a,b)=>a-b),nativeAdEffects.map(e=>e.raw).sort((a,b)=>a-b));}
 return {bootWrites:boot.length,frameWrites:frame.length,nativeAdWrites:ad.length,callbackOrder:'independent native tape; not JS tape equality'};
}
export function comparablePhase(kind,js,dq){assert.ok(['reset','resume','line','final-inspect'].includes(kind));assert.ok(dq===0||dq===1);if(kind==='reset')return true;if(kind==='final-inspect')return js.cpu.cs===selector&&js.cpu.eip===terminalEip;if(kind!=='resume'||dq===0)return false;return !(js.cpu.cr0&0x80000000)||js.cpu.cs===selector&&[0x7003,0x7010,0x7013,terminalEip].includes(js.cpu.eip);}
export function compareBoundary(n,board,js,pages,kind='resume',dq=1){
 compareIntIretCpu(n,js.cpu);assert.equal(boundedCount(n.successfulQuanta,512),js.q);assert.equal(board.successfulQuanta,js.q);assert.equal(js.cpu.cr4,0);assert.deepEqual([js.cpu.interruptShadow,js.cpu.nmiShadow,js.cpu.debugShadow],expectedShadow(js.cpu.cs,js.cpu.eip));
 assert.deepEqual(Object.keys(pages).sort(),Object.keys(layout).sort());for(const key of Object.keys(layout)){assert.ok(pages[key] instanceof Uint8Array&&js.pages[key] instanceof Uint8Array);assert.equal(pages[key].length,4096);assert.equal(js.pages[key].length,4096);}
 if(!comparablePhase(kind,js,dq))return {status:'UNMATCHED_PHASE',coverage:'representedCPU/NQ only; raw boards/ten pages retained without equality claim'};
 validateDescriptorRows(n,js,board);assert.deepEqual(board.board,js.board,'full actual comparable board');for(const key of Object.keys(layout))assert.deepEqual(pages[key],js.pages[key],'whole comparable physical '+key+' page');validateNativeEffects(board,js);assert.equal(board.ram.admitted,js.cpu.cs===selector,'admitted only after real RAM fetch at comparable cuts');
 return {status:'COMPARABLE_PARITY_PASS',coverage:'representedCPU/source-backedCSDS/fullSS cache/fullboard/ten unmodified4096-byte pages/owned independent effects'};
}
export function intIretProgress(previous,n){const p=validateProgress(previous,n);assert.ok(p.n<=nativeIntIretProfile.maxNativeTicks&&p.q<=nativeIntIretProfile.maxQuanta);assert.equal(n.activityState,0);for(const key of ['repIterations','repPartial','faults','irqDeliveries','portCommits','haltIdleCuts'])assert.equal(boundedCount(n.execution[key]),0,key+' forbidden');return p;}
export function validateMilestones(cuts){assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));let prior=-1,comparable=0,unmatched=0;
 for(const c of cuts){assert.ok(Number.isSafeInteger(c.q)&&c.q>prior&&c.q<=512);prior=c.q;assert.equal(c.q,c.javascript.q);validateMilestone(c.name,c.javascript);const phase=compareBoundary(c.native,c.board,c.javascript,c.pages,c.name==='reset'?'reset':'resume',1);assert.deepEqual(c.comparison,phase);if(phase.status==='COMPARABLE_PARITY_PASS')comparable++;else unmatched++;}assert.equal(unmatched,2);return {milestones:cuts.length,comparableCuts:comparable,unmatchedCuts:unmatched,pageBytesPerRecordedBoundary:10*4096};}
export function validateFinalPages(pages){assert.deepEqual(Object.keys(pages).sort(),Object.keys(layout).sort());for(const p of Object.values(pages))assert.ok(p instanceof Uint8Array&&p.length===4096);assert.equal(wordAt(pages.directory,0),0x2023);for(const [key,value]of [['gdt',0x23],['code',0xa023],['idt',0x3023],['stack',0xc063],['rom',0xf0023]])assert.equal(wordAt(pages.table,entries[key].raw&4095),value,key+' exact final AD');assert.deepEqual([...pages.aliasCode.subarray(0,4)],[0xf4,0xcc,0xcc,0xcc]);assert.deepEqual([...pages.aliasData.subarray(0,4)],[0xad,0xde,0xef,0xbe]);assert.deepEqual([...pages.aliasStack.subarray(0,4)],[0xcc,0xcc,0xcc,0xcc]);assert.deepEqual([...pages.stack.subarray(0xffa,0x1000)],[5,0x70,0x18,0,2,0]);}
export function validateMemoryTape(events,board){assert.ok(Array.isArray(events)&&events.length<=1024);for(const [i,e]of events.entries()){assert.equal(e.ordinal,i);assert.ok(['read','write'].includes(e.direction));for(const k of ['raw','generation','nativeTicks','successfulQuanta'])boundedCount(e[k],k==='raw'?0xffffffff:512);assert.ok(Array.isArray(e.bytes)&&e.bytes.length>0&&e.bytes.length<=16);for(const v of e.bytes)assert.ok(Number.isInteger(v)&&v>=0&&v<=255);}assert.deepEqual(events.filter(e=>e.direction==='read').map(({direction,ordinal,...e})=>e),board.ram.reads);assert.deepEqual(events.filter(e=>e.direction==='write').map(({direction,ordinal,...e})=>e),board.ram.writes);return {events:events.length,coverage:'real successful callback chronology; C tags/live PC not exposed by provider, no JS ordering assertion'};}
