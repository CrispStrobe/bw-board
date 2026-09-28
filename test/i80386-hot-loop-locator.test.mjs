import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {createI80386HotLoopLocator,decodeObservedBackwardJcc} from
  '../src/experimental/i80386-hot-loop-locator.js';

const CODE=0x80120000,PHYSICAL=0x120000;
function fixture(code,entryOffset=0){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,value>>>(8*i)&255);
  };
  put32(0x1800,0x4007);
  put32(0x4000+0x120*4,PHYSICAL|7);
  put32(0x4000+0x121*4,(PHYSICAL+0x1000)|7);
  code.forEach((byte,i)=>machine._write386(PHYSICAL+entryOffset+i,byte));
  const cpu=machine.cpu;
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.eip=CODE+entryOffset;
  cpu._translate(cpu.eip);
  machine._chipDebt=0;machine._chipDeadline=1000;
  return machine;
}
const state=machine=>({eax:machine.cpu.eax,eip:machine.cpu.eip,
  eflags:machine.cpu.eflags,cpuCycles:machine.cpu.cycles,
  cycles:machine.cycles,chipDebt:machine._chipDebt});
const observe=(machine,locator,count,before=()=>{})=>{
  const restore=locator.attach(machine);
  try{for(let i=0;i<count;i++){
    before(i,machine,locator);locator.observe(machine);machine.step();locator.retired(machine);
  }}finally{restore();}
  return locator.report();
};

test('backward Jcc decoder keeps taken wrap and full fallthrough distinct',()=>{
  assert.deepEqual(decodeObservedBackwardJcc([0x75,0xfc],0x10000,false,0xfffe),
    {target:0xfffe,fallthrough:0x10002,outcome:'taken',displacement:-4});
  assert.equal(decodeObservedBackwardJcc([0x75,0xfc],0x10000,false,0x10002).outcome,
    'fallthrough');
  assert.equal(decodeObservedBackwardJcc([0x0f,0x85,0xf9,0xff,0xff,0xff],1,
    true,0).target,0);
  for(const bytes of [[0x66,0x75,0xfc],[0x75,0],[0x0f,0x85,0,0,0,0],
    [0x0f,0x85,0xf9,0xff]])
    assert.equal(decodeObservedBackwardJcc(bytes,0,true,0),null);
});

test('ordinary large-limit 16-bit untaken Jcc retains full fallthrough EIP',()=>{
  const machine=fixture([0x75,0xfd,0x90]);
  machine.cpu.segmentCaches[1]={...machine.cpu.segmentCaches[1],
    base:(CODE-0xfffe)>>>0,default32:false};
  machine.cpu.eip=0xfffe;machine.cpu.eflags|=0x40;
  const report=observe(machine,createI80386HotLoopLocator(),1);
  assert.equal(machine.cpu.eip,0x10000);
  assert.equal(report.modes.protected16.backwardJccFallthrough,1);
});

test('locator counts completed taken and exit traversals without guest change',()=>{
  const code=[0x90,0x75,0xfd],machine=fixture(code),ordinary=fixture(code);
  const locator=createI80386HotLoopLocator();
  const report=observe(machine,locator,6,(i,m)=>{if(i===5)m.cpu.eflags|=0x40;});
  for(let i=0;i<6;i++){if(i===5)ordinary.cpu.eflags|=0x40;ordinary.step();}
  assert.deepEqual(state(machine),state(ordinary));
  assert.deepEqual(machine.mem.slice(PHYSICAL,PHYSICAL+3),
    ordinary.mem.slice(PHYSICAL,PHYSICAL+3));
  const mode=report.modes.protected32;
  assert.equal(mode.entryAttempts,6);
  assert.equal(mode.completedSteps,6);
  assert.equal(mode.backwardJccTaken,2);
  assert.equal(mode.backwardJccFallthrough,1);
  assert.equal(mode.completedTraversals,2);
  assert.equal(mode.stepsInTraversals,4);
  assert.deepEqual(mode.traversalLengthHistogram,{'2':2});
  assert.equal(report.topCandidatesByMode.protected32[0].traversals,2);
  assert.deepEqual(report.topCandidatesByMode.protected32[0].outcomes,
    {taken:1,fallthrough:1});
});

test('observed branch mutation, identity and external event break traversal',()=>{
  const scenarios=[
    {name:'mutation',before:(i,m)=>{if(i===3)m._write386(PHYSICAL+1,0x74);},
      reason:'observed-code-mutation'},
    {name:'identity',before:(i,m)=>{if(i===2)m.cpu.segmentCaches[1].limit--;},
      reason:'identity-change'},
    {name:'event',before:(i,_m,l)=>{if(i===2)l.externalEvent();},
      reason:'external-event'},
    {name:'interrupt',before:(i,m)=>{if(i===2)m.hooks.onInterrupt({vector:8});},
      reason:'interrupt'},
  ];
  for(const item of scenarios){
    const report=observe(fixture([0x90,0x75,0xfd]),
      createI80386HotLoopLocator(),4,item.before);
    assert.equal(report.modes.protected32.breaks[item.reason],1,item.name);
    assert.equal(report.modes.protected32.completedTraversals,0,item.name);
  }
});

test('no-retirement and chip deadline break pending loop',()=>{
  const machine=fixture([0x90,0x75,0xfd]);
  const locator=createI80386HotLoopLocator(),restore=locator.attach(machine);
  try{
    for(let i=0;i<2;i++){locator.observe(machine);machine.step();locator.retired(machine);}
    locator.observe(machine);locator.retired(machine);
  }finally{restore();}
  assert.equal(locator.report().modes.protected32.noRetirement,1);
  assert.equal(locator.report().modes.protected32.breaks['no-retirement'],1);
  const due=fixture([0x90,0x75,0xfd]);
  const dueReport=observe(due,createI80386HotLoopLocator(),4,(i,m)=>{
    if(i===2)m._chipDeadline=m._chipDebt;
  });
  assert.equal(dueReport.modes.protected32.breaks['chip-event-due'],1);
});

test('candidate table stays bounded with exact aggregate traversal counts',()=>{
  const machine=fixture([0x90,0x75,0xfd,0x90,0x75,0xfd]);
  const report=observe(machine,createI80386HotLoopLocator({maxCandidates:1,
    reportTop:1}),8,(i,m)=>{if(i===4)m.cpu.eip=CODE+3;});
  assert.equal(report.modes.protected32.completedTraversals,2);
  assert.equal(report.topCandidatesByMode.protected32.length,1);
  assert.equal(report.candidateEvictions,1);
});

test('branch crossing the linear page is observed but cannot seed a traversal',()=>{
  const machine=fixture([0x75,0xfd],0xfff);
  machine.cpu.eflags&=~0x40;
  const report=observe(machine,createI80386HotLoopLocator(),1);
  const mode=report.modes.protected32;
  assert.equal(mode.backwardJccTaken,1);
  assert.equal(mode.backwardJccPageCrossing,1);
  assert.equal(mode.completedTraversals,0);
});
