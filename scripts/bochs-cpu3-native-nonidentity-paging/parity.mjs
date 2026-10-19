/** Explicit comparison phases: retain raw unmatched pages, never normalize A/D. */
import assert from 'node:assert/strict';
import {wholeNativeWords,validateProgress,boundedCount} from '../bochs-cpu3-native-cold-bios/parity.mjs';
import {comparePagingCpu} from './cpu-comparison.mjs';
import {nativePagingProfile} from './provider-profile.mjs';
import {namedCuts,layout,selector,dataSelector,bootStores,validateMilestone,wordAt,entries} from './profile.mjs';
export {wholeNativeWords};
export const pagingNativeSources=Object.freeze([
 {path:'bochs/cpu/descriptor.h',sha256:'2cea747965fcb0523db6826929fbe9cfc2b59893102c789e01ece67c10e00b10',lines:'56–60',contract:'ValidCache1/ROK2/WOK4; index and valid are separate fields'},
 {path:'bochs/cpu/ctrl_xfer_pro.cc',sha256:'a70b7ee89237e5058e44e07095ea7d52d621dcff6fd727e75bfd1be544577d62',lines:'80–112',contract:'protected code descriptor installed valid1'},
 {path:'bochs/cpu/segment_ctrl_pro.cc',sha256:'737fea13e5e6dc97d7b24d17b3cfe249dbbfba7aae37304abdf3e783b54af714',lines:'87–94,149–153',contract:'protected data descriptor load valid1'},
 {path:'bochs/cpu/access.cc',sha256:'1ac261289fd31feded2b4e123f6aedf795277298e5adea946edabb94089bd526',lines:'82–102,127–170',contract:'ordinary DS read adds2; word write adds2|4 for this limitFFFF type3 descriptor'},
 {path:'bochs/cpu/paging.cc',sha256:'e72fcf4f21a32b5618eeeb2e783f4faef8feea4f2d1f0dc8b3cb6515858e4f5d',lines:'1157–1174,1259–1284,1397–1492',contract:'actual native full-dword walk callbacks, PDE/leaf A and data-leaf D; backend order not inferred from JS'},
 {path:'bochs/cpu/cpu.cc',sha256:'16a7b2a3640f2fb3d8df92f8916f8d5bc628e6ed8a7658c07b8db1c101ec80d9',lines:'633–685',contract:'source-owned existing physical prefetch page and biased EIP; prefetch can precede retirement'},
].map(Object.freeze));
export const pagingParityPolicy=Object.freeze({
 cpu:'Raw equality of all represented JS counterparts at paired retired Q, fixed Bochs reset/CR0 model, no flags masks. Retain all166 native words; native-only attributes are not all166 cross-engine parity.',
 nativeOnly:'Native cached selector decomposition/valid/type/DPL/G/AVL, pending event/mask and other unrepresented words retained. CS and DS rows independently asserted only at declared comparable ordinary cuts.',
 phases:'Reset, PG-off ordinary retirements, then retired NOP/data-read/data-write/readback and final paused inspect are comparable. PG-enabled/far-jump entry and zero-Q prefetch returns are UNMATCHED_PHASE records: CPU counterparts/NQ only, no board/page equality or PASS parity. Both raw full boards and seven pages retained unchanged.',
 pages:'All seven physical pages copied from actual host-provider backing and private JS memory. At declared comparable cuts and final catchup require all4096 bytes each equal; no A/D mask, synthetic walker update or normalization. Native cache/coherence remains source-attested, not an independent cache-memory dump.',
 effects:'Complete chronological native successful read/write callbacks plus actual generation/N/Q recorded independently. Boot/data writes match exact owned effects; walker order/generation counts do not have to match JS byte-store/A-D order.',
 scope:'Fixed nonidentity strict386 4KiB paging fixture, aliases poisoned, IF0/stableA20/no fault/IRQ/REP/HLT/PIO/CR4 extensions; ordinary checkpoint before HLT. No OS/performance claim.',
});
const row=(index,s,valid,type)=>[index,s,s>>>3,0,0,valid,1,0,1,type,0,0xffff,0,0,0];
export function validateDescriptorRows(n,js){const c=js.cpu;wholeNativeWords(n);
 if(c.cs===selector)assert.deepEqual(n.segments.slice(15,30),row(1,selector,1,11),'strict paged CS row');
 if(c.ds===dataSelector){let valid=1;if(c.cs===selector){assert.ok([0x7000,0x7001,0x7005,0x700b,0x700f].includes(c.eip));valid=c.eip===0x7005?3:c.eip>=0x700b?7:1;}assert.deepEqual(n.segments.slice(45,60),row(3,dataSelector,valid,3),'strict DS loaded/read/write cache phase');}
}
export function comparablePhase(kind,js,dq){
 assert.ok(['reset','resume','line','final-inspect'].includes(kind));assert.ok(dq===0||dq===1);if(kind==='reset')return true;
 if(kind==='final-inspect')return js.cpu.cs===selector&&js.cpu.eip===0x700f;
 if(kind!=='resume'||dq===0)return false;
 return !(js.cpu.cr0&0x80000000)||js.cpu.cs===selector&&[0x7001,0x7005,0x700b,0x700f].includes(js.cpu.eip);
}
export function compareBoundary(n,board,js,pages,kind='resume',dq=1){
 comparePagingCpu(n,js.cpu);assert.equal(boundedCount(n.successfulQuanta,512),js.q);assert.equal(board.successfulQuanta,js.q);assert.equal(js.cpu.cr4,0);assert.deepEqual([js.cpu.interruptShadow,js.cpu.nmiShadow,js.cpu.debugShadow],[0,0,0]);
 assert.deepEqual(Object.keys(pages).sort(),Object.keys(layout).sort());for(const key of Object.keys(layout)){assert.ok(pages[key] instanceof Uint8Array&&js.pages[key] instanceof Uint8Array);assert.equal(pages[key].length,4096);assert.equal(js.pages[key].length,4096);}
 if(!comparablePhase(kind,js,dq))return {status:'UNMATCHED_PHASE',coverage:'representedCPU/NQ only; full native/JS boards and pages retained without equality claim'};
 validateDescriptorRows(n,js);assert.deepEqual(board.board,js.board,'full actual comparable board');for(const key of Object.keys(layout))assert.deepEqual(pages[key],js.pages[key],'whole comparable physical '+key+' page');
 const ordinary=board.ram.writes.filter(w=>w.kind!=='ad');assert.deepEqual(ordinary.map(w=>[w.raw,w.bytes]),js.stores.map(w=>[w.raw,w.bytes]),'ordered boot/data effects, not walker order');assert.equal(board.ram.bootStores,Math.min(bootStores.length,js.stores.length));assert.equal(board.ram.storeCount,board.ram.writes.length);assert.equal(board.ram.admitted,js.cpu.cs===selector,'fetch admitted only at declared stable cuts');
 return {status:'COMPARABLE_PARITY_PASS',coverage:'representedCPU/source-backedCSDS/fullboard/seven unmodified4096-byte pages/owned ordinary effects'};
}
export function pagingProgress(previous,n){const p=validateProgress(previous,n);assert.ok(p.n<=nativePagingProfile.maxNativeTicks&&p.q<=nativePagingProfile.maxQuanta);assert.equal(n.activityState,0);for(const key of ['repIterations','repPartial','faults','irqDeliveries','portCommits','haltIdleCuts'])assert.equal(boundedCount(n.execution[key]),0,key+' forbidden');return p;}
export function validateMilestones(cuts){assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));let prior=-1;let comparable=0,unmatched=0;
 for(const c of cuts){assert.ok(Number.isSafeInteger(c.q)&&c.q>prior&&c.q<=512);prior=c.q;assert.equal(c.q,c.javascript.q);validateMilestone(c.name,c.javascript);const phase=compareBoundary(c.native,c.board,c.javascript,c.pages,c.name==='reset'?'reset':'resume',1);assert.deepEqual(c.comparison,phase);if(phase.status==='COMPARABLE_PARITY_PASS')comparable++;else unmatched++;}
 assert.equal(unmatched,2,'PG transition and far-jump entry are raw unmatched phases');return {milestones:cuts.length,comparableCuts:comparable,unmatchedCuts:unmatched,pageBytesPerRecordedBoundary:7*4096};}
