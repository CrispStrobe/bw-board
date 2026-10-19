/** Fixed fixture comparison policy. Raw bytes/states remain evidence. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
export const canonicalRamSha256='588f9bfd1292b8405d0e42552147fb2d8d082a8253b52771291ca0a603eaf18f';
export function ramResetEvidence(memory){
 assert.ok(memory instanceof Uint8Array&&memory.length===16*1024*1024,'fixed RAM size');
 const resetWitness=Array.from(memory.subarray(0x510,0x518));
 const ramCanonicalSha256=createHash('sha256').update(memory.subarray(0,0x510)).update(new Uint8Array(8)).update(memory.subarray(0x518)).digest('hex');
 return {resetWitness,ramCanonicalSha256};
}
export function validateResetWitness(evidence,reset,profile){
 assert.ok(profile==='native'||profile==='javascript');
 const expected=profile==='native'?{edx:0,cr0:0x7ffffff0}:{edx:0x300,cr0:0};
 assert.deepEqual(reset,expected,'documented raw reset profile');
 const bytes=evidence.resetWitness;assert.ok(Array.isArray(bytes)&&bytes.length===8&&bytes.every(v=>Number.isInteger(v)&&v>=0&&v<=255));
 const view=new DataView(Uint8Array.from(bytes).buffer);assert.equal(view.getUint32(0,true),reset.edx,'guest reset EDX witness');assert.equal(view.getUint32(4,true),reset.cr0,'guest reset CR0 witness');
 assert.equal(evidence.ramCanonicalSha256,canonicalRamSha256,'whole RAM except exact eight reset-witness bytes');
}

export function validateCpuProfile(native,javascript,reset=false){
 const fields={eax:0,ecx:1,edx:2,ebx:3,esp:4,eip:8,cr0:10,cr2:11,cr3:12,cs:13};
 for(const [name,index] of Object.entries(fields)){assert.ok(Number.isInteger(native[index])&&native[index]>=0&&native[index]<=0xffffffff);assert.ok(Number.isInteger(javascript[name])&&javascript[name]>=0&&javascript[name]<=0xffffffff);if(name!=='edx'&&name!=='cr0')assert.equal(native[index],javascript[name],name);}
 assert.equal(native[2],0,'native reset-profile EDX retained');assert.equal(javascript.edx,0x300,'JS reset-profile EDX retained');
 if(reset){assert.equal(native[10],0x7ffffff0);assert.equal(javascript.cr0,0);}
 else{assert.equal(native[10],0xfffffff1);assert.equal(javascript.cr0,0x80000011);assert.equal(native[10],(javascript.cr0|0x7ffffff0)>>>0,'Bochs CPU_LEVEL3 SetCR0 fixed bits');assert.equal((native[10]&0x7fffffe0)>>>0,0x7fffffe0);assert.equal((javascript.cr0&0x7fffffe0)>>>0,0);}
}
