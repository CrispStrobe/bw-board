/** Fixed reset-model oracle; ordinary JS instructions and actual board effects. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {javascriptCpu} from '../bochs-cpu3-native-owned-8042-interface/reference.mjs';
import {fixedRamBootstrapRom,coldBoardConfig,ramBootstrapProfile,fetchDomain,namedCuts} from './profile.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const resetSource=Object.freeze({path:'bochs/cpu/init.cc',sha256:'4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3',lines:'705–874',scope:'Bochs CPU3 reset model, not an Intel hardware correction'});
export function initializeRamReset(cpu){
 assert.equal(cpu.cycles,0);assert.equal(cpu.edx,0x300);assert.equal(cpu.cr0,0);assert.equal(cpu.cs,0xf000);assert.equal(cpu.eip,0xfff0);assert.equal(cpu.segmentCaches[1].base,0xffff0000);
 assert.deepEqual(cpu.gdtr,{base:0,limit:0});assert.deepEqual(cpu.idtr,{base:0,limit:0x3ff});
 cpu.edx=0;cpu.cr0=0x7ffffff0;cpu.gdtr={base:0,limit:0xffff};cpu.idtr={base:0,limit:0xffff};
 cpu.ldtr={selector:0,base:0,limit:0xffff,present:true,type:2};cpu.tr={selector:0,base:0,limit:0xffff,present:true,type:11};
 cpu._debugRegisters[6]=0xffff1ff0;cpu._debugRegisters[7]=0x400;
}
export function cutName(cpu){return namedCuts.find(c=>cpu.cs===c.cs&&cpu.eip===c.eip&&(c.ax===undefined||(cpu.eax&65535)===c.ax))?.name??null;}
export function createRamOracle(...args){
 assert.equal(args.length,0,'fixed no-argument oracle');let q=0,active=false,closed=false,settled=false,line=false;
 const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(coldBoardConfig)),{onPortAccess:()=>{throw Error('RAM fixture forbids all PIO');}}),rom=fixedRamBootstrapRom();
 m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();assert.equal(m.cycles,4);assert.equal(m._chipDebt,0);assert.equal(m._a20Enabled,true);initializeRamReset(m.cpu);
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('RAM fixture forbids '+method);};
 const paused=()=>assert.ok(!active&&!closed),live=()=>{paused();assert.ok(!settled);};
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),ramPage:Uint8Array.from(m.mem.subarray(0x7000,0x8000))});
 return Object.freeze({
  checkpoint(){paused();return snapshot();},
  stage(){live();if(m._chipDebt>=m._chipDeadline)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;return {asserted,changed};},
  step(){live();const c=m.cpu;assert.notEqual(cutName(c),'before-HLT','stop before HLT');assert.ok(q<ramBootstrapProfile.maxQuanta,'missing checkpoint at cap');
   assert.equal(c.cr0,0x7ffffff0);assert.ok(!(c.eflags&0x200)&&!c.halted&&!c.shutdown);const cs=c.cs,base=c.segmentCaches[1].base>>>0,eip=c.eip,start=c.pc>>>0;
   active=true;try{m.step();}finally{active=false;}q++;assert.equal(c.cycles,q);assert.equal(m.cycles,4+6*q);assert.equal(c.cr0,0x7ffffff0);assert.ok(!c.halted&&!c.shutdown&&!(c.eflags&0x200));assert.equal(m._a20Enabled,true);assert.ok(!m._cpuResetPending&&!m._fastA20Latch);
   assert.ok(fetchDomain({selector:cs,cs32:0,pe:0,interrupts:0,base,eip,length:c._instructionBytes,start,mappingPending:0,a20:1}),'actual executed instruction in owned domain');return {q};
  },
  settle(){live();assert.equal(cutName(m.cpu),'before-HLT');m._catchUpChips();settled=true;return {...snapshot(),ramSha256:sha(m.mem)};},
  close(){paused();closed=true;}
 });
}
