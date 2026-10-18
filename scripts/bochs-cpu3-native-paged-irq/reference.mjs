/** Actual JS-board source oracle for one hardware IRQ under strict386 paging. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {javascriptCpu} from '../bochs-cpu3-native-owned-8042-interface/reference.mjs';
import {initializeRamReset} from '../bochs-cpu3-native-ram-bootstrap/reference.mjs';
import {protectedCpuClass} from '../bochs-cpu3-native-protected-ram/cpu-profile.mjs';
import {coldBoardConfig,layout,selector,vector,irqLine,interruptEip,terminalEip,gate,frameStores,markerStores,bootStores,ramInstructions,romInstructions,fixedPagedIrqRom,pagedIrqProfile,expectedShadow,physicalFetch,validateFinalFrame} from './profile.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clone=value=>structuredClone(value);
export async function createPagedIrqOracle(){
 const Cpu=await protectedCpuClass();let q=0,iteration=0,instructionAttempt=0,active=false,closed=false,settled=false,pulsed=false,line=false,phase=null;
 const events=[],deliveries=[],acknowledgements=[],outerSteps=[],nestedCuts=[];
 const m=new ExperimentalI80386ATMachine(structuredClone(coldBoardConfig),{onPortAccess:()=>{throw Error('paged IRQ fixture forbids PIO');}});
 m.cpu=new Cpu({read:a=>m._read386(a),read32:a=>m._read386Ram32(a),fetch:a=>m._read386(a),fetchRam32:a=>m._fetch386Ram32(a),write:(a,v)=>m._write386(a,v),inPort:(p,w)=>m._in386(p,w),outPort:(p,v,w)=>m._out386(p,v,w)},{deliverFaults:true,translationCache:true,translationCacheWritesTrackedExternally:true,cpuProfile:'strict386'});
 const rom=fixedPagedIrqRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();initializeRamReset(m.cpu);
 assert.deepEqual([m._pic.vectorBase,m._pic.imr,m._pic.irr,m._pic.isr,m._pic.intActive],[0,0,0,0,false],'actual reset PIC');
 assert.equal(m._chipDeadline,6000,'no hidden PIT delivery before bounded fixture');
 const seed=Uint8Array.from(m.mem),initialBoard=clone(combinedBoardState(m));
 const pages=()=>Object.fromEntries(Object.entries(layout).map(([key,raw])=>[key,Uint8Array.from(m.mem.subarray(raw,raw+4096))]));
 const snapshot=()=>({q,iteration,instructionAttempt,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),pages:pages(),pic:clone(m._pic.getState()),line,pulsed,events:events.map(clone),deliveries:deliveries.map(clone),acknowledgements:acknowledgements.map(clone)});
 const requirePaused=()=>assert.ok(!active&&!closed&&!settled,'paused owned oracle');
 const originalWrite=m._write386.bind(m);m._write386=(raw,value)=>{assert.ok(active&&phase,'only actual guest/paging/IRQ effects');const before=m.mem[m._decode386(raw)];originalWrite(raw,value);events.push({kind:'write',iteration,instructionAttempt,q,phase:clone(phase),raw:m._decode386(raw),before,after:m.mem[m._decode386(raw)],paging:!!m.cpu._pagingBitWrite});};
 const originalRead=m._read386.bind(m);m._read386=raw=>{const value=originalRead(raw);if(active&&phase)events.push({kind:'read',iteration,instructionAttempt,q,phase:clone(phase),raw:m._decode386(raw),value});return value;};
 const originalAck=m._pic.acknowledge.bind(m._pic);m._pic.acknowledge=()=>{assert.ok(active&&pulsed&&acknowledgements.length===0,'single real PIC ACK');const before=clone(m._pic.getState());const delivered=originalAck();acknowledgements.push({iteration,instructionAttempt,q,vector:delivered,before,after:clone(m._pic.getState())});assert.equal(delivered,vector);return delivered;};
 const originalInterrupt=m.cpu.interrupt.bind(m.cpu);m.cpu.interrupt=(delivered,...args)=>{assert.ok(active&&pulsed&&acknowledgements.length===1&&deliveries.length===0,'hardware IRQ only');assert.equal(delivered,vector);assert.deepEqual(args,[]);const before=javascriptCpu(m.cpu);const old=phase;phase={kind:'irq-delivery',cs:before.cs,eip:before.eip};let result;try{result=originalInterrupt(delivered,...args);}finally{phase=old;}
  assert.equal(result,true);const after=javascriptCpu(m.cpu);const frame=[...m.mem.subarray(0xcffa,0xd000)];const cut={iteration,instructionAttempt,q,before,after,frame,pic:clone(m._pic.getState()),board:combinedBoardState(m),pages:pages()};deliveries.push({vector,source:'irq',iteration,instructionAttempt,q,before,after,frame});nestedCuts.push(cut);return result;};
 const originalStep=m.cpu.step.bind(m.cpu);m.cpu.step=(...args)=>{assert.ok(active&&phase===null,'nonreentrant CPU instruction');const before=javascriptCpu(m.cpu),old=phase;instructionAttempt++;phase={kind:'instruction',cs:before.cs,eip:before.eip};try{return originalStep(...args);}finally{phase=old;}};
 return Object.freeze({
  checkpoint(){requirePaused();return snapshot();},
  pulse(){requirePaused();assert.ok(!pulsed&&m.cpu.cs===selector&&m.cpu.eip===interruptEip,'named STI successor cut');assert.equal(m.cpu.eflags&0x200,0x200);assert.deepEqual([m.cpu._interruptShadow,m.cpu._nmiShadow,m.cpu._debugShadow],[0,0,0]);assert.deepEqual([m._pic.vectorBase,m._pic.imr,m._pic.irr,m._pic.isr],[0,0,0,0]);m._pic.setIRQ(irqLine,1);pulsed=true;assert.equal(m._pic.intActive,true);return snapshot();},
  stage(){requirePaused();if(m._chipDebt>=m._chipDeadline)m._flushChips();if(acknowledgements.length)m._pic.setIRQ(irqLine,0);const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;return {asserted,changed};},
  step(){requirePaused();assert.ok(q<pagedIrqProfile.maxQuanta&&m.cpu.eip!==terminalEip,'bounded pre-HLT stop');const before=javascriptCpu(m.cpu),boardBefore=combinedBoardState(m),ordinal=events.length;iteration++;active=true;let charged;try{charged=m.step();}finally{active=false;phase=null;}
   const completed=m.cpu.cycles-before.cycles;assert.equal(completed,1,'one actual retired instruction');q+=completed;const after=javascriptCpu(m.cpu);assert.equal(charged,6);assert.equal(m.cycles,4+6*q);assert.ok(!m.cpu.halted&&!m.cpu.shutdown);assert.deepEqual([m.cpu._interruptShadow,m.cpu._nmiShadow,m.cpu._debugShadow],expectedShadow(m.cpu.cs,m.cpu.eip));outerSteps.push({iteration,instructionAttempt,before,after,boardBefore,boardAfter:combinedBoardState(m),firstEvent:ordinal,lastEvent:events.length,completed,charged});return {iteration,instructionAttempt,q,completed};},
  settle(){requirePaused();assert.ok(pulsed&&m.cpu.cs===selector&&m.cpu.eip===terminalEip,'returned pre-HLT terminal');assert.equal(acknowledgements.length,1);assert.equal(deliveries.length,1);assert.deepEqual([m._pic.irr,m._pic.isr,m._pic.vectorBase],[0,1,0]);const p=pages();validateFinalFrame(p);assert.deepEqual([...m.mem.subarray(0xc100,0xc104)],[0x11,0x11,0x22,0x22]);assert.equal(m.cpu.esp,0xe000);assert.equal(m.cpu.eflags&0x200,0x200);assert.equal(m.cpu.eax&0xffff,0x1111);assert.deepEqual(deliveries[0].frame,[2,0x70,0x18,0,2,2]);
   const replay=Uint8Array.from(seed);for(const e of events){if(e.kind==='write'){assert.equal(replay[e.raw],e.before);replay[e.raw]=e.after;}else assert.equal(replay[e.raw],e.value);}assert.equal(sha(replay),sha(m.mem),'ordered full physical memory replay');m._catchUpChips();settled=true;return {...snapshot(),outerSteps:outerSteps.map(clone),nestedCuts:nestedCuts.map(clone),seedSha256:sha(seed),ramSha256:sha(m.mem),initialBoard,romSha256:sha(rom)};},
  close(){assert.ok(!active&&!closed);closed=true;},
 });
}
