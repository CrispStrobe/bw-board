/** Private source-only fixed Bochs-model JS oracle; no native admission. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {javascriptCpu} from '../bochs-cpu3-native-owned-8042-interface/reference.mjs';
import {initializeRamReset} from '../bochs-cpu3-native-ram-bootstrap/reference.mjs';
import {protectedCpuClass} from '../bochs-cpu3-native-protected-ram/cpu-profile.mjs';
import {coldBoardConfig,fixedProtectedStackRom,protectedStackProfile,fetchDomain,namedCuts,validateMilestone,stores,validateStore,expectedPages,codePage,stackPage,codeSelector,cr0WriteIp,farJumpIp} from './profile.mjs';
export async function createProtectedStackOracle(...args){
 assert.equal(args.length,0,'no caller hooks/ROM/profile');let q=0,active=false,closed=false,settled=false,line=false,owner=null,byteOffset=0;const writes=[];
 const Cpu=await protectedCpuClass();const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(coldBoardConfig)),{onPortAccess:()=>{throw Error('fixed stack fixture forbids PIO');}});
 assert.equal(m.cpu.cycles,0);Object.setPrototypeOf(m.cpu,Cpu.prototype);const rom=fixedProtectedStackRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();initializeRamReset(m.cpu);
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('fixed stack fixture forbids '+method);};
 const originalWrite=m._write386.bind(m);m._write386=(raw,value)=>{assert.ok(active&&owner,'only owned instruction can write');const e=stores[writes.length];assert.ok(e&&owner.cs===e.cs&&owner.eip===e.ip,'exact store owner');assert.ok(byteOffset<e.bytes.length);assert.equal(raw,e.raw+byteOffset);assert.equal(value,e.bytes[byteOffset]);assert.equal(m._decode386(raw),raw);originalWrite(raw,value);byteOffset++;};
 const pages=()=>({gdt:Uint8Array.from(m.mem.subarray(0,4096)),code:Uint8Array.from(m.mem.subarray(codePage,codePage+4096)),stack:Uint8Array.from(m.mem.subarray(stackPage,stackPage+4096))});
 const checkPages=()=>assert.deepEqual(pages(),expectedPages(writes),'all three complete pages contain only exact owned effects');checkPages();
 const paused=()=>assert.ok(!active&&!closed),live=()=>{paused();assert.ok(!settled);};
 const name=()=>namedCuts.find(c=>c.cs===m.cpu.cs&&c.eip===m.cpu.eip)?.name??null;
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),pages:pages(),stores:writes.map(w=>({...w,bytes:[...w.bytes]}))});
 return Object.freeze({
  checkpoint(){paused();return snapshot();},
  stage(){live();if(m._chipDebt>=m._chipDeadline)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;return {asserted,changed};},
  step(){live();assert.notEqual(name(),'before-HLT','ordinary checkpoint before HLT');assert.ok(q<protectedStackProfile.maxQuanta,'bounded checkpoint');const c=m.cpu;
   const before={selector:c.cs,base:c.segmentCaches[1].base>>>0,eip:c.eip,pe:c.cr0&1,cs32:Number(c.segmentCaches[1].default32),interrupts:Number(!!(c.eflags&0x200)),paging:c.cr0>>>31,mappingPending:0,a20:Number(m._a20Enabled)};
   assert.equal(c.cr0,before.eip===farJumpIp||before.selector===codeSelector?0x7ffffff1:0x7ffffff0,'exact preinstruction CR0 phase');owner={cs:c.cs,eip:c.eip};byteOffset=0;active=true;try{m.step();}finally{active=false;owner=null;}
   const e=stores[writes.length];if(e&&before.selector===e.cs&&before.eip===e.ip){assert.equal(byteOffset,e.bytes.length);validateStore(e.raw,Uint8Array.from(e.bytes),writes.length,before.selector,before.eip);writes.push({...e,bytes:[...e.bytes],q:q+1});}else assert.equal(byteOffset,0,'no unowned effects');
   q++;checkPages();assert.equal(fetchDomain({...before,length:c._instructionBytes}),true);assert.equal(c.cycles,q);assert.equal(m.cycles,4+6*q);assert.ok(!c.halted&&!c.shutdown);assert.equal(c.eflags,2);assert.equal(m._a20Enabled,true);assert.ok(!m._cpuResetPending&&!m._fastA20Latch);
   assert.equal(c.cr0,before.eip===cr0WriteIp||before.eip===farJumpIp||before.selector===codeSelector?0x7ffffff1:0x7ffffff0,'exact instruction CR0 effect');
   assert.deepEqual([c._interruptShadow,c._nmiShadow,c._debugShadow],before.selector===codeSelector&&before.eip===0x7005?[1,1,0]:[0,0,0],'source-backed MOV SS shadow lifecycle');return {q};
  },
  milestone(){paused();const n=name();if(n)validateMilestone(n,snapshot());return n;},
  settle(){live();assert.equal(name(),'before-HLT');assert.equal(writes.length,stores.length);validateMilestone(name(),snapshot());m._catchUpChips();settled=true;return {...snapshot(),ramSha256:createHash('sha256').update(m.mem).digest('hex')};},
  close(){paused();closed=true;},
 });
}
