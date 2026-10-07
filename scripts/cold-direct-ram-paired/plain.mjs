/** Ordinary JS engine at the exact guest-qualified source, timed only over step(). */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const moduleAt=(root,path)=>import(pathToFileURL(resolve(root,path)).href);
export async function runPlain(sourceRoot,reference,target){
 const [{ExperimentalI80386ATMachine},{combinedBoardState},profile,{javascriptCpu},parity]=await Promise.all([
  moduleAt(sourceRoot,'src/experimental/i80386-at-machine.js'),
  moduleAt(sourceRoot,'scripts/bochs-cpu3-native-combined-paging-ram/host.mjs'),
  moduleAt(sourceRoot,'scripts/bochs-cpu3-native-cold-bios/board-profile.mjs'),
  moduleAt(sourceRoot,'scripts/bochs-cpu3-native-owned-8042-interface/reference.mjs'),
  moduleAt(sourceRoot,'scripts/bochs-cpu3-native-cold-bios/parity.mjs')]);
 assert.equal(target,316562);
 const ports=[];let active=false,q=0;
 const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(profile.coldBoardConfig)),{onPortAccess:e=>{
  assert.ok(active&&ports.length<profile.coldBoardProfile.maxPortEvents,'actual JS PIO bound');
  ports.push({ordinal:ports.length+1,q:q+1,cycles:m.cycles,width:8,...e});
 }});
 const rom=profile.fixedColdBios();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();
 const c=m.cpu;assert.equal(c.cycles,0);assert.equal(c.edx,0x300);assert.equal(c.cr0,0);
 assert.equal(c.cs,0xf000);assert.equal(c.eip,0xfff0);assert.equal(m.cycles,4);
 assert.equal(m.functionalInstructionCycles,6);assert.equal(m._chipDebt,0);assert.equal(m._a20Enabled,true);
 // Same fixed Bochs CPU3 reset-model normalization as the qualified plain JS arm.
 c.edx=0;c.cr0=0x7ffffff0;c.gdtr={base:0,limit:0xffff};c.idtr={base:0,limit:0xffff};
 c.ldtr={selector:0,base:0,limit:0xffff,present:true,type:2};
 c.tr={selector:0,base:0,limit:0xffff,present:true,type:11};
 assert.deepEqual([...c._debugRegisters],Array(8).fill(0));
 c._debugRegisters[6]=0xffff1ff0;c._debugRegisters[7]=0x400;
 assert.equal(m._a20Controller.inputBusyCycles,12);
 assert.equal(m._a20Controller.responseDelayCycles,32);
 assert.ok(!m._a20Controller.mouse&&!m._a20Controller.outputQueue.length&&
           !m._a20Controller.keyboardSchedule.length&&!m._a20Controller.delayedResponse);
 for(const method of ['interrupt','_deliverFault'])c[method]=()=>{throw Error('fixed plain JS slice forbids '+method);};
 const reset={cpu:javascriptCpu(c),board:combinedBoardState(m)};
 parity.compareCpu(reference.reset.native,reset.cpu);
 assert.deepEqual(reset.board,reference.reset.board.board,'ordinary JS reset board');
 const startupTiming={cpuMicroseconds:process.cpuUsage(),
  elapsedMilliseconds:Math.round(process.uptime()*1000),
  scope:'Child process start through ordinary JS machine load and reset verification'};
 const startCpu=process.cpuUsage(),startWall=process.hrtime.bigint();active=true;
 let executionTiming;
 try{for(;q<target;q++)m.step();}
 finally{executionTiming={cpuMicroseconds:process.cpuUsage(startCpu),
  wallNanoseconds:(process.hrtime.bigint()-startWall).toString(),
  scope:'Ordinary JS machine.step loop, real device clocks, complete PIO collection and GC; setup, settlement, checks and serialization excluded'};active=false;}
 assert.equal(c.cycles,target);assert.equal(c.cs,0xf000);assert.equal(c.eip,0xe16);
 assert.equal(c.cr0,0x7ffffff0);assert.equal(c.eflags&0x200,0);assert.equal(c.halted,false);
 assert.equal(c.shutdown,false);assert.equal(m.cycles,4+6*target);assert.equal(m._a20Enabled,true);
 assert.ok(!m._cpuResetPending&&!m._fastA20Latch);
 const beforeSettle={cpu:javascriptCpu(c),board:combinedBoardState(m)};
 parity.compareCpu(reference.final,beforeSettle.cpu);
 m._catchUpChips();
 const final={cpu:javascriptCpu(c),board:combinedBoardState(m),
  ramSha256:createHash('sha256').update(m.mem).digest('hex')};
 assert.deepEqual(final.cpu,beforeSettle.cpu,'settlement preserves CPU');
 assert.deepEqual(final.board,reference.board.board,'ordinary JS full settled board');
 assert.equal(final.ramSha256,reference.ramSha256,'ordinary JS whole RAM');
 parity.comparePorts(reference.ports,ports);
 return {schema:'bw.cold-direct-ram.paired-plain-child.v1',mode:'plain-js',target,
  reset,beforeSettle,final,ports,startupTiming,executionTiming,semantic:'PASS',
  terminationScope:'process-only; no model close API'};
}
