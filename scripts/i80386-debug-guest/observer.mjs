import {createHash} from 'node:crypto';
import {createI80386DebugTarget} from '../../src/i80386-debug.js';
const EVENT_CAP=524288, WIRE_CAP=1048576;
const sha=b=>createHash('sha256').update(b).digest('hex');
export function reconstructBefore(event){
 const before={...event.registersAfter};
 for(const [key,change] of Object.entries(event.changes?.registers??{}))
  if(Object.hasOwn(change,'before'))before[key]=change.before;
 return before;
}
export const eligible=r=>!!(r.cr0&1)&&!(r.eflags&0x20000)&&r.csCacheDefault32===true&&r.cpl===3&&!r.halted;
export function direct(machine){
 const c=machine.cpu,regs={};
 for(const k of ['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cr4','es','cs','ss','ds','fs','gs'])regs[k]=c[k]>>>0;
 regs.csCacheBase=c.segmentCaches[1].base>>>0;regs.csCacheDefault32=c.segmentCaches[1].default32;regs.cpl=c.currentPrivilegeLevel;regs.halted=c.halted;
 regs.pc=(regs.csCacheBase+regs.eip)>>>0;
 return {regs,gdtr:{...c.gdtr},idtr:{...c.idtr},ldtr:{...c.ldtr},tr:{...c.tr},debugRegisters:Array.from(c._debugRegisters),interruptShadow:c._interruptShadow,nmiShadow:c._nmiShadow,debugShadow:c._debugShadow,nmiActive:c._nmiActive,shutdown:c.shutdown,machineCycles:machine.cycles,cpuCycles:c.cycles,debt:machine._chipDebt,deadline:machine._chipDeadline,segmentCaches:Array.from({length:6},(_,i)=>({...c.segmentCaches[i]})),translations:(c._translations??[]).map(r=>r?{...r}:null),translationGeneration:c._translationGeneration,tablePages:[...(c._translationTablePages??[])],vgaLatches:machine.vgaMemory?Array.from(machine.vgaMemory.latches):null,pitFraction:machine.chips.pit1?._frac,rtcPhase:machine.chips.rtc1?.cyclePhase,ram0:Array.from(machine.mem.subarray(0,4))};
}
export function createDebugGuestObserver(machine){
 let started=false,active=false,closed=false,off=null,target=null,attempts=0,instructions=0,ring3=0,memories=0,bytes=0,first=null,startStep=null,initial=null,final=null;
 const chunks=[],boundaries=[];let before=null,eventStart=0;
 const refs={step:machine.cpu.step,read:machine.cpu.read,write:machine.cpu.write};
 const fail=reason=>{if(first===null)first=String(reason).slice(0,256);};
 function nonmutating(){
  const memoryHashes=()=>({ram:sha(machine.mem),vga:(machine.vgaMemory?.planes??[]).map(sha)});
  const a=direct(machine),hashes=memoryHashes();target.regs();target.readMem('mem',0,4);
  if(machine.vgaMemory)target.readMem('mem',0xa0000,4);
  if(JSON.stringify(a)!==JSON.stringify(direct(machine))||JSON.stringify(hashes)!==JSON.stringify(memoryHashes()))fail('debug-observation-mutated-state');
 }
 function receive(event){
  if(!active)return;
  let raw;try{raw=Buffer.from(JSON.stringify(event,(_k,v)=>typeof v==='bigint'?{$bigint:v.toString()}:v)+'\n');}catch(error){fail('event-serialization:'+error.message);return;}const available=EVENT_CAP-bytes;
  chunks.push(raw.subarray(0,available));bytes+=Math.min(available,raw.length);
  if(raw.length>available){fail('event-byte-cap');return;}
  if(event.kind==='memory'){
   memories++;if(memories>1024)fail('memory-event-cap');
   if(!Number.isInteger(event.memory?.address)||event.memory.address<0||event.memory.address>0xffffffff)fail('non-unsigned-memory-fact');
  }
  if(event.kind==='instruction'&&event.phase==='retire'){
   instructions++;if(instructions>64)fail('instruction-event-cap');
   const pre=reconstructBefore(event),post=event.registersAfter;
   if(((pre.csCacheBase+pre.eip)>>>0)!==event.pcBefore||((post.csCacheBase+post.eip)>>>0)!==event.pcAfter)fail('cached-PC-join');
   if(eligible(pre))ring3++;
  }
 }
 function finish(){
  if(closed)return;
  try{
   if(active){nonmutating();final=direct(machine);}
  }catch(error){fail('final-observation:'+error.message);}
  active=false;
  if(off){const consume=off;off=null;try{consume();}catch(error){fail('unsubscribe:'+error.message);}}
  if(machine.cpu.step!==refs.step||machine.cpu.read!==refs.read||machine.cpu.write!==refs.write)fail('CPU-callbacks-not-restored');
  closed=true;
 }
 return {
  before(step){
   if(closed)return;
   const c=machine.cpu;
   if(!started&&(c.cr0&1)&&!(c.eflags&0x20000)&&c.segmentCaches[1].default32===true&&c.currentPrivilegeLevel===3&&!c.halted){
    started=true;startStep=step;initial=direct(machine);
    try{target=createI80386DebugTarget({machine});nonmutating();active=true;off=target.onDebugEvent(receive);}catch(error){fail('subscription:'+error.message);finish();}
   }
   if(active){before=direct(machine);eventStart=instructions;}
  },
  retired(step){
   if(!active)return;
   attempts++;const after=direct(machine);
   boundaries.push({step,before:before.regs,after:after.regs,cpuBefore:before.cpuCycles,cpuAfter:after.cpuCycles,machineBefore:before.machineCycles,machineAfter:after.machineCycles,eventStart,eventEnd:instructions});
   if(after.cpuCycles-before.cpuCycles!==1||after.machineCycles-before.machineCycles!==6)fail('ordinary-step-not-one-completed-instruction');
   if(attempts===64||first!==null)finish();
  },
  finish,
  report(){
   finish();if(!started)fail('eligible-window-missing');if(instructions!==64)fail('incomplete-window');if(ring3<1)fail('actual-ring3-retirement-missing');
   const raw=Buffer.concat(chunks),r={schema:'bw.debug-guest-observer.v1',started,closed,firstFailure:first,complete:first===null,startStep,attempts,instructionEvents:instructions,ring3Retirements:ring3,memoryEvents:memories,eventBytes:raw.length,eventSha256:sha(raw),eventEncoding:'JSON_LINES_BIGINT_TAG_V1',eventsBase64:raw.toString('base64'),initial,final,boundaries,ordinaryMachineStepPreserved:true,checkpointQualified:false,GUIQualified:false};
   const encoded=Buffer.from(JSON.stringify(r)+'\n');if(encoded.length>WIRE_CAP)throw Error('observer wire cap');return encoded;
  }
 };
}