export function validateFinalPages(pages){assert.deepEqual(Object.keys(pages).sort(),Object.keys(layout).sort());for(const p of Object.values(pages))assert.ok(p instanceof Uint8Array&&p.length===4096);
 assert.equal(wordAt(pages.directory,0),0x2023);for(const [key,value]of [['gdt',0x23],['code',0xa023],['data',0xb063],['rom',0xf0023]])assert.equal(wordAt(pages.table,entries[key].raw&4095),value,key+' exact final A/D');assert.deepEqual([...pages.aliasCode.subarray(0,4)],[0xf4,0xcc,0xcc,0xcc]);assert.deepEqual([...pages.aliasData.subarray(0,4)],[0xad,0xde,0xef,0xbe]);assert.deepEqual([...pages.data.subarray(0,4)],[0x34,0x12,0x78,0x56]);}
export function validateMemoryTape(events,board){assert.ok(Array.isArray(events)&&events.length<=1024);for(const [i,e]of events.entries()){assert.equal(e.ordinal,i);assert.ok(['read','write'].includes(e.direction));for(const k of ['raw','generation','nativeTicks','successfulQuanta'])boundedCount(e[k],k==='raw'?0xffffffff:512);assert.ok(Array.isArray(e.bytes)&&e.bytes.length>0&&e.bytes.length<=16);for(const v of e.bytes)assert.ok(Number.isInteger(v)&&v>=0&&v<=255);}
 assert.deepEqual(events.filter(e=>e.direction==='read').map(({direction,ordinal,...e})=>e),board.ram.reads);assert.deepEqual(events.filter(e=>e.direction==='write').map(({direction,ordinal,...e})=>e),board.ram.writes);return {events:events.length,coverage:'actual successful callback chronology only; C pagewalk tags/live PC not exposed by this provider tape'};}
