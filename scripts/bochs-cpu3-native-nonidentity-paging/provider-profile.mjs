/** Native-only policy proposal. A new runtime/build identity is still required. */
import assert from 'node:assert/strict';
import {pagingProfile,bootStores,dataStore,layout,entries,ramProgram,fixedPagingRom,romInstructions,ramInstructions,farJumpIp,dsWriteIp,lgdtIp} from './profile.mjs';
export {coldBoardConfig} from './profile.mjs';
export {bootStores,layout,entries,wordAt} from './profile.mjs';
export const fixedColdBios=fixedPagingRom;
export const nativePagingProfile=Object.freeze({...pagingProfile,kind:'fixed-code16-nonidentity-paging-native-source-v1',maxNativeTicks:512,maxQuanta:512,status:'SOURCE_ONLY_NO_PREPARATION_BUILD_OR_GUEST'});
export const coldBoardProfile=Object.freeze({...nativePagingProfile,maxPortEvents:0,maxDebugBytes:0,maxStatusReads:0});
export const coldInAllowed=()=>false,coldOutAllowed=()=>false;
const u32=n=>assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff);
const same=(a,b)=>assert.deepEqual([...a],[...b]);
export const ownedTableEntries=Object.freeze(Object.values(entries));
export const nativeWalkSources=Object.freeze({paging:{sha256:'e72fcf4f21a32b5618eeeb2e783f4faef8feea4f2d1f0dc8b3cb6515858e4f5d',readLines:'1157–1174',writeLines:'1259–1284',dispatchLines:'1397–1492'},cpu:{prefetchLines:'633–685',scope:'Existing physical prefetch page plus biased EIP; no second translating walk or inferred identity address'}});
export function nativeEntryAllowed(raw,value){u32(raw);u32(value);const e=ownedTableEntries.find(x=>x.raw===raw);if(!e)return false;const delta=value^e.value;return raw===entries.pde.raw||raw===entries.code.raw||raw===entries.gdt.raw||raw===entries.rom.raw?delta===0||delta===0x20:raw===entries.data.raw&&(delta===0||delta===0x20||delta===0x60);}
export function nativeAdUpdate(raw,before,after){assert.ok(nativeEntryAllowed(raw,before)&&nativeEntryAllowed(raw,after));assert.notEqual(before,after);assert.ok(after===((before|0x20)>>>0)||raw===entries.data.raw&&before===0xb023&&after===0xb063,'only first A or data D; no PDE/code D');return {raw,before,after};}
export function expectedRamPage(){const page=new Uint8Array(4096);page.set(ramProgram);return page;}
export function validatePagingRead(raw,width){u32(raw);assert.ok(Number.isSafeInteger(width)&&width>0&&width<=16);assert.ok(ownedTableEntries.some(e=>raw===e.raw&&width===4)||raw>=0x610&&raw<0x620&&width<=0x620-raw||raw>=0xf0400&&raw<0xf0406&&width<=0xf0406-raw||(raw===0xb000||raw===0xb002)&&width===2,'owned page-table/GDT/pointer/data read only');}
export function validatePagingWrite(raw,bytes,state){u32(raw);assert.ok(bytes instanceof Uint8Array);assert.ok(state&&Number.isSafeInteger(state.boot)&&state.boot>=0&&state.boot<=bootStores.length);if(state.boot<bootStores.length){const e=bootStores[state.boot];assert.equal(raw,e.raw);same(bytes,e.bytes);assert.equal(state.admitted,false);return {kind:'boot',nextBoot:state.boot+1};}
 if(raw===dataStore.raw){assert.equal(state.admitted,true);assert.equal(state.dataWritten,false);same(bytes,dataStore.bytes);return {kind:'data',nextBoot:state.boot};}
 const e=ownedTableEntries.find(e=>e.raw===raw);assert.ok(e&&bytes.length===4,'only full dword A/D effect');const before=state.tableValues[raw];u32(before);const after=(bytes[0]|bytes[1]<<8|bytes[2]<<16|bytes[3]<<24)>>>0;nativeAdUpdate(raw,before,after);assert.ok(raw!==entries.data.raw||after!==0xb063||state.dataRead,'read A before dirty data write');return {kind:'ad',nextBoot:state.boot,raw,before,after};
}
/** Exact live-prefetch versus advanced-PC operand phases; not JS callback order. */
export const walkOwners=Object.freeze([
 {phase:'ROM-prefetch',liveCs:0xf000,liveIp:farJumpIp,attempt:null},
 {phase:'descriptor-operand',liveCs:0xf000,liveIp:farJumpIp+5,attempt:{cs:0xf000,ip:farJumpIp}},
 {phase:'code-prefetch',liveCs:0x18,liveIp:0x7000,attempt:null},
 {phase:'data-read',liveCs:0x18,liveIp:0x7005,attempt:{cs:0x18,ip:0x7001}},
 {phase:'data-write',liveCs:0x18,liveIp:0x700b,attempt:{cs:0x18,ip:0x7005}},
 {phase:'data-readback',liveCs:0x18,liveIp:0x700f,attempt:{cs:0x18,ip:0x700b}},
].map(Object.freeze));
export function nativeWalkOwner(liveCs,liveIp,attemptCs,attemptIp){for(const n of [liveCs,liveIp,attemptCs,attemptIp])u32(n);return walkOwners.find(x=>x.liveCs===liveCs&&x.liveIp===liveIp&&(!x.attempt||x.attempt.cs===attemptCs&&x.attempt.ip===attemptIp))?.phase??null;}
export function walkAddresses(phase){switch(phase){case 'ROM-prefetch':return [entries.pde.raw,entries.rom.raw];case 'descriptor-operand':return [entries.pde.raw,entries.gdt.raw];case 'code-prefetch':return [entries.pde.raw,entries.code.raw];case 'data-read':case 'data-write':case 'data-readback':return [entries.pde.raw,entries.data.raw];default:return [];}}
export function nativeWalkAllowed(kind,raw,width,liveCs,liveIp,attemptCs,attemptIp){for(const n of [kind,raw,width])u32(n);const phase=nativeWalkOwner(liveCs,liveIp,attemptCs,attemptIp);return width===4&&walkAddresses(phase).includes(raw)&&(kind===1||kind===3?raw===entries.pde.raw:kind===2||kind===4?raw!==entries.pde.raw:false);}
export const generationBeforeBoot=Object.freeze(bootStores.map((e,i)=>bootStores.slice(0,i).filter(p=>(p.raw&~4095)===(e.raw&~4095)).length));
export const nativeOrdinaryReads=Object.freeze([{cs:0xf000,ip:lgdtIp,kind:2,raw:0xf0400,length:6},{cs:0xf000,ip:dsWriteIp,kind:1,raw:0x610,length:8},{cs:0xf000,ip:farJumpIp,kind:1,raw:0x618,length:8},{cs:0x18,ip:0x7001,kind:1,raw:0xb000,length:2},{cs:0x18,ip:0x700b,kind:1,raw:0xb002,length:2}].map(Object.freeze));
export const nativeInstructions=Object.freeze({rom:romInstructions,ram:ramInstructions});
