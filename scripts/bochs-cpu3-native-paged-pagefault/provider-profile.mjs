/** Distinct pending fixed PF14 native profile; no old build/addon authority. */
import assert from 'node:assert/strict';
import {pageFaultProfile,bootStores,frameStores,repairStore,retryStore,layout,entries,ramProgram,fixedPageFaultRom,romInstructions,ramInstructions,farJumpIp,lgdtIp,lidtIp,dsWriteIp,ssWriteIp,afterSs} from './profile.mjs';
export {coldBoardConfig,bootStores,layout,entries,wordAt} from './profile.mjs';
export const fixedColdBios=fixedPageFaultRom;
export const nativePageFaultProfile=Object.freeze({...pageFaultProfile,kind:'fixed-paged-cpl0-pf14-repair-cr3-iret-retry-native-source-v1',maxNativeTicks:512,maxQuanta:512,status:'PENDING_NEW_NATIVE_FAULT_RUNTIME_BUILD_AND_EXECUTION'});
export const coldBoardProfile=Object.freeze({...nativePageFaultProfile,maxPortEvents:0,maxDebugBytes:0,maxStatusReads:0});
export const coldInAllowed=()=>false,coldOutAllowed=()=>false;
export const ownedTableEntries=Object.freeze(Object.values(entries));
export const nativeFrameStores=Object.freeze([...frameStores].reverse());
export const generationBeforeBoot=Object.freeze(bootStores.map((e,i)=>bootStores.slice(0,i).filter(p=>(p.raw&~4095)===(e.raw&~4095)).length));
export const nativeSources=Object.freeze({fault:{sha256:'5701d81b89fda61a6c357e63fff653718f6eb6115e3a23d7b23ade15e5d9eb08',lines:'660-716,918-950',scope:'Fault-note before RIP restart; FLAGS/CS/IP/error pushes; RF cleared before type6 handler return'},paging:{sha256:'e72fcf4f21a32b5618eeeb2e783f4faef8feea4f2d1f0dc8b3cb6515858e4f5d',lines:'497-529,1259-1284',scope:'Nonpresent supervisor write PF14/error2/CR2; successful first write combines leafAD'},access:{sha256:'1ac261289fd31feded2b4e123f6aedf795277298e5adea946edabb94089bd526',lines:'82-102',scope:'DS/SS ROK/WOK before paging: valid1 to7 source expectation, not observed PF telemetry'},cpu:{sha256:'16a7b2a3640f2fb3d8df92f8916f8d5bc628e6ed8a7658c07b8db1c101ec80d9',lines:'60-70,138-151',scope:'Fault delivery yields after one tick and no successful quantum'},cr3:{sha256:'f39cb6b7b1f7b030690104dcd31e839651a6d343784d8a072e5b337d17fcd374',lines:'1389-1397',scope:'Same-value CR3 write flushes translations; strict386 uses no INVLPG'}});
export const walkOwners=Object.freeze([
 // Exact delivery/operand owners precede matching prefetch PCs. Delivery kind is native private source state.
 {phase:'fault-delivery',liveCs:24,liveIp:0x7003,attempt:{cs:24,ip:0x7003},delivery:1,leaves:[entries.idt.raw,entries.gdt.raw,entries.stack.raw]},
 {phase:'fault-or-retry-write',liveCs:24,liveIp:0x7006,attempt:{cs:24,ip:0x7003},delivery:0,leaves:[entries.data.raw]},
 {phase:'handler-PTE-repair',liveCs:24,liveIp:0x7029,attempt:{cs:24,ip:0x7020},delivery:0,leaves:[entries.table.raw]},
 {phase:'IRET-frame',liveCs:24,liveIp:0x7033,attempt:{cs:24,ip:0x7032},delivery:0,leaves:[entries.stack.raw,entries.gdt.raw]},
 {phase:'data-readback',liveCs:24,liveIp:0x700a,attempt:{cs:24,ip:0x7006},delivery:0,leaves:[entries.data.raw]},
 {phase:'ROM-prefetch',liveCs:0xf000,liveIp:farJumpIp,attempt:null,delivery:0,leaves:[entries.rom.raw]},
 {phase:'far-jump-descriptor',liveCs:0xf000,liveIp:farJumpIp+5,attempt:{cs:0xf000,ip:farJumpIp},delivery:0,leaves:[entries.gdt.raw]},
 ...ramInstructions.map(i=>({phase:'code-prefetch-'+i.ip,liveCs:24,liveIp:i.ip,attempt:null,delivery:0,leaves:[entries.code.raw]})),
].map(e=>Object.freeze({...e,leaves:Object.freeze(e.leaves)})));
export const nativeOrdinaryReads=Object.freeze([
 {cs:0xf000,ip:lgdtIp,kind:2,raw:0xf0400,length:6},{cs:0xf000,ip:lidtIp,kind:2,raw:0xf0406,length:6},
 ...[dsWriteIp,ssWriteIp].map(ip=>({cs:0xf000,ip,kind:1,raw:0x610,length:8})),{cs:0xf000,ip:farJumpIp,kind:1,raw:0x618,length:8},
 {cs:24,ip:0x7003,kind:1,raw:0x3070,length:8},{cs:24,ip:0x7003,kind:1,raw:0x618,length:8},
 {cs:24,ip:0x7032,kind:1,raw:0x618,length:8},...[0xcffe,0xcffc,0xcffa].map(raw=>({cs:24,ip:0x7032,kind:1,raw,length:2})),
 {cs:24,ip:0x7006,kind:1,raw:layout.data,length:2},
].map(Object.freeze));
function u(n){assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff);return n;}
export function nativeWalkOwner(liveCs,liveIp,cs,eip,delivery){for(const n of [liveCs,liveIp,cs,eip,delivery])u(n);return walkOwners.find(e=>e.liveCs===liveCs&&e.liveIp===liveIp&&e.delivery===delivery&&(!e.attempt||e.attempt.cs===cs&&e.attempt.ip===eip))??null;}
export function nativeWalkAllowed(kind,raw,length,liveCs,liveIp,cs,eip,delivery){for(const n of [kind,raw,length])u(n);const owner=nativeWalkOwner(liveCs,liveIp,cs,eip,delivery);return !!owner&&length===4&&(kind===1||kind===3?raw===entries.pde.raw:kind===2||kind===4?owner.leaves.includes(raw):false);}
export function nativeAdUpdate(raw,before,after){for(const n of [raw,before,after])u(n);const entry=ownedTableEntries.find(e=>e.raw===raw);assert.ok(entry);const base=raw===entries.data.raw?0xb003:entry.value;assert.ok(base&1,'no A/D write to nonpresent entry');assert.equal(before,base);assert.equal(after,(base|(raw===entries.stack.raw||raw===entries.table.raw||raw===entries.data.raw?0x60:0x20))>>>0);return {raw,before,after};}
export function validatePageFaultRead(raw,length){u(raw);assert.ok(Number.isSafeInteger(length)&&length>0&&length<=16);assert.ok(ownedTableEntries.some(e=>raw===e.raw&&length===4)||nativeOrdinaryReads.some(e=>raw>=e.raw&&raw<e.raw+e.length&&length<=e.raw+e.length-raw));}
export function validatePageFaultWrite(raw,bytes,state){
 u(raw);assert.ok(bytes instanceof Uint8Array);assert.ok(Number.isSafeInteger(state.boot)&&state.boot>=0&&state.boot<=bootStores.length);
 if(state.boot<bootStores.length){const e=bootStores[state.boot];assert.equal(raw,e.raw);assert.deepEqual([...bytes],e.bytes);assert.equal(state.admitted,false);return {kind:'boot',nextBoot:state.boot+1};}
 if(raw>=0xcff8&&raw<=0xcffe){const e=nativeFrameStores[state.frameWords];assert.ok(e);assert.equal(raw,e.raw);assert.deepEqual([...bytes],e.bytes);assert.equal(state.admitted,true);assert.equal(state.tableValues[entries.stack.raw],0xc063);return {kind:'frame',nextBoot:state.boot,nextFrameWords:state.frameWords+1};}
 if(raw===repairStore.raw&&state.tableValues[raw]===0){assert.equal(state.frameWords,4);assert.equal(state.repaired,false);assert.equal(state.dataWritten,false);assert.equal(state.tableValues[entries.table.raw],0x2063);assert.deepEqual([...bytes],repairStore.bytes);return {kind:'repair',nextBoot:state.boot,raw,before:0,after:0xb003};}
 if(raw===retryStore.raw){assert.equal(state.frameWords,4);assert.equal(state.repaired,true);assert.equal(state.dataWritten,false);assert.equal(state.tableValues[entries.data.raw],0xb063);assert.deepEqual([...bytes],retryStore.bytes);return {kind:'retry',nextBoot:state.boot};}
 const entry=ownedTableEntries.find(e=>e.raw===raw);assert.ok(entry&&bytes.length===4);const before=state.tableValues[raw],after=(bytes[0]|bytes[1]<<8|bytes[2]<<16|bytes[3]<<24)>>>0;nativeAdUpdate(raw,before,after);return {kind:'ad',nextBoot:state.boot,raw,before,after};
}
export function expectedRamPage(){const p=new Uint8Array(4096);p.set(ramProgram);return p;}
export const nativeAdExpectation=Object.freeze({count:8,status:'SOURCE_EXPECTATION_UNOBSERVED',ordering:'independent native actual tape; never JS11-order equality'});
export const nativeCacheExpectations=Object.freeze({csValid:1,dsLoadedValid:1,dsAfterFailedWriteCheckValid:7,ssLoadedValid:1,ssAfterFirstFrameWordValid:7,status:'SOURCE_EXPECTATION_UNOBSERVED'});
export function nativeShadowPhase(cs,eip,interruptInhibited,debugInhibited){const expected=cs===0xf000&&eip===afterSs;return interruptInhibited===expected&&debugInhibited===expected;}
