import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {createI80386Code16EventRunObserver} from
  '../src/experimental/i80386-code16-event-run-observer.js';

const code=[0xb8,1,0,0x39,0xc0,0x74,2,0x90,0x90,0xe4,0x21,0x90];
function fixture({fallthrough=false}={}){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  const cpu=machine.cpu;
  cpu.cs=0x1000;cpu.ds=0x2000;cpu.eip=0x20;cpu.cr0=1;
  cpu.segmentCaches[1]={base:0x10000,limit:0xffff,default32:false,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0x20000,limit:0xffff,default32:false,
    present:true,code:false,readable:true,writable:true};
  machine.mem.set(code,0x10020);
  if(fallthrough)machine.mem[0x10024]=0xd8; // CMP AX,BX; BX initially zero.
  machine._chipDebt=0;machine._chipDeadline=10000;
  return machine;
}
function advance(machine,observer,count){
  for(let index=0;index<count;index++){
    observer?.observe(machine);
    try{machine.step();observer?.retired(machine);}
    catch(error){observer?.aborted(machine);throw error;}
  }
}
function state(machine){
  const cpu=machine.cpu;
  return {registers:[cpu.eax,cpu.ecx,cpu.edx,cpu.ebx,cpu.esp,cpu.ebp,
    cpu.esi,cpu.edi],cs:cpu.cs,eip:cpu.eip,eflags:cpu.eflags,
    cycles:cpu.cycles,boardCycles:machine.cycles,chipDebt:machine._chipDebt,
    memory: createHash('sha256').update(machine.mem).digest('hex')};
}

test('taken protected16 JZ joins until IN; I/O is a unique refused ordinal',()=>{
  const observed=fixture(),ordinary=fixture();
  const observer=createI80386Code16EventRunObserver();
  const restore=observer.attach(observed);
  advance(observed,observer,5);advance(ordinary,null,5);
  restore();
  assert.deepEqual(state(observed),state(ordinary));
  const result=observer.report(),mode=result.modes.protected16;
  assert.equal(result.denominator16BitRetiredOrdinals,5);
  assert.equal(mode.entryAttempts,5);
  assert.equal(mode.admittedOrdinals+mode.refusedOrdinals,5);
  assert.equal(mode.refusals['device-io'],1);
  assert.deepEqual(mode.runLengthHistogram,{'1':1,'3':1});
  assert.equal(result.admitted16BitOrdinals,4);
  assert.equal(result.uniqueOrdinalsInRunsAtLeast4,0);
  assert.equal(result.deviceReads,1);
  assert.equal(result.meanAllAdmittedRunLength,2);
});

test('fallthrough branch joins its actual successor into one disjoint long run',()=>{
  const observed=fixture({fallthrough:true}),ordinary=fixture({fallthrough:true});
  const observer=createI80386Code16EventRunObserver(),restore=observer.attach(observed);
  advance(observed,observer,6);advance(ordinary,null,6);restore();
  assert.deepEqual(state(observed),state(ordinary));
  const result=observer.report();
  assert.deepEqual(result.modes.protected16.runLengthHistogram,{'5':1});
  assert.equal(result.denominator16BitRetiredOrdinals,6);
  assert.equal(result.uniqueOrdinalsInRunsAtLeast4,5);
  assert.equal(result.longRunCoverageOf16BitRetirements,5/6);
  assert.equal(result.feasibilityPassed,true);
});

test('external event and chip deadline split runs without double counting',()=>{
  const machine=fixture(),observer=createI80386Code16EventRunObserver();
  const restore=observer.attach(machine);
  advance(machine,observer,1);
  observer.externalEvent();
  machine._chipDeadline=machine._chipDebt;
  advance(machine,observer,1);
  restore();
  const result=observer.report(),mode=result.modes.protected16;
  assert.equal(mode.entryAttempts,2);
  assert.equal(mode.admittedOrdinals,1);
  assert.equal(mode.refusedOrdinals,1);
  assert.equal(mode.refusals['chip-or-interrupt-event'],1);
  assert.deepEqual(mode.runLengthHistogram,{'1':1});
});

