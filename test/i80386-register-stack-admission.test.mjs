import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';
import {classifyI80386RegisterStackAdmission as classify} from
  '../src/experimental/i80386-register-stack-admission.js';

const registers=[0x11223344,2,3,4,0x12340100,6,7,8];
const traffic=(kind,address,values)=>values.map((value,index)=>({kind,
  address:address+index,value}));
const form=(bytes,changes={})=>classify(bytes,{
  default32:false,startEip:0x20,postEip:0x21,
  dataTrace:traffic('write',0x200fe,[0x44,0x33]),
  registersBefore:registers,registersAfter:[...registers.slice(0,4),
    0x123400fe,...registers.slice(5)],
  espBefore:registers[4],espAfter:0x123400fe,
  stack32:false,stackBase:0x20000,flagsBefore:2,flagsAfter:2,
  ...changes});

test('register PUSH checks entry value, exact writes, pointer and flags',()=>{
  assert.equal(form([0x50]).reason,null);
  assert.equal(form([0x50],{dataTrace:traffic('write',0x200fe,[0x45,0x33])})
    .reason,'push-register-value');
  assert.equal(form([0x50],{dataTrace:traffic('write',0x200ff,[0x44,0x33])})
    .reason,'register-stack-traffic');
  assert.equal(form([0x50],{espAfter:0x123400ff,
    registersAfter:[...registers.slice(0,4),0x123400ff,
      ...registers.slice(5)]}).reason,
    'stack-pointer-result');
  assert.equal(form([0x50],{flagsAfter:0x42}).reason,'stack-flags-change');
  assert.equal(form([0x50],{registersAfter:[9,...registers.slice(1,4),
    0x123400fe,...registers.slice(5)]})
    .reason,'register-result');
  assert.equal(form([0x54],{dataTrace:traffic('write',0x200fe,[0,1])})
    .reason,null);
});

test('POP SP replaces increment and 66 dword width remains independent of SS.B',()=>{
  const pop=form([0x5c],{dataTrace:traffic('read',0x20100,[0x78,0x56]),
    registersAfter:[...registers.slice(0,4),0x12345678,
      ...registers.slice(5)],espAfter:0x12345678});
  assert.equal(pop.reason,null);
  assert.equal(form([0x5c],{dataTrace:traffic('read',0x20100,[0x78,0x56]),
    registersAfter:[...registers.slice(0,4),0x12340102,
      ...registers.slice(5)],espAfter:0x12340102}).reason,
  'stack-pointer-result');
  const dword=form([0x66,0x54],{postEip:0x22,
    dataTrace:traffic('write',0x200fc,[0,1,0x34,0x12]),
    registersAfter:[...registers.slice(0,4),0x123400fc,
      ...registers.slice(5)],espAfter:0x123400fc});
  assert.equal(dword.reason,null);
  assert.equal(dword.prefixSignature,'-/66/-');
  assert.equal(form([0x66,0x54],{postEip:0x22,
    dataTrace:traffic('write',0x200fc,[0,1])}).reason,
  'register-stack-traffic');
});

test('32-bit stack addressing, other prefixes, and missing proofs refuse',()=>{
  const push=form([0x50],{stack32:true,espBefore:0x10100,
    stackBase:0x10000,
    espAfter:0x100fe,registersBefore:[...registers.slice(0,4),
      0x10100,...registers.slice(5)],
    registersAfter:[...registers.slice(0,4),0x100fe,
      ...registers.slice(5)]});
  assert.equal(push.reason,null);
  for(const instruction of [[0x67,0x50],[0xf3,0x50],
    [0xf0,0x50],[0x36,0x50],[0x66,0x66,0x50]])
    assert.notEqual(form(instruction).reason,null);
  assert.equal(form([0x50,0x90]).reason,'instruction-length');
  assert.equal(form([0x50],{registersAfter:null}).reason,
    'missing-register-stack-proof');
  assert.equal(form([0x50],{dataPageCrossing:true}).reason,
    'data-page-crossing');
  assert.equal(form([]).reason,'missing-opcode');
  assert.equal(form([0x66]).reason,'missing-opcode');
  assert.equal(form([0x50],{paging:true,
    dataTrace:traffic('write',0x301fe,[0x44,0x33])}).reason,null);
  assert.equal(form([0x50],{paging:true,
    dataTrace:[{kind:'write',address:0x301fe,value:0x44},
      {kind:'write',address:0x30200,value:0x33}]}).reason,
  'register-stack-traffic');
});

