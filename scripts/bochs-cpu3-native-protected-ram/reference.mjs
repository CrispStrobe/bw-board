/** Fixed source-owned Bochs-reset/MOVCR0 model oracle. No native admission or capture claim. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {javascriptCpu} from '../bochs-cpu3-native-owned-8042-interface/reference.mjs';
import {initializeRamReset} from '../bochs-cpu3-native-ram-bootstrap/reference.mjs';
import {protectedCpuClass} from './cpu-profile.mjs';
import {coldBoardConfig,fixedProtectedRamRom,protectedRamProfile,fetchDomain,namedCuts,validateMilestone,stores,validateStore} from './profile.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function createProtectedRamOracle(...args){
 assert.equal(args.length,0,'no caller hooks/ROM/profile');let q=0,active=false,closed=false,settled=false,line=false,owner=null,byteOffset=0;const writes=[];
 const Cpu=await protectedCpuClass();const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(coldBoardConfig)),{onPortAccess:()=>{throw Error('protected RAM fixture forbids PIO');}});
 // The ordinary constructor has executed no instructions. Install the attested
 // prototype before reset/initialization; no live instruction state is migrated.
 assert.equal(m.cpu.cycles,0);Object.setPrototypeOf(m.cpu,Cpu.prototype);const rom=fixedProtectedRamRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();initializeRamReset(m.cpu);
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('protected RAM forbids '+method);};
 const originalWrite=m._write386.bind(m);m._write386=(raw,value)=>{
  assert.ok(active&&owner,'write only in owned instruction');const e=stores[writes.length];assert.ok(e&&owner.cs===0xf000&&owner.eip===e.ip,'exact store owner');
  assert.equal(raw,e.raw+byteOffset,'ordered byte address');assert.equal(value,e.bytes[byteOffset],'exact byte operand');assert.ok(byteOffset<e.bytes.length);assert.equal(m._decode386(raw),raw);
  originalWrite(raw,value);byteOffset++;
 };
 const checkPages=()=>{const gdt=new Uint8Array(4096),ram=new Uint8Array(4096);for(const w of writes)(w.raw<4096?gdt:ram).set(w.bytes,w.raw&4095);
  assert.deepEqual(m.mem.subarray(0,4096),gdt,'no unexplained GDT-page effect');assert.deepEqual(m.mem.subarray(0x7000,0x8000),ram,'no unexplained code-page effect');};checkPages();
 const paused=()=>assert.ok(!active&&!closed),live=()=>{paused();assert.ok(!settled);};
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),ramPage:Uint8Array.from(m.mem.subarray(0x7000,0x8000)),gdtPage:Uint8Array.from(m.mem.subarray(0,4096)),stores:writes.map(w=>({...w,bytes:[...w.bytes]}))});
 const name=()=>namedCuts.find(c=>c.cs===m.cpu.cs&&c.eip===m.cpu.eip)?.name??null;
 return Object.freeze({
  checkpoint(){paused();return snapshot();},
  stage(){live();if(m._chipDebt>=m._chipDeadline)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;return {asserted,changed};},
  step(){live();assert.notEqual(name(),'after-RAM-MOV','ordinary stop before HLT');assert.ok(q<protectedRamProfile.maxQuanta,'checkpoint cap');
   const c=m.cpu,before={selector:c.cs,base:c.segmentCaches[1].base>>>0,eip:c.eip,pe:c.cr0&1,cs32:Number(c.segmentCaches[1].default32),interrupts:Number(!!(c.eflags&0x200)),paging:c.cr0>>>31,mappingPending:0,a20:Number(m._a20Enabled)};
   assert.equal(c.cr0,before.eip===0x133||before.selector===0x18?0x7ffffff1:0x7ffffff0,'instruction-owned CR0 phase');
   owner={cs:before.selector,eip:before.eip};byteOffset=0;active=true;try{m.step();}finally{active=false;owner=null;}
   const e=stores[writes.length];if(e&&before.selector===0xf000&&before.eip===e.ip){assert.equal(byteOffset,e.bytes.length,'complete owned store');validateStore(e.raw,Uint8Array.from(e.bytes),writes.length,before.selector,before.eip);writes.push({raw:e.raw,bytes:[...e.bytes],ip:e.ip,q:q+1});}else assert.equal(byteOffset,0,'no unowned store');
   q++;checkPages();assert.ok(fetchDomain({...before,length:c._instructionBytes}),'exact actual instruction domain');
   assert.equal(c.cycles,q);assert.equal(m.cycles,4+6*q);assert.ok(!c.halted&&!c.shutdown&&!(c.eflags&0x200)&&!(c.cr0&0x80000000));assert.equal(m._a20Enabled,true);assert.ok(!m._cpuResetPending&&!m._fastA20Latch);
   assert.equal(c.cr0,before.eip===0x130||before.eip===0x133||before.selector===0x18?0x7ffffff1:0x7ffffff0,'exact CR0 effect');return {q};
  },
  milestone(){paused();const n=name();if(n)validateMilestone(n,snapshot());return n;},
  settle(){live();assert.equal(name(),'after-RAM-MOV');validateMilestone(name(),snapshot());m._catchUpChips();settled=true;return {...snapshot(),ramSha256:sha(m.mem)};},
  close(){paused();closed=true;},
 });
}
