/** Finite owned strict386, same-CPL16 page-fault repair/retry source profile. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export {coldBoardConfig,dword,wordAt,codeCache,dataCache} from '../bochs-cpu3-native-nonidentity-paging/profile.mjs';
import {dword,wordAt,codeCache,dataCache} from '../bochs-cpu3-native-nonidentity-paging/profile.mjs';
export const layout=Object.freeze({gdt:0,directory:0x1000,table:0x2000,idt:0x3000,aliasCode:0x7000,aliasData:0x8000,code:0xa000,data:0xb000,stack:0xc000,aliasStack:0xd000});
export const selector=0x18,dataSelector=0x10,vector=14,faultEip=0x7003,terminalEip=0x700a,handlerEip=0x7020,initialSp=0xe000;
export const gate=Object.freeze({raw:0x3070,bytes:Object.freeze([0x20,0x70,0x18,0,0,0x86,0,0]),base:0x3000,limit:0x77,type:6});
export const ramInstructions=Object.freeze([
 {ip:0x7000,bytes:[0xb8,0x34,0x12]}, {ip:faultEip,bytes:[0xa3,0,0x80]}, {ip:0x7006,bytes:[0x8b,0x0e,0,0x80]},
 {ip:handlerEip,bytes:[0x66,0xc7,6,0x20,0x20,3,0xb0,0,0]}, {ip:0x7029,bytes:[0x0f,0x20,0xda]},
 {ip:0x702c,bytes:[0x0f,0x22,0xda]}, {ip:0x702f,bytes:[0x83,0xc4,2]}, {ip:0x7032,bytes:[0xcf]},
].map(i=>Object.freeze({...i,bytes:Object.freeze(i.bytes)})));
const program=new Array(52).fill(0);for(const i of ramInstructions)for(const [k,b]of i.bytes.entries()){assert.equal(program[i.ip-0x7000+k],0);program[i.ip-0x7000+k]=b;}program[terminalEip-0x7000]=0xf4;
export const ramProgram=Object.freeze(program);
export const entries=Object.freeze({pde:{raw:0x1000,value:0x2003},gdt:{raw:0x2000,value:3},table:{raw:0x2008,value:0x2003},idt:{raw:0x200c,value:0x3003},code:{raw:0x201c,value:0xa003},data:{raw:0x2020,value:0},stack:{raw:0x2034,value:0xc003},rom:{raw:0x23c0,value:0xf0003}});
const instructions=[],effects=[];let ip=0x100;
const add=bytes=>{const at=ip;instructions.push(Object.freeze({ip,bytes:Object.freeze(bytes)}));ip+=bytes.length;return at;};
add([0xfa]);add([0xb8,0,0]);add([0x8e,0xd8]);
const store=(raw,bytes)=>{assert.equal(bytes.length,4);const owner=add([0x66,0xc7,6,raw&255,raw>>>8,...bytes]);effects.push(Object.freeze({cs:0xf000,ip:owner,raw,bytes:Object.freeze([...bytes])}));};
for(const [at,descriptor]of [[0x610,[255,255,0,0,0,0x93,0,0]],[0x618,[255,255,0,0,0,0x9b,0,0]]])for(let k=0;k<8;k+=4)store(at+k,descriptor.slice(k,k+4));
for(let k=0;k<ramProgram.length;k+=4)store(layout.code+k,ramProgram.slice(k,k+4));
for(const e of Object.values(entries))store(e.raw,[...dword(e.value)]);
for(let k=0;k<gate.bytes.length;k+=4)store(gate.raw+k,gate.bytes.slice(k,k+4));
store(layout.data,[0x78,0x56,0x9a,0xbc]);store(layout.aliasCode,[0xf4,0xcc,0xcc,0xcc]);store(layout.aliasData,[0xad,0xde,0xef,0xbe]);store(layout.aliasStack,[0xcc,0xcc,0xcc,0xcc]);
export const bootStores=Object.freeze(effects);
export const lgdtIp=add([0x2e,0x0f,1,0x16,0,4]),afterLgdt=ip;
export const lidtIp=add([0x2e,0x0f,1,0x1e,6,4]),afterLidt=ip;
add([0x66,0xb8,0,0x10,0,0]);export const cr3WriteIp=add([0x0f,0x22,0xd8]),afterCr3=ip;
add([0x66,0xb8,1,0,0,0]);export const peWriteIp=add([0x0f,0x22,0xc0]),afterPe=ip;
add([0xb8,0x10,0]);export const dsWriteIp=add([0x8e,0xd8]),afterDs=ip;
export const ssWriteIp=add([0x8e,0xd0]),afterSs=ip;
export const spWriteIp=add([0xbc,0,0xe0]),afterSp=ip;
add([0x66,0xb8,1,0,0,0x80]);export const pgWriteIp=add([0x0f,0x22,0xc0]),afterPg=ip;
export const farJumpIp=add([0xea,0,0x70,0x18,0]);assert.ok(ip<0x400);
export const romInstructions=Object.freeze(instructions);
// Genuine JS error frame commits ascending; future native push order is separate.
export const frameStores=Object.freeze([
 {cs:selector,ip:faultEip,raw:0xcff8,bytes:[2,0]}, {cs:selector,ip:faultEip,raw:0xcffa,bytes:[3,0x70]},
 {cs:selector,ip:faultEip,raw:0xcffc,bytes:[0x18,0]}, {cs:selector,ip:faultEip,raw:0xcffe,bytes:[2,0]},
].map(e=>Object.freeze({...e,bytes:Object.freeze(e.bytes)})));
export const repairStore=Object.freeze({cs:selector,ip:handlerEip,raw:0x2020,bytes:Object.freeze([...dword(0xb003)])});
export const retryStore=Object.freeze({cs:selector,ip:faultEip,raw:layout.data,bytes:Object.freeze([0x34,0x12])});
export const ordinaryStores=Object.freeze([...bootStores,...frameStores,repairStore,retryStore]);
export const adTransitions=Object.freeze([
 {kind:'directory-accessed',cs:0xf000,ip:farJumpIp,raw:0x1000,before:0x2003,after:0x2023},
 {kind:'ROM-fetch-accessed',cs:0xf000,ip:farJumpIp,raw:0x23c0,before:0xf0003,after:0xf0023},
 {kind:'descriptor-read-accessed',cs:0xf000,ip:farJumpIp,raw:0x2000,before:3,after:0x23},
 {kind:'code-fetch-accessed',cs:selector,ip:0x7000,raw:0x201c,before:0xa003,after:0xa023},
 {kind:'IDT-read-accessed',cs:selector,ip:faultEip,raw:0x200c,before:0x3003,after:0x3023},
 {kind:'stack-accessed',cs:selector,ip:faultEip,raw:0x2034,before:0xc003,after:0xc023},
 {kind:'stack-dirty',cs:selector,ip:faultEip,raw:0x2034,before:0xc023,after:0xc063},
 {kind:'table-operand-accessed',cs:selector,ip:handlerEip,raw:0x2008,before:0x2003,after:0x2023},
 {kind:'table-operand-dirty',cs:selector,ip:handlerEip,raw:0x2008,before:0x2023,after:0x2063},
 {kind:'data-accessed',cs:selector,ip:faultEip,raw:0x2020,before:0xb003,after:0xb023},
 {kind:'data-dirty',cs:selector,ip:faultEip,raw:0x2020,before:0xb023,after:0xb063},
].map(Object.freeze));
export function fixedPageFaultRom(...args){assert.equal(args.length,0);const b=new Uint8Array(65536).fill(0xf4);for(const i of romInstructions)b.set(i.bytes,i.ip);b.set([31,0,0,6,0,0],0x400);b.set([0x77,0,0,0x30,0,0],0x406);b.set([0xea,0,1,0,0xf0],0xfff0);return b;}
export const pageFaultProfile=Object.freeze({kind:'fixed-paged-same-cpl16-pf14-repair-retry-js-source-v1',maxAttempts:512,maxQuanta:512,romSha256:createHash('sha256').update(fixedPageFaultRom()).digest('hex'),status:'SOURCE_ONLY_NO_NATIVE_ADMISSION'});
export const namedCuts=Object.freeze([
 ['reset',0xf000,0xfff0],['after-LGDT',0xf000,afterLgdt],['after-LIDT',0xf000,afterLidt],['CR3-ready',0xf000,afterCr3],['PE-enabled',0xf000,afterPe],['DS-ready',0xf000,afterDs],['SS-loaded',0xf000,afterSs],['SP-ready',0xf000,afterSp],['PG-enabled',0xf000,afterPg],['entered-paged-code',selector,0x7000],
 ['before-faulting-store',selector,faultEip,0],['entered-PF-handler',selector,handlerEip,1],['PTE-repaired',selector,0x7029,1],['CR3-read',selector,0x702c,1],['CR3-reloaded',selector,0x702f,1],['error-discarded',selector,0x7032,1],['returned-for-retry',selector,faultEip,1],['retry-committed',selector,0x7006,1],['readback-before-HLT',selector,terminalEip,1],
].map(([name,cs,eip,faultSerial])=>Object.freeze({name,cs,eip,...(faultSerial===undefined?{}:{faultSerial})})));
export function expectedCr0(cs,eip){if(cs===selector)return 0xfffffff1;assert.equal(cs,0xf000);return eip!==0xfff0&&eip>=afterPg?0xfffffff1:eip!==0xfff0&&eip>=afterPe?0x7ffffff1:0x7ffffff0;}
export function expectedShadow(cs,eip){return cs===0xf000&&eip===afterSs?[1,1,0]:[0,0,0];}
export function physicalFetch(cs,base,eip){for(const v of [cs,base,eip])assert.ok(Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff);if(cs===selector){assert.equal(base,0);assert.ok(ramInstructions.some(i=>i.ip===eip));return layout.code+eip-0x7000;}assert.equal(cs,0xf000);if(eip===0xfff0){assert.equal(base,0xffff0000);return 0xfffffff0;}assert.equal(base,0xf0000);assert.ok(romInstructions.some(i=>i.ip===eip));return base+eip;}
export function validateStore(index,raw,bytes,cs,eip){const e=ordinaryStores[index];assert.ok(e&&Number.isSafeInteger(index)&&index>=0);assert.deepEqual([cs,eip,raw,[...bytes]],[e.cs,e.ip,e.raw,e.bytes]);return index+1;}
export function validateAdTransition(index,raw,before,after,cs,eip){const e=adTransitions[index];assert.ok(e&&Number.isSafeInteger(index)&&index>=0);assert.deepEqual([raw,before,after,cs,eip],[e.raw,e.before,e.after,e.cs,e.ip]);return e.kind;}
export function expectedPages(stores=[],updates=[]){const pages=Object.fromEntries(Object.keys(layout).map(k=>[k,new Uint8Array(4096)]));for(const e of [...stores,...updates.map(e=>({raw:e.raw,bytes:[...dword(e.after)]}))]){const k=Object.keys(layout).find(k=>layout[k]===(e.raw&~4095));assert.ok(k);pages[k].set(e.bytes,e.raw&4095);}return pages;}
export function validateLedger(s){assert.ok(Number.isSafeInteger(s.attemptOrdinal)&&s.attemptOrdinal>=0);assert.ok(Number.isSafeInteger(s.q)&&s.q>=0);assert.ok(s.faultSerial===0||s.faultSerial===1);assert.equal(s.attemptOrdinal,s.q+s.faultSerial);assert.equal(s.deliveries.length,s.faultSerial);if(s.faultSerial){const d=s.deliveries[0];assert.deepEqual([d.vector,d.returnEip,d.errorCode,d.fault,d.cr2,d.cs,d.eip,d.esp,d.eflags],[vector,faultEip,2,true,0x8000,selector,handlerEip,0xdff8,2]);assert.ok(Number.isSafeInteger(d.q)&&d.q>=0&&d.q<=s.q);assert.equal(d.attemptOrdinal,d.q+1);}return s.faultSerial;}
export function validateMilestone(name,s){const cut=namedCuts.find(c=>c.name===name);assert.ok(cut);const at=namedCuts.indexOf(cut),c=s.cpu;validateLedger(s);
 assert.deepEqual([c.cs,c.eip,c.cr0,c.cr4,c.eflags,c.halted],[cut.cs,cut.eip,expectedCr0(c.cs,c.eip),0,c.eip===0x7032&&c.cs===selector?0x86:2,false]);if(cut.faultSerial!==undefined)assert.equal(s.faultSerial,cut.faultSerial);assert.equal(c.cr2,s.faultSerial?0x8000:0);assert.deepEqual([c.interruptShadow,c.nmiShadow,c.debugShadow],expectedShadow(c.cs,c.eip));
 assert.equal(c.segmentCaches[1].base>>>0,c.cs===selector?0:c.eip===0xfff0?0xffff0000:0xf0000);
 if(at>=1)assert.deepEqual(c.gdtr,{base:0x600,limit:31});if(at>=2)assert.deepEqual(c.idtr,{base:gate.base,limit:gate.limit});if(at>=3)assert.equal(c.cr3,layout.directory);
 if(at>=5){assert.equal(c.ds,dataSelector);assert.deepEqual(c.segmentCaches[3],dataCache);}if(at>=6){assert.equal(c.ss,dataSelector);assert.deepEqual(c.segmentCaches[2],dataCache);}if(at>=9){assert.deepEqual(c.segmentCaches[1],codeCache);assert.equal(c.eax,c.eip===0x7000?0x80000001:0x80001234);}
 if(at>=7)assert.equal(c.esp,at>=11&&at<=14?0xdff8:at===15?0xdffa:initialSp);
 if(at>=13)assert.equal(c.edx,0x1000);if(at===18)assert.equal(c.ecx,0x1234);
 const count=at===0?0:at<11?bootStores.length:at===11?bootStores.length+4:at<17?bootStores.length+5:ordinaryStores.length;
 assert.deepEqual(s.stores.map(e=>[e.cs,e.ip,e.raw,e.bytes]),ordinaryStores.slice(0,count).map(e=>[e.cs,e.ip,e.raw,e.bytes]));
 const n=at<9?0:at===9?3:at===10?4:at===11?7:at<17?9:11;assert.deepEqual(s.updates.map(e=>[e.kind,e.cs,e.ip,e.raw,e.before,e.after]),adTransitions.slice(0,n).map(e=>[e.kind,e.cs,e.ip,e.raw,e.before,e.after]));assert.deepEqual(s.pages,expectedPages(s.stores,s.updates));
 if(at>=1){assert.deepEqual([...s.pages.idt.subarray(0x70,0x78)],gate.bytes);assert.deepEqual([...s.pages.aliasCode.subarray(0,4)],[0xf4,0xcc,0xcc,0xcc]);assert.deepEqual([...s.pages.aliasData.subarray(0,4)],[0xad,0xde,0xef,0xbe]);assert.deepEqual([...s.pages.aliasStack.subarray(0,4)],[0xcc,0xcc,0xcc,0xcc]);for(const raw of [0x1000,0x2000,0x200c,0x201c,0x23c0])assert.equal(wordAt(raw===0x1000?s.pages.directory:s.pages.table,raw&4095)&0x40,0);}
 if(at===10||at===11){assert.deepEqual([...s.pages.data.subarray(0,4)],[0x78,0x56,0x9a,0xbc]);assert.equal(wordAt(s.pages.table,0x20),0);}
 if(at>=11){assert.deepEqual([...s.pages.stack.subarray(0xff8)],[2,0,3,0x70,24,0,2,0]);assert.equal(wordAt(s.pages.table,0x34),0xc063);assert.equal(s.deliveries[0].returnEip,faultEip);assert.equal(s.deliveries[0].errorCode,2);}
 if(at>=12)assert.equal(wordAt(s.pages.table,0x20),at>=17?0xb063:0xb003);
 return name;
}
