/** Fixed LGDT/PE/far-jump/code16 RAM milestone. Source proposal, never a caller ROM. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {coldBoardConfig} from '../bochs-cpu3-native-ram-bootstrap/profile.mjs';
export {coldBoardConfig};
export const ramPage=0x7000,gdtBase=0x600,gdtLimit=0x1f,codeSelector=0x18;
export const ramProgram=Object.freeze([0xb8,0x34,0x12,0xf4]);
// Reuses the combined-paging-RAM fixture's selector18/base0/limitFFFF code16 layout.
// Accessed is already set, so this scope needs no descriptor accessed-bit write.
export const descriptor=Object.freeze([0xff,0xff,0,0,0,0x9b,0,0]);
export const stores=Object.freeze([
 {ip:0x106,raw:0x618,bytes:Object.freeze([0xff,0xff,0,0])},
 {ip:0x10f,raw:0x61c,bytes:Object.freeze([0,0x9b,0,0])},
 {ip:0x118,raw:0x7000,bytes:Object.freeze([0xb8,0x34])},
 {ip:0x11e,raw:0x7002,bytes:Object.freeze([0x12,0xf4])},
].map(Object.freeze));
export const instructions=Object.freeze([
 {ip:0x100,bytes:[0xfa]}, {ip:0x101,bytes:[0xb8,0,0]}, {ip:0x104,bytes:[0x8e,0xd8]},
 {ip:0x106,bytes:[0x66,0xc7,6,0x18,6,0xff,0xff,0,0]},
 {ip:0x10f,bytes:[0x66,0xc7,6,0x1c,6,0,0x9b,0,0]},
 {ip:0x118,bytes:[0xc7,6,0,0x70,0xb8,0x34]},
 {ip:0x11e,bytes:[0xc7,6,2,0x70,0x12,0xf4]},
 {ip:0x124,bytes:[0x2e,0x0f,1,0x16,0x80,1]}, // LGDT CS:[0180].
 {ip:0x12a,bytes:[0x66,0xb8,1,0,0,0]}, // MOV EAX,1.
 {ip:0x130,bytes:[0x0f,0x22,0xc0]}, // MOV CR0,EAX.
 {ip:0x133,bytes:[0xea,0,0x70,0x18,0]}, // JMP18:7000 after PE.
].map(v=>Object.freeze({...v,bytes:Object.freeze(v.bytes)})));
export function fixedProtectedRamRom(...args){
 assert.equal(args.length,0,'no caller ROM');const b=new Uint8Array(65536).fill(0xf4);
 for(const i of instructions)b.set(i.bytes,i.ip);
 b.set([gdtLimit,0,0,6,0,0],0x180);b.set([0xea,0,1,0,0xf0],0xfff0);return b;
}
export const protectedRamProfile=Object.freeze({kind:'fixed-protected-code16-RAM-entry-v1',romSha256:createHash('sha256').update(fixedProtectedRamRom()).digest('hex'),maxNativeTicks:512,maxQuanta:512,checkpointCs:codeSelector,checkpointEip:0x7003,ramPage,gdtBase,gdtLimit,status:'SOURCE_ONLY_NO_NATIVE_PROFILE_BUILD_OR_EXECUTION'});
export const namedCuts=Object.freeze([
 {name:'reset',cs:0xf000,eip:0xfff0,cr0:0x7ffffff0},
 {name:'after-LGDT',cs:0xf000,eip:0x12a,cr0:0x7ffffff0},
 {name:'PE-enabled',cs:0xf000,eip:0x133,cr0:0x7ffffff1},
 {name:'entered-protected-RAM',cs:codeSelector,eip:ramPage,cr0:0x7ffffff1},
 {name:'after-RAM-MOV',cs:codeSelector,eip:0x7003,cr0:0x7ffffff1,ax:0x1234},
].map(Object.freeze));
export function expectedRamPage(){const p=new Uint8Array(4096);p.set(ramProgram);return p;}
export function expectedGdtPage(){const p=new Uint8Array(4096);p.set(descriptor,0x618);return p;}
export function validateStore(raw,bytes,index,cs,eip){
 assert.ok(Number.isSafeInteger(index)&&index>=0&&index<stores.length,'bounded exact write sequence');
 assert.ok(bytes instanceof Uint8Array);const e=stores[index];assert.equal(cs,0xf000);assert.equal(eip,e.ip);assert.equal(raw,e.raw);assert.deepEqual(Array.from(bytes),e.bytes);return index+1;
}
export function fetchDomain(v){
 assert.deepEqual(Object.keys(v).sort(),['selector','base','eip','length','pe','cs32','interrupts','paging','mappingPending','a20'].sort());
 for(const n of Object.values(v))assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff);
 if(v.cs32||v.interrupts||v.paging||v.mappingPending||v.a20!==1)return false;
 if(v.selector===codeSelector)return v.pe===1&&v.base===0&&v.eip===ramPage&&v.length===3;
 if(v.selector!==0xf000)return false;
 if(v.base===0xffff0000)return v.pe===0&&v.eip===0xfff0&&v.length===5;
 if(v.base!==0xf0000)return false;
 return instructions.some(i=>i.ip===v.eip&&i.bytes.length===v.length&&v.pe===(i.ip===0x133?1:0));
}
export function validateMilestone(name,snapshot){
 const e=namedCuts.find(c=>c.name===name);assert.ok(e,'owned cut');const c=snapshot.cpu;
 assert.equal(c.cs,e.cs);assert.equal(c.eip,e.eip);assert.equal(c.cr0,e.cr0);assert.equal(c.eflags&0x200,0);assert.equal(c.cr0&0x80000000,0);assert.equal(c.halted,false);
 if(name!=='reset'){assert.deepEqual(c.gdtr,{base:gdtBase,limit:gdtLimit});assert.deepEqual(snapshot.gdtPage,expectedGdtPage(),'entire source-owned GDT page');}
 if(e.ax!==undefined)assert.equal(c.eax&0xffff,e.ax);
 if(c.cs===codeSelector){
  assert.deepEqual(c.segmentCaches[1],{base:0,limit:0xffff,default32:false,code:true,readable:true,writable:false,access:0x9b,address:0x618,dpl:0,conforming:false,present:true},'all represented protected code-cache fields');
  // Raw GDT byte proof also establishes accessed/type/S/DPL and G/DB/AVL.
  // JS exposes no separate hidden native valid/type/granularity cache words.
  assert.equal(c.segmentCaches[1].access&0xf,0xb);assert.equal(c.segmentCaches[1].access&0x10,0x10);assert.equal(snapshot.gdtPage[0x61e],0);assert.deepEqual(snapshot.ramPage,expectedRamPage());
 }
 return name;
}
