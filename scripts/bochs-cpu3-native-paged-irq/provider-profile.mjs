/** Source-only native contract: no prepared manifest or DSO is qualified. */
import assert from 'node:assert/strict';
import {pagedIrqProfile,bootStores,frameStores,markerStores,layout,entries,ramProgram,fixedPagedIrqRom,romInstructions,ramInstructions,farJumpIp,lgdtIp,lidtIp,dsWriteIp,ssWriteIp,afterSs} from './profile.mjs';
export {coldBoardConfig,bootStores,layout,entries,wordAt} from './profile.mjs';
export const fixedColdBios=fixedPagedIrqRom;
export const nativePagedIrqProfile=Object.freeze({...pagedIrqProfile,kind:'fixed-paged-cpl0-irq0-iret-native-source-v1',maxNativeTicks:512,maxQuanta:512,status:'SOURCE_ONLY_NO_PREPARATION_BUILD_OR_GUEST'});
export const coldBoardProfile=Object.freeze({...nativePagedIrqProfile,maxPortEvents:0,maxDebugBytes:0,maxStatusReads:0,maxIrqAcks:1});
export const coldInAllowed=()=>false,coldOutAllowed=()=>false;
export const ownedTableEntries=Object.freeze(Object.values(entries));
export const nativeFrameStores=Object.freeze([...frameStores].reverse());
export const generationBeforeBoot=Object.freeze(bootStores.map((e,i)=>bootStores.slice(0,i).filter(p=>(p.raw&~4095)===(e.raw&~4095)).length));
export const nativeSources=Object.freeze({paging:{sha256:'e72fcf4f21a32b5618eeeb2e783f4faef8feea4f2d1f0dc8b3cb6515858e4f5d',lines:'1259-1284',scope:'First native writable leaf combines A and D; JS callback count is separate'},interrupt:{sha256:'5701d81b89fda61a6c357e63fff653718f6eb6115e3a23d7b23ade15e5d9eb08',lines:'278-330,660-714,756-818',scope:'SameCPL type6 FLAGS/CS/IP pushes and IF0; software delivery differs from external IRQ'},iret:{sha256:'afd03e8eef2e9e90470314c807161ebb2ad44397b29c3f775dec7a866b2dbdae',lines:'100-142,156-213'},access:{sha256:'1ac261289fd31feded2b4e123f6aedf795277298e5adea946edabb94089bd526',lines:'82-102',scope:'SS cache valid1->7 only after first actual word write; native confirmation pending'},stack:{sha256:'8d6ba5771a0f676034764773e15ffecab39b63cbc1b204e067a726b4afa925fd',lines:'31-133,161-191,282-310',scope:'Owned stack host pointer remains unavailable; virtual access/callback path source-attested'},shadow:{scope:'Native interrupt inhibit follows MOVSS and STI successor; debug inhibit follows MOVSS only; actual guest confirmation pending'}});
const u32=n=>assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff);
export function nativeEntryAllowed(raw,value){u32(raw);u32(value);const e=ownedTableEntries.find(e=>e.raw===raw);if(!e)return false;const delta=value^e.value;return delta===0||delta===0x20||raw===entries.stack.raw&&delta===0x60;}
export function nativeAdUpdate(raw,before,after){assert.ok(nativeEntryAllowed(raw,before)&&nativeEntryAllowed(raw,after));assert.notEqual(before,after);assert.ok(raw===entries.stack.raw?before===0xc003&&after===0xc063:after===((before|0x20)>>>0),'only exact first A or combined INT stack AD');return {raw,before,after};}
export const walkOwners=Object.freeze([
 {phase:'ROM-prefetch',liveCs:0xf000,liveIp:farJumpIp,attempt:null,leaves:[entries.rom.raw]},
 {phase:'far-jump-descriptor',liveCs:0xf000,liveIp:farJumpIp+5,attempt:{cs:0xf000,ip:farJumpIp},leaves:[entries.gdt.raw]},
 ...ramInstructions.map(i=>({phase:'code-prefetch-'+i.ip,liveCs:24,liveIp:i.ip,attempt:null,leaves:[entries.code.raw]})),
 {phase:'IRQ-prior-attempt',liveCs:24,liveIp:0x7002,attempt:{cs:24,ip:0x7001},leaves:[entries.idt.raw,entries.gdt.raw,entries.stack.raw]},
 {phase:'IRQ-gate-stack',liveCs:24,liveIp:0x700a,attempt:{cs:24,ip:0x7002},leaves:[entries.idt.raw,entries.gdt.raw,entries.stack.raw]},
 {phase:'IRET-stack-CS',liveCs:24,liveIp:0x7011,attempt:{cs:24,ip:0x7010},leaves:[entries.stack.raw,entries.gdt.raw]},
].map(e=>Object.freeze({...e,leaves:Object.freeze(e.leaves)})));
export function nativeWalkOwner(liveCs,liveIp,cs,eip){for(const n of [liveCs,liveIp,cs,eip])u32(n);return walkOwners.find(e=>e.attempt&&e.liveCs===liveCs&&e.liveIp===liveIp&&e.attempt.cs===cs&&e.attempt.ip===eip)??walkOwners.find(e=>!e.attempt&&e.liveCs===liveCs&&e.liveIp===liveIp)??null;}
export function nativeWalkAllowed(kind,raw,width,liveCs,liveIp,cs,eip){for(const n of [kind,raw,width])u32(n);const owner=nativeWalkOwner(liveCs,liveIp,cs,eip);return !!owner&&width===4&&(kind===1||kind===3?raw===entries.pde.raw:kind===2||kind===4?owner.leaves.includes(raw):false);}
export const nativeOrdinaryReads=Object.freeze([
 {cs:0xf000,ip:lgdtIp,kind:2,raw:0xf0400,length:6}, {cs:0xf000,ip:lidtIp,kind:2,raw:0xf0406,length:6},
 ...[dsWriteIp,ssWriteIp].map(ip=>({cs:0xf000,ip,kind:1,raw:0x610,length:8})),
 {cs:0xf000,ip:farJumpIp,kind:1,raw:0x618,length:8},
 {cs:24,ip:0x7002,kind:1,raw:0x3000,length:8}, {cs:24,ip:0x7002,kind:1,raw:0x618,length:8},
 {cs:24,ip:0x7010,kind:1,raw:0x618,length:8},
 ...[0xcffe,0xcffc,0xcffa].map(raw=>({cs:24,ip:0x7010,kind:1,raw,length:2})),
].map(Object.freeze));
export function validateIntRead(raw,width){u32(raw);assert.ok(Number.isSafeInteger(width)&&width>0&&width<=16);assert.ok(ownedTableEntries.some(e=>e.raw===raw&&width===4)||nativeOrdinaryReads.some(e=>raw>=e.raw&&raw<e.raw+e.length&&width<=e.raw+e.length-raw),'owned entry/pointer/descriptor/gate/IRET read');}
export function validateIntWrite(raw,bytes,state){u32(raw);assert.ok(bytes instanceof Uint8Array);assert.ok(state&&Number.isInteger(state.markerWords)&&state.markerWords>=0&&state.markerWords<=markerStores.length&&Number.isSafeInteger(state.boot)&&state.boot>=0&&state.boot<=bootStores.length);
 if(state.boot<bootStores.length){const e=bootStores[state.boot];assert.equal(raw,e.raw);assert.deepEqual([...bytes],e.bytes);assert.equal(state.admitted,false);return {kind:'boot',nextBoot:state.boot+1};}
 const frame=nativeFrameStores[state.frameWords];if(raw>=0xcffa&&raw<=0xcffe){assert.ok(frame);assert.equal(state.admitted,true);assert.equal(raw,frame.raw);assert.deepEqual([...bytes],frame.bytes);assert.equal(state.tableValues[entries.stack.raw],0xc063);return {kind:'frame',nextBoot:state.boot,nextFrameWords:state.frameWords+1};}
 const marker=markerStores[state.markerWords];if(marker&&raw===marker.raw){assert.equal(state.frameWords,3);assert.deepEqual([...bytes],marker.bytes);return {kind:'marker',nextBoot:state.boot,nextMarkerWords:state.markerWords+1};}
 const e=ownedTableEntries.find(e=>e.raw===raw);assert.ok(e&&bytes.length===4);const before=state.tableValues[raw],after=(bytes[0]|bytes[1]<<8|bytes[2]<<16|bytes[3]<<24)>>>0;nativeAdUpdate(raw,before,after);return {kind:'ad',nextBoot:state.boot,raw,before,after};
}
export function expectedRamPage(){const p=new Uint8Array(4096);p.set(ramProgram);return p;}
export const nativeCacheExpectations=Object.freeze({cs:{selector:24,type:11,valid:1,base:0,limit:65535,default32:0},ds:{selector:16,type:3,valid:1,base:0,limit:65535,default32:0},ss:{selector:16,type:3,validBeforeFrame:1,validAfterFirstWordWrite:7,base:0,limit:65535,default32:0},scope:'Separate native hidden-cache expectations; selector.index is not cache.valid; actual phase pending first guest'});
export function nativeShadowPhase(cs,eip,interruptInhibited,debugInhibited){const movSs=cs===0xf000&&eip===afterSs,sti=cs===24&&eip===0x7001;return interruptInhibited===(movSs||sti)&&debugInhibited===movSs;}
