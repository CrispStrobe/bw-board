/** Finite strict386 paging proposal: linear and physical addresses differ. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export {coldBoardConfig} from '../bochs-cpu3-native-protected-ram/profile.mjs';
export const layout=Object.freeze({gdt:0,directory:0x1000,table:0x2000,aliasCode:0x7000,aliasData:0x9000,code:0xa000,data:0xb000});
export const selector=0x18,dataSelector=0x10,terminalEip=0x700f;
export const ramInstructions=Object.freeze([
 {ip:0x7000,bytes:[0x90]},
 {ip:0x7001,bytes:[0x8b,0x1e,0,0x90]},
 {ip:0x7005,bytes:[0xc7,6,2,0x90,0x78,0x56]},
 {ip:0x700b,bytes:[0x8b,0x16,2,0x90]},
].map(x=>Object.freeze({...x,bytes:Object.freeze(x.bytes)})));
export const ramProgram=Object.freeze([0x90,0x8b,0x1e,0,0x90,0xc7,6,2,0x90,0x78,0x56,0x8b,0x16,2,0x90,0xf4]);
export const entries=Object.freeze({pde:{raw:0x1000,value:0x2003},gdt:{raw:0x2000,value:3},code:{raw:0x201c,value:0xa003},data:{raw:0x2024,value:0xb003},rom:{raw:0x23c0,value:0xf0003}});
export const dword=v=>Uint8Array.of(v&255,(v>>>8)&255,(v>>>16)&255,v>>>24);
export function wordAt(bytes,offset){return (bytes[offset]|bytes[offset+1]<<8|bytes[offset+2]<<16|bytes[offset+3]<<24)>>>0;}
const instructions=[],effects=[];let ip=0x100;
const add=bytes=>{const at=ip;instructions.push(Object.freeze({ip,bytes:Object.freeze(bytes)}));ip+=bytes.length;return at;};
add([0xfa]);add([0xb8,0,0]);add([0x8e,0xd8]);
const store=(raw,bytes)=>{const owner=add([0x66,0xc7,6,raw&255,raw>>>8,...bytes]);effects.push(Object.freeze({cs:0xf000,ip:owner,raw,bytes:Object.freeze([...bytes])}));};
for(const [base,descriptor]of [[0x610,[255,255,0,0,0,0x93,0,0]],[0x618,[255,255,0,0,0,0x9b,0,0]]])for(let k=0;k<8;k+=4)store(base+k,descriptor.slice(k,k+4));
for(let k=0;k<ramProgram.length;k+=4)store(layout.code+k,ramProgram.slice(k,k+4));
for(const entry of Object.values(entries))store(entry.raw,[...dword(entry.value)]);
store(layout.data,[0x34,0x12,0,0]);
store(layout.aliasCode,[0xf4,0xcc,0xcc,0xcc]);store(layout.aliasData,[0xad,0xde,0xef,0xbe]);
export const bootStores=Object.freeze(effects);
export const lgdtIp=add([0x2e,0x0f,1,0x16,0,4]),afterLgdt=ip;
add([0x66,0xb8,0,0x10,0,0]);export const cr3WriteIp=add([0x0f,0x22,0xd8]),afterCr3=ip;
add([0x66,0xb8,1,0,0,0]);export const peWriteIp=add([0x0f,0x22,0xc0]),afterPe=ip;
add([0xb8,0x10,0]);export const dsWriteIp=add([0x8e,0xd8]),afterDs=ip;
add([0x66,0xb8,1,0,0,0x80]);export const pgWriteIp=add([0x0f,0x22,0xc0]),afterPg=ip;
export const farJumpIp=add([0xea,0,0x70,0x18,0]);
assert.ok(ip<0x400,'boot sequence does not overlap LGDT pointer');
export const romInstructions=Object.freeze(instructions);
export const dataStore=Object.freeze({cs:selector,ip:0x7005,raw:layout.data+2,bytes:Object.freeze([0x78,0x56])});
export const adTransitions=Object.freeze([
 {kind:'directory-accessed',cs:0xf000,ip:farJumpIp,raw:entries.pde.raw,before:0x2003,after:0x2023},
 {kind:'ROM-fetch-accessed',cs:0xf000,ip:farJumpIp,raw:entries.rom.raw,before:0xf0003,after:0xf0023},
 {kind:'descriptor-read-accessed',cs:0xf000,ip:farJumpIp,raw:entries.gdt.raw,before:3,after:0x23},
 {kind:'code-fetch-accessed',cs:selector,ip:0x7000,raw:entries.code.raw,before:0xa003,after:0xa023},
 {kind:'data-read-accessed',cs:selector,ip:0x7001,raw:entries.data.raw,before:0xb003,after:0xb023},
 {kind:'data-write-dirty',cs:selector,ip:0x7005,raw:entries.data.raw,before:0xb023,after:0xb063},
].map(Object.freeze));
export const pagingSources=Object.freeze({javascript:{path:'src/experimental/i80386.js',sha256:'6fba681208e1443cc9eff00ae6aba444903d23e5feafe62527b25428e72d60ed',lines:'399–472',scope:'strict386 two-level 4 KiB translation; A at both levels and D on leaf write'},bochs:{compiledRevision:'d065cbb7da787b4b46adab83958237a69c0b51de',path:'bochs/cpu/paging.cc',sha256:'e72fcf4f21a32b5618eeeb2e783f4faef8feea4f2d1f0dc8b3cb6515858e4f5d',lines:'1259–1284',scope:'non-PAE PDE/PTE A and leaf D semantics; no claim that current stack DSO admits paging'}});
export function fixedPagingRom(...args){assert.equal(args.length,0);const b=new Uint8Array(65536).fill(0xf4);for(const i of romInstructions)b.set(i.bytes,i.ip);b.set([0x1f,0,0,6,0,0],0x400);b.set([0xea,0,1,0,0xf0],0xfff0);return b;}
export const pagingProfile=Object.freeze({kind:'fixed-code16-nonidentity-4k-paging-source-v1',romSha256:createHash('sha256').update(fixedPagingRom()).digest('hex'),maxQuanta:512,status:'SOURCE_ONLY_NO_NATIVE_BUILD_OR_ADMISSION'});
export const namedCuts=Object.freeze([
 ['reset',0xf000,0xfff0],['after-LGDT',0xf000,afterLgdt],['CR3-ready',0xf000,afterCr3],['PE-enabled',0xf000,afterPe],['DS-ready',0xf000,afterDs],['PG-enabled',0xf000,afterPg],['entered-paged-code',selector,0x7000],['after-code-fetch',selector,0x7001],['after-data-read',selector,0x7005],['after-data-write',selector,0x700b],['before-HLT',selector,terminalEip],
].map(([name,cs,eip])=>Object.freeze({name,cs,eip})));
export function expectedCr0(cs,eip){if(cs===selector)return 0xfffffff1;assert.equal(cs,0xf000);return eip>=afterPg&&eip!==0xfff0?0xfffffff1:eip>=afterPe&&eip!==0xfff0?0x7ffffff1:0x7ffffff0;}
export function physicalFetch(cs,base,eip){for(const v of [cs,base,eip])assert.ok(Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff);if(cs===selector){assert.equal(base,0);assert.ok(ramInstructions.some(i=>i.ip===eip));return layout.code+eip-0x7000;}assert.equal(cs,0xf000);if(eip===0xfff0){assert.equal(base,0xffff0000);return 0xfffffff0;}assert.equal(base,0xf0000,'PG transition stays in identity ROM after reset far jump');assert.ok(romInstructions.some(i=>i.ip===eip));return base+eip;}
export function validateBootStore(raw,bytes,index,cs,eip){const e=bootStores[index];assert.ok(e&&Number.isSafeInteger(index)&&index>=0);assert.deepEqual([cs,eip,raw,[...bytes]],[e.cs,e.ip,e.raw,e.bytes]);return index+1;}
export function validateAdTransition(index,raw,before,after,cs,eip){const e=adTransitions[index];assert.ok(e&&Number.isSafeInteger(index)&&index>=0);assert.deepEqual([raw,before,after,cs,eip],[e.raw,e.before,e.after,e.cs,e.ip]);return e.kind;}
export function expectedPages(stores=[],updates=[]){const pages=Object.fromEntries(Object.keys(layout).map(k=>[k,new Uint8Array(4096)]));for(const e of [...stores,...updates.map(e=>({raw:e.raw,bytes:[...dword(e.after)]}))]){const k=Object.keys(layout).find(k=>layout[k]===(e.raw&~4095));assert.ok(k);pages[k].set(e.bytes,e.raw&4095);}return pages;}
export const codeCache=Object.freeze({base:0,limit:0xffff,default32:false,code:true,readable:true,writable:false,access:0x9b,address:0x618,dpl:0,conforming:false,present:true});
export const dataCache=Object.freeze({base:0,limit:0xffff,default32:false,present:true,code:false,expandDown:false,readable:true,writable:true,access:0x93,address:0x610});
export function validateMilestone(name,s){const cut=namedCuts.find(c=>c.name===name);assert.ok(cut);const c=s.cpu;assert.deepEqual([c.cs,c.eip,c.cr0,c.cr4,c.eflags,c.halted],[cut.cs,cut.eip,expectedCr0(c.cs,c.eip),0,2,false]);assert.equal(c.segmentCaches[1].base>>>0,c.cs===selector?0:c.eip===0xfff0?0xffff0000:0xf0000);
 const at=namedCuts.indexOf(cut);if(at>=1)assert.deepEqual(c.gdtr,{base:0x600,limit:0x1f});if(at>=2)assert.equal(c.cr3,layout.directory);if(at>=4){assert.equal(c.ds,dataSelector);assert.deepEqual(c.segmentCaches[3],dataCache);}if(at>=6)assert.deepEqual(c.segmentCaches[1],codeCache);assert.deepEqual([c.interruptShadow,c.nmiShadow,c.debugShadow],[0,0,0]);
 const projected=s.stores.map(e=>[e.cs,e.ip,e.raw,e.bytes]);assert.deepEqual(projected,(at===0?[]:at>=9?[...bootStores,dataStore]:bootStores).map(e=>[e.cs,e.ip,e.raw,e.bytes]));
 const ad=at<6?0:Math.min(6,at-3);assert.equal(s.updates.length,ad);assert.deepEqual(s.updates.map(e=>[e.kind,e.cs,e.ip,e.raw,e.before,e.after]),adTransitions.slice(0,ad).map(e=>[e.kind,e.cs,e.ip,e.raw,e.before,e.after]));assert.deepEqual(s.pages,expectedPages(s.stores,s.updates));
 if(at>=6){assert.equal(wordAt(s.pages.directory,0),0x2023);assert.equal(wordAt(s.pages.table,0xf0*4),0xf0023);assert.equal(wordAt(s.pages.table,0),0x23);}
 if(at>=7)assert.equal(wordAt(s.pages.table,7*4),0xa023);else if(at>=1)assert.equal(wordAt(s.pages.table,7*4),0xa003);
 if(at>=8){assert.equal(c.ebx&65535,0x1234);assert.equal(wordAt(s.pages.table,9*4),at>=9?0xb063:0xb023);}
 if(at>=9)assert.deepEqual([...s.pages.data.subarray(2,4)],[0x78,0x56]);if(at===10)assert.equal(c.edx&65535,0x5678);
 if(at>=1){assert.deepEqual([...s.pages.aliasCode.subarray(0,4)],[0xf4,0xcc,0xcc,0xcc]);assert.deepEqual([...s.pages.aliasData.subarray(0,4)],[0xad,0xde,0xef,0xbe]);assert.equal(wordAt(s.pages.directory,0)&0x40,0);assert.equal(wordAt(s.pages.table,7*4)&0x40,0);}
 return name;
}
