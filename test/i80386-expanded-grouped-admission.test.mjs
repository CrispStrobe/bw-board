import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';
import {classifyI80386ExpandedGroupedAdmission as classify} from
  '../src/experimental/i80386-expanded-grouped-admission.js';

const bytes=(kind,start,values)=>values.map((value,index)=>({kind,
  address:start+index,value}));
const form=(instruction,options={})=>classify(instruction,{mode:'protected16',
  startEip:0x20,postEip:0x25,dataTrace:[],...options});

test('typed call and return require exact ordered stack bytes and successor',()=>{
  assert.equal(form([0xe8,2,0],{dataTrace:bytes('write',0x200fe,[0x23,0]),
    postEip:0x25}).reason,null);
  assert.equal(form([0xe8,2,0],{dataTrace:bytes('write',0x200fe,[0,0]),
    postEip:0x25}).reason,'call-stack-traffic');
  assert.equal(form([0xc3],{dataTrace:bytes('read',0x200fe,[0x23,0]),
    postEip:0x23}).reason,null);
  assert.equal(form([0xc3],{dataTrace:bytes('read',0x200fe,[0x23,0]),
    postEip:0x24}).reason,'return-stack-traffic');
  assert.equal(form([0xc3],{default32:true,postEip:0x80000020,
    dataTrace:bytes('read',0x200fc,[0x20,0,0,0x80])}).reason,null);
  assert.equal(form([0xe8,2,0],{dataTrace:bytes('write',0x200fe,[0x23,0]),
    postEip:0x25,espBefore:0x100,espAfter:0xff,stackBase:0x20000})
    .reason,'call-stack-traffic');
  assert.equal(form([0xc3],{dataTrace:bytes('read',0x200fe,[0x23,0]),
    postEip:0x23,espBefore:0xfe,espAfter:0x100,stackBase:0x30000})
    .reason,'return-stack-traffic');
});

test('FF /2 source and push order, ES descriptor and Accessed traffic are typed',()=>{
  const source=bytes('read',0x20040,[0x25,0]);
  const push=bytes('write',0x200fe,[0x22,0]);
  assert.equal(form([0xff,0x17],{dataTrace:[...source,...push],
    postEip:0x25}).reason,null);
  assert.equal(form([0xff,0x17],{dataTrace:[...push,...source],
    postEip:0x25}).reason,'source-read-traffic');
  assert.equal(form([0xff,0xd0],{dataTrace:push,
    postEip:0x25}).reason,'deferred-register-indirect-call');
  const sibCall=classify([0xff,0x94,0x8b,0x10,0,0,0],{
    mode:'protected32',default32:true,startEip:0x100,
    postEip:0x80000020,espBefore:0x100,espAfter:0xfc,
    stack32:true,stackBase:0x20000,
    dataTrace:[...bytes('read',0x20110,[0x20,0,0,0x80]),
      ...bytes('write',0x200fc,[0x07,1,0,0])]});
  assert.equal(sibCall.reason,null);
  assert.deepEqual(sibCall.modrm.sib,{scale:2,index:1,base:3});
  const descriptor=bytes('read',0x21000,[0,0,0,0,0,0x92,0,0]);
  const accessed=bytes('write',0x21005,[0x93]);
  assert.equal(form([0x8e,0x46,1],{dataTrace:[
    ...bytes('read',0x20041,[8,0]),...descriptor,...accessed],
    postEip:0x23}).reason,null);
  assert.equal(form([0x8e,0x46,1],{dataTrace:[
    ...descriptor,...bytes('read',0x20041,[8,0]),...accessed],
    postEip:0x23}).reason,'descriptor-access-traffic');
  assert.equal(form([0x8e,0xc2],{mode:'vm86',dataTrace:[],
    postEip:0x22}).reason,null);
});

function fixture(mode,code){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  const cpu=machine.cpu;
  cpu.cs=0x1000;cpu.ds=0x2000;cpu.ss=0x2000;cpu.eip=0x20;
  cpu.cr0=mode==='real'?0:1;
  cpu.eflags=mode==='vm86'?cpu.eflags|0x23000:cpu.eflags&~0x20000;
  cpu.segmentCaches[1]={base:0x10000,limit:0xffff,default32:false,
    present:true,code:true,readable:true,writable:false};
  for(const index of [2,3])cpu.segmentCaches[index]={base:0x20000,
    limit:0xffff,default32:false,present:true,code:false,
    readable:true,writable:true};
  cpu.sp=0x100;
  machine.mem.set(code,0x10020);
  machine._chipDebt=0;machine._chipDeadline=10000;
  return machine;
}
const run=(machine,observer,n)=>{
  const restore=observer.attach(machine);
  for(let i=0;i<n;i++){
    observer.observe(machine);
    try{machine.step();observer.retired(machine);}
    catch(error){observer.aborted(machine);throw error;}
  }
  restore();return observer.report().expandedGroupedPotential;
};