test('fault without retirement is outside completed-step denominator',()=>{
  const machine=fixture(),observer=createI80386Code16EventRunObserver();
  machine.cpu.deliverFaults=false;
  machine.cpu.segmentCaches[1].limit=0x1f;
  const restore=observer.attach(machine);
  observer.observe(machine);
  assert.throws(()=>machine.step());
  observer.aborted(machine);restore();
  const result=observer.report(),mode=result.modes.protected16;
  assert.equal(mode.entryAttempts,1);
  assert.equal(mode.abortedCalls,1);
  assert.equal(result.denominator16BitRetiredOrdinals,0);
});

test('ordinary byte and fast immediate fetches reconstruct only fetched instruction bytes',()=>{
  const machine=fixture(),observed=[];
  const observer=createI80386Code16EventRunObserver({onObservedStep:step=>observed.push(step)});
  const restore=observer.attach(machine);
  advance(machine,observer,3);restore();observer.report();
  assert.deepEqual(observed.map(step=>step.bytes),[
    [0xb8,1,0],[0x39,0xc0],[0x74,2]]);
  assert.deepEqual(observed.map(step=>step.codePage),[0x10,0x10,0x10]);

  const wide=fixture(),wideSteps=[];
  wide.cpu.segmentCaches[1].default32=true;
  // The AT board's direct fetchRam32 RAM path starts above 1 MiB.
  wide.cpu.segmentCaches[1].base=0x110000;
  wide.mem.set([0xb8,0x12,0x34,0x56,0x78],0x110020);
  let fastFetches=0,fastValues=0;
  const original=wide.cpu.fetchRam32;
  wide.cpu.fetchRam32=(...args)=>{
    fastFetches++;
    const value=original(...args);
    if(value!==undefined)fastValues++;
    return value;
  };
  const wideObserver=createI80386Code16EventRunObserver({onObservedStep:step=>wideSteps.push(step)});
  const wideRestore=wideObserver.attach(wide);
  advance(wide,wideObserver,1);wideRestore();wideObserver.report();
  assert.equal(fastFetches,1);
  assert.equal(fastValues,1);
  assert.deepEqual(wideSteps[0].bytes,[0xb8,0x12,0x34,0x56,0x78]);
  assert.equal(wideSteps[0].codePage,0x110);
});

test('physical page-table and code writes refuse the owning completed ordinal',()=>{
  for(const kind of ['table','code']){
    const machine=fixture(),steps=[];
    machine.mem.set([0x89,0x06,0x20,0x00],0x10020); // MOV [DS:0020],AX.
    machine.cpu.segmentCaches[3].base=kind==='table'?0x1000:0x10000;
    if(kind==='table')machine.cpu._translationTablePages.add(1);
    const observer=createI80386Code16EventRunObserver({onObservedStep:step=>steps.push(step)});
    const restore=observer.attach(machine);
    advance(machine,observer,1);restore();
    const report=observer.report(),mode=report.modes.protected16;
    assert.equal(steps[0].codeOrTableWrite,true);
    assert.equal(steps[0].codePage,0x10);
    assert.equal(mode.refusals['code-or-table-write'],1);
    assert.equal(report.denominator16BitRetiredOrdinals,1);
    assert.equal(report.admitted16BitOrdinals,0);
  }
});

test('host RAM writes between steps split a candidate run before the next fetch',()=>{
  const machine=fixture(),observer=createI80386Code16EventRunObserver();
  const restore=observer.attach(machine);
  advance(machine,observer,1);
  machine._write(0x10023,0x90); // Change the next fetched opcode to NOP.
  advance(machine,observer,1);
  restore();
  const result=observer.report();
  assert.deepEqual(result.modes.protected16.runLengthHistogram,{'1':2});
  assert.equal(result.modes.protected16.runEndReasons['host-or-dma-write'],1);
});