test('POP SP with SS.B=1 retains carry into ESP high half',()=>{
  const before=[...registers.slice(0,4),0xffff,...registers.slice(5)];
  const after=[...before.slice(0,4),0x15678,...before.slice(5)];
  const result=form([0x5c],{stack32:true,stackBase:0x10000,
    espBefore:0xffff,espAfter:0x15678,
    registersBefore:before,registersAfter:after,
    dataTrace:traffic('read',0x1ffff,[0x78,0x56])});
  assert.equal(result.reason,null);
  assert.equal(form([0x5c],{stack32:true,stackBase:0x10000,
    espBefore:0xffff,espAfter:0x5678,
    registersBefore:before,
    registersAfter:[...before.slice(0,4),0x5678,...before.slice(5)],
    dataTrace:traffic('read',0x1ffff,[0x78,0x56])}).reason,
  'stack-pointer-result');
});

test('all sixteen register forms admit word and dword operands with either SS.B',()=>{
  let admitted=0;
  for(const default32 of [false,true])
    for(const prefixed of [false,true])
      for(const stack32 of [false,true])
        for(let opcode=0x50;opcode<=0x5f;opcode++){
          const width=default32!==prefixed?32:16,size=width>>>3;
          const push=opcode<0x58,reg=opcode&7;
          const entry=[0x10203040,0x11223344,0x22334455,0x33445566,
            0x12340100,0x55667788,0x66778899,0x778899aa];
          const initialOffset=stack32?0x12340100:0x100;
          const offset=push?initialOffset-size:initialOffset;
          const stackBase=0x20000;
          const pushed=entry[reg]>>>0,loaded=0x78563412;
          const value=push?pushed:loaded;
          const dataTrace=traffic(push?'write':'read',
            (stackBase+offset)>>>0,Array.from({length:size},(_,i)=>
              (value>>>8*i)&255));
          const after=[...entry];
          after[4]=stack32?(push?initialOffset-size:initialOffset+size):
            0x12340000|(push?0x100-size:0x100+size);
          if(!push)after[reg]=width===32?loaded:
            (after[reg]&0xffff0000)|(loaded&0xffff);
          const instruction=prefixed?[0x66,opcode]:[opcode];
          const classified=classify(instruction,{default32,stack32,
            startEip:0x20,postEip:0x20+instruction.length,
            dataTrace,registersBefore:entry,registersAfter:after,
            espBefore:entry[4],espAfter:after[4],stackBase,
            flagsBefore:2,flagsAfter:2});
          assert.equal(classified.reason,null,
            `${opcode.toString(16)} width=${width} stack32=${stack32}`);
          admitted++;
        }
  assert.equal(admitted,128);
});

function fixture(code){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M);
  const cpu=machine.cpu;
  cpu.cs=0x1000;cpu.ds=0x2000;cpu.ss=0x2000;cpu.eip=0x20;
  cpu.cr0=0;cpu.eflags=2;
  cpu.segmentCaches[1]={base:0x10000,limit:0xffff,default32:false,
    present:true,code:true,readable:true,writable:false};
  for(const index of [2,3])cpu.segmentCaches[index]={base:0x20000,
    limit:0xffff,default32:false,present:true,code:false,
    readable:true,writable:true};
  cpu.sp=0x100;machine.mem.set(code,0x10020);
  machine._chipDebt=0;machine._chipDeadline=10000;
  return machine;
}
const observe=(machine,count)=>{
  const observer=createI80386CrossModePotentialTraceObserver({
    registerStackAdmission:true});
  const restore=observer.attach(machine);
  for(let i=0;i<count;i++){
    observer.observe(machine);machine.step();observer.retired(machine);
  }
  restore();return observer.report().registerStackPotential;
};

test('ordinary PUSH/POP pair joins a run only in the new variant',()=>{
  const machine=fixture([0x54,0x5b]);
  const report=observe(machine,2);
  assert.equal(report.schema,'bw.i80386-register-stack-admission.v1');
  assert.deepEqual(report.modes.real.runLengthHistogram,{'2':1});
  assert.equal(report.modes.real.admittedFormCounts['54:-/-/-:o16:a16:-:ram-write'],1);
  assert.equal(report.modes.real.admittedFormCounts['5b:-/-/-:o16:a16:-:ram-read'],1);
  assert.throws(()=>createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true,registerStackAdmission:true}),
  /separate observer variant/);
});

