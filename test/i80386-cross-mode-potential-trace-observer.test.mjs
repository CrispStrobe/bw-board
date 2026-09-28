import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';

const code=[...Array(8).fill(0x90),0xe4,0x21,...Array(8).fill(0x90)];
function fixture(mode,bytes=code){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  const cpu=machine.cpu,base=mode==='protected32'?0x110000:0x10000;
  cpu.cs=0x1000;cpu.ds=0x2000;cpu.eip=0x20;
  cpu.cr0=mode==='real'?0:1;
  cpu.eflags=mode==='vm86'?(cpu.eflags|0x23000):cpu.eflags&~0x20000;
  cpu.segmentCaches[1]={base,limit:0xffffffff,default32:mode==='protected32',
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0x20000,limit:0xffffffff,default32:false,
    present:true,code:false,readable:true,writable:true};
  machine.mem.set(bytes,base+0x20);
  machine._chipDebt=0;machine._chipDeadline=10000;
  return machine;
}
function step(machine,observer,count){
  for(let i=0;i<count;i++){
    observer?.observe(machine);
    try{machine.step();observer?.retired(machine);}
    catch(error){observer?.aborted(machine);throw error;}
  }
}
function state(machine){
  const cpu=machine.cpu;
  return {eax:cpu.eax,ecx:cpu.ecx,eip:cpu.eip,eflags:cpu.eflags,
    cycles:cpu.cycles,boardCycles:machine.cycles,
    memory:createHash('sha256').update(machine.mem).digest('hex')};
}

for(const mode of ['real','protected16','vm86','protected32']){
  test(`${mode} partitions disjoint observed ordinals`,()=>{
    const bytes=mode==='vm86'?Array(17).fill(0x90):code;
    const observed=fixture(mode,bytes),ordinary=fixture(mode,bytes);
    const observer=createI80386CrossModePotentialTraceObserver();
    const restore=observer.attach(observed);
    step(observed,observer,17);restore();step(ordinary,null,17);
    assert.deepEqual(state(observed),state(ordinary));
    const report=observer.report(),bucket=report.modes[mode];
    assert.equal(bucket.completedStepCalls,17);
    assert.equal(bucket.eligibleRetiredOrdinals,17);
    const io=mode==='vm86'?0:1;
    assert.equal(bucket.observedIoOrdinals,io);
    assert.equal(bucket.admittedOptimisticIoOrdinals,io);
    assert.equal(bucket.ordinalsInRunsAtLeast8,17);
    assert.equal(report.uniqueOrdinalsInRunsAtLeast8,17);
    assert.equal(report.optimisticIoOrdinalsInRunsAtLeast8,io);
    assert.deepEqual(bucket.runLengthHistogram,{'17':1});
  });
}

test('REP iteration step calls never enter the retired-instruction denominator',()=>{
  const machine=fixture('protected16',[0xf3,0xaa,0x90]);
  machine.cpu.cx=3;machine.cpu.di=0x40;
  const observer=createI80386CrossModePotentialTraceObserver(),restore=observer.attach(machine);
  step(machine,observer,4);restore();
  const report=observer.report(),bucket=report.modes.protected16;
  assert.equal(bucket.completedStepCalls,4);
  assert.equal(bucket.repeatIterationCalls,3);
  assert.equal(bucket.eligibleRetiredOrdinals,1);
  assert.equal(bucket.admittedOrdinals,1);
  assert.equal(report.uniqueOrdinalsInRunsAtLeast8,0);
});

test('physical code page and external input split runs without double counting',()=>{
  const machine=fixture('protected16',Array(20).fill(0x90));
  const observer=createI80386CrossModePotentialTraceObserver(),restore=observer.attach(machine);
  step(machine,observer,8);
  observer.externalEvent();
  step(machine,observer,8);
  restore();
  const bucket=observer.report().modes.protected16;
  assert.deepEqual(bucket.runLengthHistogram,{'8':2});
  assert.equal(bucket.ordinalsInRunsAtLeast8,16);
  assert.equal(bucket.runEndReasons['external-event'],1);
});

test('faulting call without completion is excluded and recorded as an aborted exit',()=>{
  const machine=fixture('protected16',[0x90]);
  machine.cpu.deliverFaults=false;
  machine.cpu.segmentCaches[1].limit=0x1f;
  const observer=createI80386CrossModePotentialTraceObserver(),restore=observer.attach(machine);
  observer.observe(machine);
  assert.throws(()=>machine.step());observer.aborted(machine);restore();
  const bucket=observer.report().modes.protected16;
  assert.equal(bucket.abortedCalls,1);
  assert.equal(bucket.abortedExits,1);
  assert.equal(bucket.completedStepCalls,0);
});

test('code and translation-table writes are separate revocation cuts',()=>{
  for(const kind of ['code','table']){
    const machine=fixture('protected16',[0x89,0x06,0x20,0x00]);
    machine.cpu.segmentCaches[3].base=kind==='code'?0x10000:0x1000;
    if(kind==='table')machine.cpu._translationTablePages.add(1);
    const observer=createI80386CrossModePotentialTraceObserver();
    const restore=observer.attach(machine);
    step(machine,observer,1);restore();
    const bucket=observer.report().modes.protected16;
    assert.equal(bucket.completedStepCalls,1);
    assert.equal(bucket.refusedOrdinals,1);
    assert.equal(bucket.refusals['code-or-table-write'],1);
    assert.equal(bucket.codePageRevocations,kind==='code'?1:0);
    assert.equal(bucket.translationRevocations,kind==='table'?1:0);
  }
});

test('observed physical code-page change closes a run at the next entry',()=>{
  const machine=fixture('protected16',Array(18).fill(0x90));
  const observer=createI80386CrossModePotentialTraceObserver();
  const restore=observer.attach(machine);
  step(machine,observer,8);
  machine.cpu.segmentCaches[1].base=0x110000;
  machine.mem.set(Array(8).fill(0x90),0x110028);
  step(machine,observer,8);restore();
  const bucket=observer.report().modes.protected16;
  assert.deepEqual(bucket.runLengthHistogram,{'8':2});
  assert.equal(bucket.runEndReasons['code-page-change'],1);
});

test('taken conditional branch joins its observed same-page successor',()=>{
  const bytes=[0x74,0x02,0x90,0x90,...Array(8).fill(0x90)];
  const machine=fixture('protected32',bytes);
  machine.cpu.eflags|=0x40;
  const observer=createI80386CrossModePotentialTraceObserver(),restore=observer.attach(machine);
  step(machine,observer,9);restore();
  const bucket=observer.report().modes.protected32;
  assert.deepEqual(bucket.runLengthHistogram,{'9':1});
  assert.equal(bucket.ordinalsInRunsAtLeast8,9);
  assert.equal(bucket.controlTransferOrdinalsInRunsAtLeast8,1);
  assert.equal(bucket.longRunOpcodeCounts['74'],1);
});

test('host code write revokes the active physical page before the next step',()=>{
  const machine=fixture('protected16',Array(18).fill(0x90));
  const observer=createI80386CrossModePotentialTraceObserver(),restore=observer.attach(machine);
  step(machine,observer,8);
  machine._write(0x10028,0x90);
  step(machine,observer,8);restore();
  const bucket=observer.report().modes.protected16;
  assert.equal(bucket.codePageRevocations,1);
  assert.equal(bucket.runEndReasons['host-or-dma-write'],1);
  assert.deepEqual(bucket.runLengthHistogram,{'8':2});
});
