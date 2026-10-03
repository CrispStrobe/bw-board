/** Plain actual JS execution, separate from the frozen diagnostic oracle. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {coldBoardConfig,coldBoardProfile,fixedColdBios} from '../bochs-cpu3-native-cold-bios/board-profile.mjs';
import {authorizedTarget} from './admission.mjs';
const clone=value=>JSON.parse(JSON.stringify(value));
const fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss','es','fs','gs'];
const cpuSnapshot=c=>clone({...Object.fromEntries(fields.map(k=>[k,c[k]>>>0])),cr4:c.cr4,pc:c.pc>>>0,gdtr:c.gdtr,idtr:c.idtr,ldtr:c.ldtr,tr:c.tr,segmentCaches:c.segmentCaches,debugRegisters:[...c._debugRegisters],halted:c.halted,shutdown:c.shutdown,interruptShadow:c._interruptShadow,nmiShadow:c._nmiShadow,debugShadow:c._debugShadow,cycles:c.cycles});
export const resetSource=Object.freeze({path:'bochs/cpu/init.cc',sha256:'4bdf4a39a2a3ceecafdd070836a055b5dec8696acf59652e2150a12fdfa7a9f3',lines:'705–874',meaning:'Bochs CPU3 model reset profile; not Intel hardware correction'});
/** Pure reset-model guard, also usable without constructing a machine. */
export function validatePlainResetSnapshot(r){
 assert.equal(r.q,0);const c=r.cpu,b=r.board;assert.equal(c.cycles,0);assert.equal(c.edx,0);assert.equal(c.cr0,0x7ffffff0);assert.equal(c.cs,0xf000);assert.equal(c.eip,0xfff0);assert.equal(c.segmentCaches[1].base,0xffff0000);assert.deepEqual(c.gdtr,{base:0,limit:0xffff});assert.deepEqual(c.idtr,{base:0,limit:0xffff});assert.deepEqual(c.ldtr,{selector:0,base:0,limit:0xffff,present:true,type:2});assert.deepEqual(c.tr,{selector:0,base:0,limit:0xffff,present:true,type:11});assert.deepEqual(c.debugRegisters,[0,0,0,0,0,0,0xffff1ff0,0x400]);assert.equal(c.halted,false);assert.equal(c.shutdown,false);assert.equal(c.eflags&0x200,0);assert.equal(b.cycles,4);assert.equal(b.debt,0);assert.equal(b.a20Enabled,true);assert.deepEqual(b.a20.outputQueue,[]);assert.equal(b.a20.delayedResponse,null);return r;
}
export function createPlainJsBochsResetMachine(...args){
 assert.equal(args.length,0,'fixed no-arg factory; no caller config/hooks/ROM');
 let active=false,executed=false,closed=false,executionTiming=null;const ports=[];
 const m=new ExperimentalI80386ATMachine(clone(coldBoardConfig),{onPortAccess:e=>{
  // Complete real PIO collection is included in execution time. No per-PIO
  // snapshots, digest, diagnostic-domain assertions or growing tape copies.
  if(!active||ports.length>=coldBoardProfile.maxPortEvents)throw Error('plain worker PIO phase/cap');
  ports.push({ordinal:ports.length+1,q:m.cpu.cycles+1,cycles:m.cycles,width:8,...e});
 }});
 const rom=fixedColdBios();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();const c=m.cpu;
 assert.equal(c.cycles,0);assert.equal(c.edx,0x300);assert.equal(c.cr0,0);assert.equal(c.cs,0xf000);assert.equal(c.eip,0xfff0);assert.equal(c.segmentCaches[1].base,0xffff0000);assert.deepEqual(c.gdtr,{base:0,limit:0});assert.deepEqual(c.idtr,{base:0,limit:0x3ff});assert.equal(m.functionalInstructionCycles,6);assert.equal(m.cycles,4);assert.equal(m._chipDebt,0);assert.equal(m._a20Enabled,true);
 // One initialization before any instruction. No after-step correction.
 c.edx=0;c.cr0=0x7ffffff0;c.gdtr={base:0,limit:0xffff};c.idtr={base:0,limit:0xffff};
 c.ldtr={selector:0,base:0,limit:0xffff,present:true,type:2};c.tr={selector:0,base:0,limit:0xffff,present:true,type:11};assert.deepEqual([...c._debugRegisters],Array(8).fill(0));c._debugRegisters[6]=0xffff1ff0;c._debugRegisters[7]=0x400;
 assert.equal(m._a20Controller.inputBusyCycles,12);assert.equal(m._a20Controller.responseDelayCycles,32);assert.ok(!m._a20Controller.mouse&&!m._a20Controller.outputQueue.length&&!m._a20Controller.keyboardSchedule.length&&!m._a20Controller.delayedResponse);
 for(const method of ['interrupt','_deliverFault'])c[method]=()=>{throw Error('plain fixed slice forbids '+method);};
 const paused=()=>assert.ok(!active&&!closed,'paused live plain machine');
 return Object.freeze({
  reset(){paused();assert.equal(executed,false);return validatePlainResetSnapshot({q:0,cpu:cpuSnapshot(c),board:combinedBoardState(m)});},
  execute(token){
   paused();assert.equal(executed,false,'single execution');const targetQ=authorizedTarget(token);executed=true;
   active=true;const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();
   try{
    // Actual functional machine.step already advances one ordinary completion
    // or REP element and services real board clocks. No oracle work here.
    for(let q=0;q<targetQ;q++)m.step();
   }finally{executionTiming={wallNanoseconds:(process.hrtime.bigint()-startWall).toString(),cpuMicroseconds:process.cpuUsage(startCpu),scope:'Actual machine.step loop plus loop control, real board work, complete PIO recording and GC; excludes initialization/admission/final evidence'};active=false;}
   const timing=executionTiming;
   assert.equal(c.cycles,targetQ,'actual successful completion/REP-element Q');assert.equal(c.cs,0xf000);assert.equal(c.eip,0xe16,'stop before E16');assert.equal(c.cr0,0x7ffffff0,'raw reset-only CR0 profile');assert.equal(c.eflags&0x200,0);assert.equal(c.halted,false);assert.equal(c.shutdown,false);assert.equal(m.cycles,4+6*targetQ);assert.equal(m._a20Enabled,true);assert.ok(!m._cpuResetPending&&!m._fastA20Latch);
   const beforeSettle={q:targetQ,cpu:cpuSnapshot(c),board:combinedBoardState(m)};
   m._catchUpChips();const final={q:targetQ,cpu:cpuSnapshot(c),board:combinedBoardState(m),ramSha256:createHash('sha256').update(m.mem).digest('hex')};
   return {timing,beforeSettle,final,ports:clone(ports),coverage:'Complete ordered actual PIO and raw final CPU/full board/whole RAM hash; no per-instruction snapshots or parity claim'};
  },
  partial(){paused();return {executionTiming,cpu:cpuSnapshot(c),board:combinedBoardState(m),ports:clone(ports),ramSha256:createHash('sha256').update(m.mem).digest('hex')};},
  close(){paused();closed=true;}
 });
}
