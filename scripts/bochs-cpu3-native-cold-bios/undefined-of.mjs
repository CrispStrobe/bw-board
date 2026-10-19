/** Exact authenticated BIOS SHL ownership; raw CPU state is never modified.
 * Intel SDM Vol2B, SAL/SAR/SHL/SHR, Flags Affected: OF undefined for count>1.
 * https://cdrdv2-public.intel.com/782151/253667-sdm-vol-2b.pdf */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {biosSha256} from './rep-policy.mjs';
const masks=new WeakMap();
export function ownedUndefinedFlags(token){assert.ok(masks.has(token),'owned flag policy token');return masks.get(token);}
const path=[ [0x9da7,[0x66,0xc1,0xe0,0x10],0x9dab], [0x9dab,[0xb8,0x53,0xff],0x9dae], [0x9dae,[0xfc],0x9daf], [0x9daf,[0xf3,0x66,0xab],0x9db2], [0x9db2,[0xbb,0x20,0],0x9db5], [0x9db5,[0xb1,8],0x9db7], [0x9db7,[0xb8,0xe6,0xe9],0x9dba], [0x9dba,[0x89,7],0x9dbc], [0x9dbc,[0x83,0xc3,4],0x9dbf] ];
export function createUndefinedOfPolicy(rom){
 assert.equal(createHash('sha256').update(rom).digest('hex'),biosSha256);const bytes=Buffer.from(rom);let index=-1,started=false,elements=0,lastQ=null;const events=[];const token=Object.freeze({});masks.set(token,0);
 return Object.freeze({token,
  needsCpu(position){return index>=0||(position.cs===0xf000&&position.eip===0x9da7);},
  retire(before,after,frame){
   assert.equal(frame.chargedQuanta,1);assert.ok(Number.isSafeInteger(frame.q)&&frame.q>0);if(lastQ!==null)assert.equal(frame.q,lastQ+1);lastQ=frame.q;
   if(index<0){if(before.cs!==0xf000||before.eip!==0x9da7)return;assert.equal(started,false,'no undefined OF reentry');started=true;index=0;}
   assert.equal(before.cr0&1,0,'real-mode OF ownership');assert.equal(before.segmentCaches[1].base,0xf0000);assert.equal(before.segmentCaches[1].default32,false);assert.equal(before.segmentCaches[1].limit,0xffff);
   const [pc,opcode,next]=path[index];assert.equal(before.cs,0xf000);assert.equal(before.eip,pc,'exact executed OF owner path');assert.deepEqual([...bytes.subarray(pc,pc+opcode.length)],opcode,'authenticated exact opcode/count');assert.equal(after.cs,0xf000);
   if(index===3){
    assert.equal(before.es,0);assert.equal(before.eflags&0x400,0);assert.equal(before.eax>>>0,0xf000ff53);assert.equal(before.ecx&0xffff,120-elements);assert.equal(before.edi&0xffff,elements*4);assert.ok(frame.rep);assert.equal(frame.rep.siteEip,pc);
    assert.equal(frame.rep.address,elements*4);assert.equal(frame.rep.q,frame.q);
    elements++;assert.equal(after.ecx&0xffff,120-elements);assert.equal(after.edi&0xffff,elements*4);assert.equal(after.eip,elements===120?next:pc);assert.deepEqual([frame.rep.cx,frame.rep.di,frame.rep.eip],[after.ecx&0xffff,after.edi&0xffff,after.eip]);if(elements<120)return;
   }else assert.equal(after.eip,next,'exact retired successor');
   events.push({q:frame.q,executedEip:pc,postEip:after.eip,opcode,repElements:index===3?elements:undefined,undefinedMask:index===8?0:0x800});
   if(index===8){masks.set(token,0);index=-1;}else{masks.set(token,0x800);index++;}
  },
  receipt(){return {mask:ownedUndefinedFlags(token),started,repElements:elements,events:events.map(e=>({...e})),scope:'Only OF after exact SHL count16; strict restored after ADD retirement. Raw flags retained; unknown path/consumer refused.'};}
 });
}