test('same-cache VM86 ES reload can admit; changed reload is a global cut',()=>{
  const machine=fixture('vm86',[0x8e,0xc2,0x8e,0xc2]);
  machine.cpu.dx=0x2000;
  const report=run(machine,createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true}),2);
  const mode=report.modes.vm86;
  assert.equal(mode.refusals['identity-change'],1);
  assert.equal(mode.typedCandidatesCutByGlobal['identity-change'],1);
  assert.equal(mode.admittedOrdinals,1);
  assert.equal(mode.admittedFormCounts['8e:-/-/-:o16:a16:m3r0b2d0:register'],1);
  assert.equal(report.uniqueOrdinalsInRunsAtLeast8,0);
});

test('a changed visible ES selector cuts even if the cache identity is equal',()=>{
  const machine=fixture('real',[0x8e,0xc2]);
  machine.cpu.es=0x1000;
  machine.cpu.segmentCaches[0]={...machine.cpu.segmentCaches[0],
    base:0x20000,present:true,null:false};
  machine.cpu.dx=0x2000;
  const report=run(machine,createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true}),1);
  const mode=report.modes.real;
  assert.equal(mode.refusals['segment-selector-change'],1);
  assert.equal(mode.admittedOrdinals,0);
});

test('protected16 repeat ES load records Accessed write then admits same-cache reload',()=>{
  const machine=fixture('protected16',[0x8e,0xc2,0x8e,0xc2]);
  machine.cpu.dx=8;
  machine.cpu.gdtr={base:0x20000,limit:0x0f};
  machine.mem.set([0xff,0xff,0,0x20,3,0x92,0,0],0x20008);
  const report=run(machine,createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true}),2);
  const mode=report.modes.protected16;
  assert.equal(machine.mem[0x2000d],0x93);
  assert.equal(mode.refusals['identity-change'],1);
  assert.equal(mode.typedCandidatesCutByGlobal['identity-change'],1);
  assert.equal(mode.admittedOrdinals,1);
  assert.equal(mode.admittedFormCounts['8e:-/-/-:o16:a16:m3r0b2d0:ram-read'],1);
});

test('ordinary 16-bit direct call/return joins a disjoint two-step run',()=>{
  const machine=fixture('real',[0xe8,2,0,0x90,0x90,0xc3]);
  const report=run(machine,createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true}),2);
  const mode=report.modes.real;
  assert.equal(mode.admittedOrdinals,2);
  assert.deepEqual(mode.runLengthHistogram,{'2':1});
  assert.equal(mode.admittedAccessClasses['ram-write'],1);
  assert.equal(mode.admittedAccessClasses['ram-read'],1);
});

test('memory FF /2 and C3 join only with one safe data page',()=>{
  const machine=fixture('real',[0xff,0x17,0x90,0x90,0x90,0xc3]);
  machine.cpu.bx=0x40;
  machine.mem[0x20040]=0x25;
  machine.mem[0x20041]=0;
  const report=run(machine,createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true}),2);
  const mode=report.modes.real;
  assert.equal(mode.admittedOrdinals,2);
  assert.deepEqual(mode.runLengthHistogram,{'2':1});
});

test('cross-page source/stack and external event still split expanded runs',()=>{
  const crossPage=fixture('real',[0xff,0x17]);
  crossPage.cpu.bx=0x40;
  crossPage.cpu.segmentCaches[3].base=0x30000;
  crossPage.mem[0x30040]=0x22;
  crossPage.mem[0x30041]=0;
  const refused=run(crossPage,createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true}),1);
  assert.equal(refused.modes.real.refusals['data-page-crossing'],1);

  const machine=fixture('real',[0xe8,2,0,0x90,0x90,0xc3]);
  const observer=createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true});
  const restore=observer.attach(machine);
  observer.observe(machine);machine.step();observer.retired(machine);
  observer.externalEvent();
  observer.observe(machine);machine.step();observer.retired(machine);
  restore();
  const mode=observer.report().expandedGroupedPotential.modes.real;
  assert.deepEqual(mode.runLengthHistogram,{'1':2});
  assert.equal(mode.runEndReasons['external-event'],1);
});

test('expanded variant cannot share a grouped or first-refusal observer',()=>{
  assert.throws(()=>createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true,groupedShadowAdmission:true}),
  /separate observer variant/);
});
