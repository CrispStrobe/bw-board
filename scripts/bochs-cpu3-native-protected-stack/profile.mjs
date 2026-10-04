/** Fixed same-ring code16 DS/SS, stack and near CALL/RET source proposal. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export {coldBoardConfig} from '../bochs-cpu3-native-protected-ram/profile.mjs';
export const codeSelector=0x18,dataSelector=0x10,gdtBase=0x600,gdtLimit=0x1f,codePage=0x7000,stackPage=0x8000;
export const codeDescriptor=Object.freeze([0xff,0xff,0,0,0,0x9b,0,0]);
export const dataDescriptor=Object.freeze([0xff,0xff,0,0,0,0x93,0,0]);
const instruction=(ip,bytes)=>Object.freeze({ip,bytes:Object.freeze(bytes)});
export const ramInstructions=Object.freeze([
 instruction(0x7000,[0xb8,0x10,0]), // MOV AX,10.
 instruction(0x7003,[0x8e,0xd8]), // MOV DS,AX.
 instruction(0x7005,[0x8e,0xd0]), // MOV SS,AX.
 instruction(0x7007,[0xbc,0,0x90]), // MOV SP,9000 (one shadowed instruction).
 instruction(0x700a,[0xb8,0x34,0x12]),
 instruction(0x700d,[0x50]), // PUSH AX: [8ffe]=1234.
 instruction(0x700e,[0x5b]), // POP BX.
 instruction(0x700f,[0xe8,4,0]), // CALL7016: [8ffe]=7012.
 instruction(0x7012,[0xb9,0x78,0x56]),
 instruction(0x7016,[0xb8,0xcd,0xab]),
 instruction(0x7019,[0xc3]), // RET to7012.
]);
export const terminalEip=0x7015;
export const ramProgram=Object.freeze((()=>{const b=new Uint8Array(26);for(const i of ramInstructions)b.set(i.bytes,i.ip-codePage);b[terminalEip-codePage]=0xf4;return [...b];})());
const lo=v=>v&255,hi=v=>(v>>>8)&255;
const boot=[];let ip=0x100;const add=bytes=>{const i=instruction(ip,bytes);boot.push(i);ip+=bytes.length;return i.ip;};
add([0xfa]);add([0xb8,0,0]);add([0x8e,0xd8]);
const effects=[];
const store=(raw,bytes)=>{const owner=add(bytes.length===4?[0x66,0xc7,6,lo(raw),hi(raw),...bytes]:[0xc7,6,lo(raw),hi(raw),...bytes]);effects.push(Object.freeze({cs:0xf000,ip:owner,raw,bytes:Object.freeze(bytes)}));};
for(const [base,descriptor]of [[0x610,dataDescriptor],[0x618,codeDescriptor]])for(let k=0;k<8;k+=4)store(base+k,descriptor.slice(k,k+4));
for(let k=0;k<ramProgram.length;k+=4)store(codePage+k,ramProgram.slice(k,k+4));
export const bootStores=Object.freeze(effects);
const lgdtIp=add([0x2e,0x0f,1,0x16,0x80,1]);
export const afterLgdt=ip;add([0x66,0xb8,1,0,0,0]);
export const cr0WriteIp=add([0x0f,0x22,0xc0]);
export const farJumpIp=add([0xea,0,0x70,0x18,0]);
export const romInstructions=Object.freeze(boot);
assert.ok(ip<=0x180,'ROM program cannot overlap its LGDT pointer');
export const stackStores=Object.freeze([
 Object.freeze({cs:codeSelector,ip:0x700d,raw:0x8ffe,bytes:Object.freeze([0x34,0x12])}),
 Object.freeze({cs:codeSelector,ip:0x700f,raw:0x8ffe,bytes:Object.freeze([0x12,0x70])}),
]);
export const stores=Object.freeze([...bootStores,...stackStores]);
export function fixedProtectedStackRom(...args){assert.equal(args.length,0,'no caller ROM');const b=new Uint8Array(65536).fill(0xf4);for(const i of romInstructions)b.set(i.bytes,i.ip);b.set([gdtLimit,0,0,6,0,0],0x180);b.set([0xea,0,1,0,0xf0],0xfff0);return b;}
export const protectedStackProfile=Object.freeze({kind:'fixed-protected-code16-data-stack-call-v1',romSha256:createHash('sha256').update(fixedProtectedStackRom()).digest('hex'),maxQuanta:512,maxNativeTicks:512,checkpointCs:codeSelector,checkpointEip:terminalEip,status:'SOURCE_ONLY_NO_NATIVE_BUILD_OR_ADMISSION'});
export function expectedPages(effects=stores){const pages={gdt:new Uint8Array(4096),code:new Uint8Array(4096),stack:new Uint8Array(4096)};for(const s of effects){const key=s.raw<4096?'gdt':s.raw<stackPage?'code':'stack';pages[key].set(s.bytes,s.raw&4095);}return pages;}
export function validateStore(raw,bytes,index,cs,eip){assert.ok(Number.isSafeInteger(index)&&index>=0&&index<stores.length);assert.ok(bytes instanceof Uint8Array);const s=stores[index];assert.equal(cs,s.cs);assert.equal(eip,s.ip);assert.equal(raw,s.raw);assert.deepEqual([...bytes],s.bytes);return index+1;}
export function fetchDomain(v){assert.deepEqual(Object.keys(v).sort(),['selector','base','eip','length','pe','cs32','interrupts','paging','mappingPending','a20'].sort());for(const n of Object.values(v))assert.ok(Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff);if(v.cs32||v.interrupts||v.paging||v.mappingPending||v.a20!==1)return false;if(v.selector===codeSelector)return v.pe===1&&v.base===0&&ramInstructions.some(i=>i.ip===v.eip&&i.bytes.length===v.length);if(v.selector!==0xf000)return false;if(v.base===0xffff0000)return v.pe===0&&v.eip===0xfff0&&v.length===5;return v.base===0xf0000&&romInstructions.some(i=>i.ip===v.eip&&i.bytes.length===v.length&&v.pe===(i.ip===farJumpIp?1:0));}
export const namedCuts=Object.freeze([
 {name:'reset',cs:0xf000,eip:0xfff0},{name:'after-LGDT',cs:0xf000,eip:afterLgdt},{name:'PE-enabled',cs:0xf000,eip:farJumpIp},
 {name:'entered-protected-RAM',cs:codeSelector,eip:0x7000},{name:'after-DS-load',cs:codeSelector,eip:0x7005},
 {name:'after-SS-load',cs:codeSelector,eip:0x7007},{name:'stack-ready',cs:codeSelector,eip:0x700a},
 {name:'after-PUSH',cs:codeSelector,eip:0x700e},{name:'after-POP',cs:codeSelector,eip:0x700f},
 {name:'entered-CALL',cs:codeSelector,eip:0x7016},{name:'callee-MOV',cs:codeSelector,eip:0x7019},
 {name:'returned-CALL',cs:codeSelector,eip:0x7012},{name:'before-HLT',cs:codeSelector,eip:terminalEip},
].map(Object.freeze));
export function expectedCache(selector){assert.ok(selector===codeSelector||selector===dataSelector);return selector===codeSelector?{base:0,limit:0xffff,default32:false,code:true,readable:true,writable:false,access:0x9b,address:0x618,dpl:0,conforming:false,present:true}:{base:0,limit:0xffff,default32:false,code:false,expandDown:false,readable:true,writable:true,access:0x93,address:0x610,present:true};}
export function validateMilestone(name,s){const e=namedCuts.find(c=>c.name===name);assert.ok(e,'owned cut');const c=s.cpu;assert.equal(c.cs,e.cs);assert.equal(c.eip,e.eip);assert.equal(c.cr0,name==='reset'||name==='after-LGDT'?0x7ffffff0:0x7ffffff1);assert.equal(c.eflags,2);assert.equal(c.halted,false);
 const shadow=name==='after-SS-load'?[1,1,0]:[0,0,0];assert.deepEqual([c.interruptShadow,c.nmiShadow,c.debugShadow],shadow,'exact MOV-SS shadow phase');
 if(name!=='reset'){assert.deepEqual(c.gdtr,{base:gdtBase,limit:gdtLimit});const p=expectedPages(bootStores);assert.deepEqual(s.pages.gdt,p.gdt);assert.deepEqual(s.pages.code,p.code);}
 if(c.cs===codeSelector)assert.deepEqual(c.segmentCaches[1],expectedCache(codeSelector));
 const dsLoaded=c.cs===codeSelector&&c.eip!==0x7000; if(dsLoaded){assert.equal(c.ds,dataSelector);assert.deepEqual(c.segmentCaches[3],expectedCache(dataSelector));}
 const ssLoaded=dsLoaded&&c.eip!==0x7005;if(ssLoaded){assert.equal(c.ss,dataSelector);assert.deepEqual(c.segmentCaches[2],expectedCache(dataSelector));}
 const stackCount=['after-PUSH','after-POP'].includes(name)?1:['entered-CALL','callee-MOV','returned-CALL','before-HLT'].includes(name)?2:0;assert.deepEqual(s.pages.stack,expectedPages([...bootStores,...stackStores.slice(0,stackCount)]).stack);
 if(['stack-ready','after-PUSH','after-POP','entered-CALL','callee-MOV','returned-CALL','before-HLT'].includes(name))assert.equal(c.esp&0xffff,['after-PUSH','entered-CALL','callee-MOV'].includes(name)?0x8ffe:0x9000);
 if(['after-POP','entered-CALL','callee-MOV','returned-CALL','before-HLT'].includes(name))assert.equal(c.ebx&0xffff,0x1234);
 if(['callee-MOV','returned-CALL','before-HLT'].includes(name))assert.equal(c.eax&0xffff,0xabcd);if(name==='before-HLT')assert.equal(c.ecx&0xffff,0x5678);return name;}
