import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {classifyI80386FormResolvedAdmission as classify} from
  '../src/experimental/i80386-form-resolved-admission.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';

const form=(bytes,options={})=>classify(bytes,{groupedShadowAdmission:true,
  startEip:0x20,postEip:0x20+bytes.length,...options});

test('grouped data/flag/EA forms distinguish register, RAM, prefixes and byte width',()=>{
  assert.equal(form([0xa8,0x01]).reason,null);
  assert.equal(form([0xa8,0x01]).operandWidth,8);
  assert.equal(form([0xa8]).reason,'missing-immediate');
  assert.equal(form([0x8d,0x47,0x02]).accessClass,'address-only');
  assert.equal(form([0x8d,0x47,0x02],{dataAccesses:1}).reason,
    'unexpected-memory-access');
  assert.equal(form([0x8d,0xc0]).reason,'invalid-lea-register-form');
  assert.equal(form([0x0b,0xc0]).accessClass,'register');
  assert.equal(form([0x0b,0x07],{dataAccesses:1}).accessClass,'ram-read');
  assert.equal(form([0x0b,0x07],{dataAccesses:2,dataReads:1,dataWrites:1})
    .reason,'unexpected-memory-write');
  assert.equal(form([0x31,0x07],{dataAccesses:2,dataReads:1,dataWrites:1})
    .accessClass,'ram-read+write');
  assert.equal(form([0x31,0x07],{dataAccesses:1,dataReads:1,dataWrites:0})
    .reason,'unproved-memory-access');
  assert.equal(form([0x31,0x07],{dataAccesses:2,dataReads:1,dataWrites:1,
    dataPageCrossing:true}).reason,'data-page-crossing');
  assert.equal(form([0x66,0x67,0x8d,0x84,0x8d,1,2,3,4]).addressWidth,32);
  assert.equal(form([0x66,0x67,0x8d,0x84,0x8d,1,2,3,4]).operandWidth,32);
  assert.equal(form([0x0b,0xc0],{postEip:0x24}).reason,
    'unexpected-linear-successor');
  assert.equal(classify([0xa8,0x01]).reason,'unsupported-opcode');
});

test('FF /0 is typed; segment, stack and control forms remain side exits',()=>{
  const ffReg=form([0xff,0xc0]);
  assert.equal(ffReg.reason,null);
  assert.equal(ffReg.modrm.reg,0);
  const ffRam=form([0xff,0x07],{dataAccesses:2,dataReads:1,dataWrites:1});
  assert.equal(ffRam.reason,null);
  assert.equal(ffRam.accessClass,'ram-read+write');
  assert.notEqual(ffRam.formKey,ffReg.formKey);
  assert.equal(form([0xff,0x17]).reason,'deferred-control-stack-state');
  assert.equal(form([0xff,0x37]).reason,'deferred-stack-state');
  assert.equal(form([0x8e,0xd8]).reason,'deferred-segment-state');
  assert.equal(form([0xe8,0,0]).reason,'deferred-control-stack-state');
  assert.equal(form([0xc3]).reason,'deferred-control-stack-state');
  assert.equal(form([0x50]).reason,'deferred-stack-state');
  assert.equal(form([0x8f,0x07]).reason,'deferred-stack-state');
  assert.equal(form([0x07]).reason,'deferred-stack-state');
});

function fixture(mode,bytes){
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
function steps(machine,observer,n){
  for(let i=0;i<n;i++){
    observer?.observe(machine);
    try{machine.step();observer?.retired(machine);}
    catch(error){observer?.aborted(machine);throw error;}
  }
}
const grouped=[0xa8,1,0x8d,0x47,2,0x0b,0xc0,0x31,0xc0,
  0xff,0xc0,0xa8,1,0x0b,0xc0,0xff,0xc0];
for(const mode of ['real','protected16','vm86','protected32']){
  test(`${mode} ordinary guest parity and disjoint grouped runs`,()=>{
    const bytes=[...grouped,0x90,...grouped];
    const machine=fixture(mode,bytes),baseline=fixture(mode,bytes);
    const observer=createI80386CrossModePotentialTraceObserver({
      groupedShadowAdmission:true});
    const restore=observer.attach(machine);
    steps(machine,observer,17);restore();steps(baseline,null,17);
    assert.equal(machine.cpu.eip,baseline.cpu.eip);
    assert.equal(machine.cpu.eflags,baseline.cpu.eflags);
    assert.equal(machine.cpu.cycles,baseline.cpu.cycles);
    const report=observer.report();
    assert.equal(report.formResolvedPotential,undefined);
    const bucket=report.groupedShadowPotential.modes[mode];
    assert.deepEqual(bucket.runLengthHistogram,{'8':2});
    assert.equal(bucket.ordinalsInRunsAtLeast8,16);
    assert.equal(bucket.refusals['unsupported-opcode'],1);
    assert.equal(bucket.admittedAccessClasses['address-only'],2);
  });
}

test('ordinary RAM read/write order is unchanged by grouped observation',()=>{
  const bytes=[0x0b,0x07,0x31,0x07,0xff,0x07];
  const machine=fixture('protected16',bytes),baseline=fixture('protected16',bytes);
  for(const target of [machine,baseline]){
    target.cpu.bx=0x40;target.cpu.ax=0x03;
    target.mem[0x20040]=0x05;
  }
  const observer=createI80386CrossModePotentialTraceObserver({
    groupedShadowAdmission:true});
  const restore=observer.attach(machine);
  steps(machine,observer,3);restore();steps(baseline,null,3);
  assert.equal(machine.cpu.ax,baseline.cpu.ax);
  assert.equal(machine.cpu.eflags,baseline.cpu.eflags);
  assert.equal(machine.cpu.cycles,baseline.cpu.cycles);
  assert.equal(machine.mem[0x20040],baseline.mem[0x20040]);
  const bucket=observer.report().groupedShadowPotential.modes.protected16;
  assert.equal(bucket.admittedAccessClasses['ram-read'],1);
  assert.equal(bucket.admittedAccessClasses['ram-read+write'],2);
});

test('external event and pre-step chip horizon preserve grouped cuts',()=>{
  const bytes=[...grouped,...grouped];
  const machine=fixture('protected16',bytes);
  const observer=createI80386CrossModePotentialTraceObserver({
    groupedShadowAdmission:true});
  const restore=observer.attach(machine);
  steps(machine,observer,8);observer.externalEvent();
  machine._chipDebt=machine._chipDeadline;
  steps(machine,observer,1);restore();
  const bucket=observer.report().groupedShadowPotential.modes.protected16;
  assert.equal(bucket.runEndReasons['external-event'],1);
  assert.equal(bucket.refusals['pre-step-event-horizon'],1);
  assert.equal(bucket.ordinalsInRunsAtLeast8,8);
});

test('physical code page and segment-cache identity changes split grouped runs',()=>{
  const machine=fixture('protected16',[...grouped,...grouped,...grouped]);
  const observer=createI80386CrossModePotentialTraceObserver({
    groupedShadowAdmission:true});
  const restore=observer.attach(machine);
  steps(machine,observer,8);
  machine.cpu.segmentCaches[3].base=0x30000;
  steps(machine,observer,8);
  machine.cpu.segmentCaches[1].base=0x110000;
  machine.mem.set(grouped,0x110000+machine.cpu.eip);
  steps(machine,observer,8);restore();
  const bucket=observer.report().groupedShadowPotential.modes.protected16;
  assert.equal(bucket.runEndReasons['identity-change'],1);
  assert.equal(bucket.runEndReasons['code-page-change'],1);
  assert.equal(bucket.ordinalsInRunsAtLeast8,24);
});
