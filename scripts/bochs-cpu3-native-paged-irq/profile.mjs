/** Fixed source-only same-CPL16 hardware IRQ/IRET under strict386 paging. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export {coldBoardConfig,dword,wordAt,codeCache,dataCache} from '../bochs-cpu3-native-nonidentity-paging/profile.mjs';
import {dword,wordAt,codeCache,dataCache} from '../bochs-cpu3-native-nonidentity-paging/profile.mjs';
export const layout=Object.freeze({gdt:0,directory:0x1000,table:0x2000,idt:0x3000,aliasCode:0x7000,aliasData:0x9000,code:0xa000,data:0xb000,stack:0xc000,aliasStack:0xd000});
export const selector=0x18,dataSelector=0x10,vector=0,irqLine=0,interruptEip=0x7002,terminalEip=0x7008,handlerEip=0x700a,initialSp=0xe000;
export const gate=Object.freeze({raw:0x3000,bytes:Object.freeze([0x0a,0x70,0x18,0,0,0x86,0,0]),base:0x3000,limit:0x187,type:6});
export const ramInstructions=Object.freeze([
 {ip:0x7000,bytes:[0xfb]}, {ip:0x7001,bytes:[0x90]},
 {ip:0x7002,bytes:[0xb8,0x11,0x11]}, {ip:0x7005,bytes:[0xa3,0,0xd1]},
 {ip:0x700a,bytes:[0xb8,0x22,0x22]}, {ip:0x700d,bytes:[0xa3,2,0xd1]},
 {ip:0x7010,bytes:[0xcf]},
].map(i=>Object.freeze({...i,bytes:Object.freeze(i.bytes)})));
export const ramProgram=Object.freeze([0xfb,0x90,0xb8,0x11,0x11,0xa3,0,0xd1,0xf4,0xcc,0xb8,0x22,0x22,0xa3,2,0xd1,0xcf,0,0,0]);
export const entries=Object.freeze({pde:{raw:0x1000,value:0x2003},gdt:{raw:0x2000,value:3},idt:{raw:0x200c,value:0x3003},code:{raw:0x201c,value:0xa003},stack:{raw:0x2034,value:0xc003},rom:{raw:0x23c0,value:0xf0003}});
const instructions=[],effects=[];let ip=0x100;
const add=bytes=>{const at=ip;instructions.push(Object.freeze({ip,bytes:Object.freeze(bytes)}));ip+=bytes.length;return at;};
add([0xfa]);add([0xb8,0,0]);add([0x8e,0xd8]);
const store=(raw,bytes)=>{const owner=add([0x66,0xc7,6,raw&255,raw>>>8,...bytes]);effects.push(Object.freeze({cs:0xf000,ip:owner,raw,bytes:Object.freeze([...bytes])}));};
for(const [at,descriptor]of [[0x610,[255,255,0,0,0,0x93,0,0]],[0x618,[255,255,0,0,0,0x9b,0,0]]])for(let k=0;k<8;k+=4)store(at+k,descriptor.slice(k,k+4));
for(let k=0;k<ramProgram.length;k+=4)store(layout.code+k,ramProgram.slice(k,k+4));
for(const e of Object.values(entries))store(e.raw,[...dword(e.value)]);
for(let k=0;k<gate.bytes.length;k+=4)store(gate.raw+k,gate.bytes.slice(k,k+4));
store(layout.aliasCode,[0xf4,0xcc,0xcc,0xcc]);store(layout.aliasData,[0xad,0xde,0xef,0xbe]);store(layout.aliasStack,[0xcc,0xcc,0xcc,0xcc]);
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
// JS _prepareStackFrame takes [returnIP,CS,FLAGS], then writes ascending bytes.
// Native pushes FLAGS,CS,IP. Final bytes must agree; callback order is separate.
export const frameStores=Object.freeze([
 {cs:selector,ip:interruptEip,raw:0xcffa,bytes:[2,0x70]},
 {cs:selector,ip:interruptEip,raw:0xcffc,bytes:[0x18,0]},
 {cs:selector,ip:interruptEip,raw:0xcffe,bytes:[2,2]},
].map(e=>Object.freeze({...e,bytes:Object.freeze(e.bytes)})));
export const markerStores=Object.freeze([
 {cs:selector,ip:0x700d,raw:0xc102,bytes:[0x22,0x22]},
 {cs:selector,ip:0x7005,raw:0xc100,bytes:[0x11,0x11]},
].map(e=>Object.freeze({...e,bytes:Object.freeze(e.bytes)})));
export const adTransitions=Object.freeze([
 {kind:'directory-accessed',cs:0xf000,ip:farJumpIp,raw:0x1000,before:0x2003,after:0x2023},
 {kind:'ROM-fetch-accessed',cs:0xf000,ip:farJumpIp,raw:0x23c0,before:0xf0003,after:0xf0023},
 {kind:'descriptor-read-accessed',cs:0xf000,ip:farJumpIp,raw:0x2000,before:3,after:0x23},
 {kind:'code-fetch-accessed',cs:selector,ip:0x7000,raw:0x201c,before:0xa003,after:0xa023},
 {kind:'IDT-read-accessed',cs:selector,ip:interruptEip,raw:0x200c,before:0x3003,after:0x3023},
 {kind:'stack-accessed',cs:selector,ip:interruptEip,raw:0x2034,before:0xc003,after:0xc023},
 {kind:'stack-dirty',cs:selector,ip:interruptEip,raw:0x2034,before:0xc023,after:0xc063},
].map(Object.freeze));
export function fixedPagedIrqRom(...args){assert.equal(args.length,0);const b=new Uint8Array(65536).fill(0xf4);for(const i of romInstructions)b.set(i.bytes,i.ip);b.set([31,0,0,6,0,0],0x400);b.set([0x87,1,0,0x30,0,0],0x406);b.set([0xea,0,1,0,0xf0],0xfff0);return b;}
export const pagedIrqProfile=Object.freeze({kind:'fixed-paged-same-cpl16-irq0-iret-js-source-v1',maxQuanta:512,romSha256:createHash('sha256').update(fixedPagedIrqRom()).digest('hex'),status:'SOURCE_ONLY_NO_NATIVE_ADMISSION'});
export const namedCuts=Object.freeze([
 ['reset',0xf000,0xfff0],['after-LGDT',0xf000,afterLgdt],['after-LIDT',0xf000,afterLidt],['CR3-ready',0xf000,afterCr3],['PE-enabled',0xf000,afterPe],['DS-ready',0xf000,afterDs],['SS-loaded',0xf000,afterSs],['SP-ready',0xf000,afterSp],['PG-enabled',0xf000,afterPg],['entered-paged-code',selector,0x7000],['after-STI',selector,0x7001],['irq-eligible',selector,interruptEip],['entered-handler',selector,handlerEip],['after-handler-store',selector,0x7010],['returned-from-IRET',selector,interruptEip],['after-interrupted-store',selector,terminalEip],
].map(([name,cs,eip])=>Object.freeze({name,cs,eip})));
export function expectedCr0(cs,eip){if(cs===selector)return 0xfffffff1;assert.equal(cs,0xf000);return eip!==0xfff0&&eip>=afterPg?0xfffffff1:eip!==0xfff0&&eip>=afterPe?0x7ffffff1:0x7ffffff0;}
export function expectedShadow(cs,eip){if(cs===0xf000&&eip===afterSs)return [1,1,0];if(cs===selector&&eip===0x7001)return [1,0,0];return [0,0,0];}
export function physicalFetch(cs,base,eip){
 for(const v of [cs,base,eip])assert.ok(Number.isSafeInteger(v)&&v>=0&&v<=0xffffffff);
 if(cs===selector){assert.equal(base,0);assert.ok(ramInstructions.some(i=>i.ip===eip));return layout.code+eip-0x7000;}
 assert.equal(cs,0xf000);if(eip===0xfff0){assert.equal(base,0xffff0000);return 0xfffffff0;}
 assert.equal(base,0xf0000);assert.ok(romInstructions.some(i=>i.ip===eip));return base+eip;
}
export function expectedPages(stores=[],updates=[]){
 const pages=Object.fromEntries(Object.keys(layout).map(k=>[k,new Uint8Array(4096)]));
 for(const e of [...stores,...updates.map(e=>({raw:e.raw,bytes:[...dword(e.after)]}))]){
  const k=Object.keys(layout).find(k=>layout[k]===(e.raw&~4095));assert.ok(k);
  pages[k].set(e.bytes,e.raw&4095);
 }
 return pages;
}
export function validateFinalFrame(pages){
 assert.deepEqual([...pages.stack.subarray(0xffa,0x1000)],[2,0x70,0x18,0,2,2]);
 assert.deepEqual([...pages.stack.subarray(0x100,0x104)],[0x11,0x11,0x22,0x22]);
 assert.deepEqual([...pages.idt.subarray(0,8)],gate.bytes);
 assert.equal(wordAt(pages.table,13*4),0xc063);
}
