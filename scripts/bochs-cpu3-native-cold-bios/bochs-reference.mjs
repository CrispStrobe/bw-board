/** Separate reset-model oracle. The ordinary 60a9 reference is unchanged.
 * All subsequent execution/device/RAM effects are the actual JS implementation.
 * No after-step register or RAM normalization is permitted. */
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {ExperimentalI80386ATMachine} from "../../src/experimental/i80386-at-machine.js";
import {combinedBoardState} from "../bochs-cpu3-native-combined-paging-ram/host.mjs";
import {javascriptCpu} from "../bochs-cpu3-native-owned-8042-interface/reference.mjs";
import {coldBoardConfig,coldBoardProfile,fixedColdBios,coldOutAllowed,coldInAllowed} from "./board-profile.mjs";
import {repSites,admitRepElement} from "./rep-policy.mjs";
import {coldCheckpointReached,validateColdProgress} from "./reference.mjs";
const clone=v=>JSON.parse(JSON.stringify(v)),sha=b=>createHash("sha256").update(b).digest("hex");
const configurationText=JSON.stringify(coldBoardConfig);
// Pinned CPU3 init.cc reset defaults; these are Bochs model values, not Intel
// hardware corrections. CS semantic code/readable flags keep their JS meaning.
export const bochsResetProfile=Object.freeze({schema:"bw.js-bochs-cpu3-cold-reset.v1",edx:0,cr0:0x7ffffff0,tableLimit:0xffff,systemLimit:0xffff,dr6:0xffff1ff0,dr7:0x400});
function initializeFixedBochsReset(cpu){
 assert.equal(cpu.cycles,0);assert.equal(cpu.cs,0xf000);assert.equal(cpu.eip,0xfff0);assert.equal(cpu.segmentCaches[1].base,0xffff0000);
 assert.equal(cpu.edx,0x300);assert.equal(cpu.cr0,0);assert.deepEqual(cpu.gdtr,{base:0,limit:0});assert.deepEqual(cpu.idtr,{base:0,limit:0x3ff});
 cpu.edx=bochsResetProfile.edx;cpu.cr0=bochsResetProfile.cr0;
 cpu.gdtr={base:0,limit:bochsResetProfile.tableLimit};cpu.idtr={base:0,limit:bochsResetProfile.tableLimit};
 cpu.ldtr={selector:0,base:0,limit:bochsResetProfile.systemLimit,present:true,type:2};cpu.tr={selector:0,base:0,limit:bochsResetProfile.systemLimit,present:true,type:11};
 cpu._debugRegisters[6]=bochsResetProfile.dr6;cpu._debugRegisters[7]=bochsResetProfile.dr7;
}
export function createBochsResetColdOracle(...args){
 assert.equal(args.length,0,'fixed oracle accepts no caller config/hooks');
 const rom=fixedColdBios(),ports=[],pages=new Map();let q=0,active=false,settled=false,closed=false,lineAsserted=false;
 const m=new ExperimentalI80386ATMachine(JSON.parse(configurationText),{onPortAccess:e=>{
  assert.ok(active&&!closed,'actual PIO inside JS step');assert.ok(ports.length<coldBoardProfile.maxPortEvents,'port cap');assert.ok(e.dir==='in'||e.dir==='out');assert.equal(e.width??8,8,'actual byte PIO');
  assert.ok(e.dir==='out'?coldOutAllowed(e.port,1,e.value):coldInAllowed(e.port,1),'cold port domain');assert.ok(Number.isInteger(e.value)&&e.value>=0&&e.value<=255);
  ports.push({ordinal:ports.length+1,q:q+1,cycles:m.cycles,width:8,...e});
 }});
 m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();assert.equal(m.cycles,4);assert.equal(m._chipDebt,0);assert.equal(m.cpu.cycles,0);assert.equal(m._a20Enabled,true);
 initializeFixedBochsReset(m.cpu);
 const controller=m._a20Controller;assert.equal(controller.inputBusyCycles,12);assert.equal(controller.responseDelayCycles,32);assert.ok(!controller.mouse&&!controller.outputQueue.length&&!controller.keyboardSchedule.length&&!controller.delayedResponse);
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('cold reference forbids '+method);};
 const live=()=>assert.ok(!active&&!closed&&!settled,'paused live oracle');
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m)});
 const checkpoint=()=>{assert.ok(!active&&!closed);return snapshot();};
 return Object.freeze({
  checkpoint,
  cpu(){assert.ok(!active&&!closed);return javascriptCpu(m.cpu);},
  timing(){assert.ok(!active&&!closed);return {q,cycles:m.cycles,debt:m._chipDebt,deadline:m._chipDeadline,a20Enabled:m._a20Enabled};},
  stage(){live();const flushed=m._chipDebt>=m._chipDeadline;if(flushed)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==lineAsserted;lineAsserted=asserted;return {asserted,changed,flushed};},
  position(){assert.ok(!active&&!closed);return {q,cs:m.cpu.cs,eip:m.cpu.eip};},
  step(){
   live();assert.equal(m.cpu.cr0,bochsResetProfile.cr0,"fixed scope forbids changed CR0");assert.ok(!m.cpu.halted&&!m.cpu.shutdown&&!(m.cpu.eflags&0x200),'no halt/shutdown/IF before checkpoint');
   const portStart=ports.length;if(coldCheckpointReached(m.cpu))return validateColdProgress({done:true,chargedQuanta:0,q,portStart,portCount:0});
   assert.ok(q<coldBoardProfile.totalQuanta,'checkpoint missing at Q cap');
   const site=repSites.find(s=>m.cpu.cs===0xf000&&m.cpu.eip===s.eip),beforeQ=q,start=m.cpu.pc>>>0;let rep=null;
   if(site){const cpu=m.cpu;assert.ok(admitRepElement({cs:cpu.cs,csBase:cpu.segmentCaches[1].base,cs32:cpu.segmentCaches[1].default32,es:cpu.es,esBase:cpu.segmentCaches[0].base,es32:cpu.segmentCaches[0].default32,pe:!!(cpu.cr0&1),df:!!(cpu.eflags&0x400),eip:cpu.eip,cx:cpu.ecx&65535,di:cpu.edi&65535,eax:cpu.eax,bytes:Array.from(rom.subarray(site.eip,site.eip+site.bytes.length))}),'live exact REP state');const address=cpu.edi&65535;rep={siteEip:site.eip,address,beforeBytes:Array.from(m.mem.subarray(address,address+site.width))};}
   active=true;try{m.step();}finally{active=false;}
   assert.equal(m.cpu.cycles,beforeQ+1,'one successful JS completion/REP element');q++;assert.equal(m.cpu.cr0,bochsResetProfile.cr0,"raw CR0 write outside reset-only profile");assert.equal(m.cycles,4+6*q);assert.equal(m._a20Enabled,true);assert.ok(!m._cpuResetPending&&!m._fastA20Latch&&!m.cpu.halted&&!m.cpu.shutdown&&!(m.cpu.eflags&0x200));
   assert.ok(m.cpu._instructionBytes>=1&&m.cpu._instructionBytes<=15);for(let k=0;k<m.cpu._instructionBytes;k++){const raw=(start+k)>>>0,rawPage=(raw&0xfffff000)>>>0,decodedPage=(m._decode386(raw)&0xfffff000)>>>0;assert.ok(rawPage>=0xf0000&&rawPage<=0xff000||rawPage>=0xffff0000,'fixed ROM instruction page');assert.equal(decodedPage,rawPage>=0xffff0000?(rawPage&0xffffff):rawPage,'actual reset ROM alias');pages.set(rawPage,decodedPage);assert.ok(pages.size<=32,'ROM page cap');}
   if(rep)Object.assign(rep,{q,cx:m.cpu.ecx&65535,di:m.cpu.edi&65535,eip:m.cpu.eip,afterBytes:Array.from(m.mem.subarray(rep.address,rep.address+site.width))});
   return validateColdProgress({done:false,chargedQuanta:1,q,portStart,portCount:ports.length-portStart,...(rep?{rep}: {})});
  },
  records(start=0){assert.ok(!active&&!closed);assert.ok(Number.isSafeInteger(start)&&start>=0&&start<=ports.length);return clone(ports.slice(start));},
  pageUsage(){assert.ok(!active&&!closed);return [...pages].sort((a,b)=>a[0]-b[0]).map(([raw,decoded])=>({raw,decoded}));},
  settleCheckpoint(){live();assert.ok(coldCheckpointReached(m.cpu),'settle only before E16');m._catchUpChips();settled=true;return {...snapshot(),ramSha256:sha(m.mem)};},
  close(){assert.ok(!active&&!closed);closed=true;}
 });
}
