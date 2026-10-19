/** Fixed source-owned real-mode RAM bootstrap. No guest or caller ROM. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {selfTestBoardConfig} from '../bochs-cpu3-native-owned-8042/profile.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
export const ramPage=0x7000;
export const ramProgram=Object.freeze([0xb8,1,0,0xea,0x40,0,0,0xf0]);
export const bootStores=Object.freeze([[0x7000,0xb8,1],[0x7002,0,0xea],[0x7004,0x40,0],[0x7006,0,0xf0]].map(Object.freeze));
export const patchStore=Object.freeze([0x7001,2,0]);
export const romInstructions=Object.freeze([[0,1],[1,3],[4,2],[6,6],[12,6],[18,6],[24,6],[30,5],[0x40,3],[0x43,2],[0x45,6],[0x4b,5]].map(Object.freeze));
export function fixedRamBootstrapRom(...args){
 assert.equal(args.length,0,'no caller ROM');const rom=new Uint8Array(65536).fill(0xf4);
 rom.set([0xfa,0xb8,0,0,0x8e,0xd8],0); // CLI; MOV AX,0; MOV DS,AX.
 for(const [i,[raw,lo,hi]] of bootStores.entries())rom.set([0xc7,6,raw&255,raw>>>8,lo,hi],6+6*i);
 rom.set([0xea,0,0x70,0,0],30); // 0000:7000.
 rom.set([0x3d,1,0,0x75,0x0b,0xc7,6,1,0x70,2,0,0xea,0,0x70,0,0],0x40);
 rom.set([0xea,0,0,0,0xf0],0xfff0);return rom;
}
export const ramRomSha256=hash(fixedRamBootstrapRom());
export const ramBootstrapProfile=Object.freeze({kind:'fixed-real-mode-one-page-RAM-bootstrap-SMC-v1',romSha256:ramRomSha256,abiVersion:4,ramPage,maxNativeTicks:512,maxQuanta:512,checkpointCs:0xf000,checkpointEip:0x50,status:'SOURCE_ONLY_NOT_BUILT_OR_EXECUTED'});
export const namedCuts=Object.freeze([{name:'reset',cs:0xf000,eip:0xfff0},{name:'AX1',cs:0,eip:0x7003,ax:1},{name:'patched-from-ROM',cs:0xf000,eip:0x4b},{name:'AX2',cs:0,eip:0x7003,ax:2},{name:'before-HLT',cs:0xf000,eip:0x50,ax:2}].map(Object.freeze));
const positions=romInstructions.map(([ip,len])=>`(eip==${ip} && length==${len})`).join(' || ');
export const fetchDomainExpression=`!cs32 && !pe && !interrupts && !mappingPending && a20==1 && start==base+eip && start<=4294967295 && ((selector==0xf000 && ((base==0xffff0000 && eip==65520 && length==5) || (base==0xf0000 && (${positions})))) || (selector==0 && base==0 && ((eip==28672 && length==3) || (eip==28675 && length==5))))`;
export function fetchDomain(v){
 const keys=['selector','cs32','pe','interrupts','base','eip','length','start','mappingPending','a20'];assert.deepEqual(Object.keys(v).sort(),keys.sort());
 for(const x of Object.values(v))assert.ok(Number.isSafeInteger(x)&&x>=0&&x<=0xffffffff);
 return !v.cs32&&!v.pe&&!v.interrupts&&!v.mappingPending&&v.a20===1&&v.start===v.base+v.eip&&((v.selector===0xf000&&(v.base===0xffff0000&&v.eip===0xfff0&&v.length===5||v.base===0xf0000&&romInstructions.some(([ip,len])=>v.eip===ip&&v.length===len)))||(v.selector===0&&v.base===0&&(v.eip===0x7000&&v.length===3||v.eip===0x7003&&v.length===5)));
}
export function expectedRamPage(generation){
 assert.ok(generation===4||generation===5,'only initialized or once-patched code generation');const bytes=new Uint8Array(4096);bytes.set(ramProgram);bytes[1]=generation===4?1:2;return bytes;
}
export function validateRamWrite(raw,bytes,bootCount,patchCount,admitted){
 assert.ok(Number.isSafeInteger(raw)&&raw>=0&&raw<=0xffffffff);assert.ok(bytes instanceof Uint8Array&&bytes.length===2,'exact two-byte write');assert.ok(Number.isInteger(bootCount)&&bootCount>=0&&bootCount<=4&&Number.isInteger(patchCount)&&patchCount>=0&&patchCount<=1&&typeof admitted==='boolean');
 const expected=bootCount<4?bootStores[bootCount]:patchStore;
 assert.ok(bootCount<4?!admitted&&patchCount===0:admitted&&patchCount===0,'boot before admission; one patch after admission');assert.deepEqual([raw,...bytes],expected,'exact owned address/operand/order');return bootCount<4?'boot':'patch';
}
// Names match the pinned provider derivative; none accepts caller options.
export const coldBoardConfig=selfTestBoardConfig;
export const coldBoardProfile=Object.freeze({...ramBootstrapProfile,maxPortEvents:0,maxDebugBytes:0,maxStatusReads:0});
export const fixedColdBios=fixedRamBootstrapRom;
export const coldOutAllowed=()=>false,coldInAllowed=()=>false;