test('VM86 66 PUSH ESP uses entry dword on a 16-bit stack',()=>{
  const machine=fixture([0x66,0x54,0x66,0x5b]);
  machine.cpu.cr0=1;machine.cpu.eflags=0x20002;
  machine.cpu.esp=0x12340100;
  const report=observe(machine,2);
  assert.equal(machine.cpu.ebx,0x12340100);
  assert.equal(report.modes.vm86.admittedOrdinals,2);
  assert.deepEqual(report.modes.vm86.runLengthHistogram,{'2':1});
});

test('protected32 POP ESP loads the stack value after its read',()=>{
  const machine=fixture([0x5c]);
  machine.cpu.cr0=1;
  machine.cpu.segmentCaches[1].default32=true;
  machine.cpu.segmentCaches[1].limit=0xffffffff;
  machine.cpu.segmentCaches[2].default32=true;
  machine.cpu.segmentCaches[2].limit=0xffffffff;
  machine.mem.set([0x78,0x56,0x34,0x12],0x20100);
  const report=observe(machine,1);
  assert.equal(machine.cpu.esp,0x12345678);
  assert.equal(report.modes.protected32.admittedOrdinals,1);
});

test('data page crossing and external events keep stack runs separate',()=>{
  const crossing=fixture([0x50]);
  crossing.cpu.sp=0x1001;
  crossing.cpu.segmentCaches[2].base=0x20000;
  const refused=observe(crossing,1);
  assert.equal(refused.modes.real.refusals['data-page-crossing'],1);
  const machine=fixture([0x50,0x58]);
  const observer=createI80386CrossModePotentialTraceObserver({
    registerStackAdmission:true});
  const restore=observer.attach(machine);
  observer.observe(machine);machine.step();observer.retired(machine);
  observer.externalEvent();
  observer.observe(machine);machine.step();observer.retired(machine);
  restore();
  const mode=observer.report().registerStackPotential.modes.real;
  assert.deepEqual(mode.runLengthHistogram,{'1':2});
  assert.equal(mode.runEndReasons['external-event'],1);
});

test('historical expanded observer keeps its schema and refuses register stack',()=>{
  const machine=fixture([0x50,0x58]);
  const observer=createI80386CrossModePotentialTraceObserver({
    expandedGroupedAdmission:true});
  const restore=observer.attach(machine);
  for(let i=0;i<2;i++){
    observer.observe(machine);machine.step();observer.retired(machine);
  }
  restore();
  const report=observer.report().expandedGroupedPotential;
  assert.equal(report.schema,'bw.i80386-expanded-grouped-admission.v1');
  assert.equal(report.grammar,'typed-grouped-plus-owned-es-call-return.v1');
  assert.equal(report.modes.real.refusals['deferred-stack-state'],2);
});

test('new variant retains code/table write and identity cuts',()=>{
  const codeWrite=fixture([0x50]);
  codeWrite.cpu.segmentCaches[2].base=0x10000;
  const code=observe(codeWrite,1).modes.real;
  assert.equal(code.refusals['code-or-table-write'],1);
  assert.equal(code.typedCandidatesCutByGlobal['code-or-table-write'],1);

  const tableWrite=fixture([0x50]);
  tableWrite.cpu._translationTablePages.add(0x20);
  const table=observe(tableWrite,1).modes.real;
  assert.equal(table.refusals['code-or-table-write'],1);

  const machine=fixture([0x50,0x58]);
  const observer=createI80386CrossModePotentialTraceObserver({
    registerStackAdmission:true});
  const restore=observer.attach(machine);
  observer.observe(machine);machine.step();observer.retired(machine);
  machine.cpu.cr3=0x1000;
  observer.observe(machine);machine.step();observer.retired(machine);
  restore();
  const mode=observer.report().registerStackPotential.modes.real;
  assert.deepEqual(mode.runLengthHistogram,{'1':2});
  assert.equal(mode.runEndReasons['identity-change'],1);
});

test('a later faulting PUSH cannot extend the earlier retired run',()=>{
  const machine=fixture([0x50,0x50]);
  machine.cpu.sp=3;
  const observer=createI80386CrossModePotentialTraceObserver({
    registerStackAdmission:true});
  const restore=observer.attach(machine);
  observer.observe(machine);machine.step();observer.retired(machine);
  observer.observe(machine);
  try{machine.step();observer.retired(machine);}
  catch{observer.aborted(machine);}
  restore();
  const report=observer.report();
  assert.equal(report.registerStackPotential.modes.real.admittedOrdinals,1);
  assert.deepEqual(report.registerStackPotential.modes.real.runLengthHistogram,
    {'1':1});
  assert.equal(report.modes.real.faultExits,1);
});
