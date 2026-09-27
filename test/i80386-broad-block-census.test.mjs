import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {classifyI80386BroadForm,createI80386BroadBlockCensus} from
  '../src/experimental/i80386-broad-block-census.js';

const CODE=0x80120000,PHYSICAL=0x120000;
function fixture(code){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,value>>>(8*i)&255);
  };
  put32(0x1800,0x4007);
  put32(0x4000+0x120*4,PHYSICAL|7);
  code.forEach((byte,i)=>machine._write386(PHYSICAL+i,byte));
  const cpu=machine.cpu;
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.eip=CODE;
  cpu._translate(CODE);
  machine._chipDebt=0;machine._chipDeadline=1000;
  return machine;
}
const state=machine=>({eax:machine.cpu.eax,ebx:machine.cpu.ebx,eip:machine.cpu.eip,
  eflags:machine.cpu.eflags,cpuCycles:machine.cpu.cycles,
  cycles:machine.cycles,chipDebt:machine._chipDebt});

test('broad census classifies a deliberately limited observed grammar',()=>{
  assert.deepEqual(classifyI80386BroadForm([0x26,0x89,0x07]),{kind:'linear'});
  assert.deepEqual(classifyI80386BroadForm([0xf3,0xa5]),{kind:'string-exit'});
  assert.deepEqual(classifyI80386BroadForm([0x0f,0x84,0,0,0,0]),{kind:'control-flow'});
  assert.deepEqual(classifyI80386BroadForm([0x8e,0xd8]),{reason:'unsupported-opcode'});
  assert.deepEqual(classifyI80386BroadForm([0xf0,0x89,0x07]),{reason:'lock-prefix'});
  assert.deepEqual(classifyI80386BroadForm([0xf3,0x90]),{reason:'repeat-non-string'});
});

test('broad census partitions completed steps and preserves guest state',()=>{
  // MOV immediate uses _fetchN's fast path; MOV register uses _fetch8.
  const code=[0xb8,1,0,0,0,0x89,0xc3,0x75,0,0x90,0xf4];
  const observed=fixture(code),ordinary=fixture(code),census=createI80386BroadBlockCensus();
  const restore=census.attach(observed);
  try{
    for(let step=0;step<5;step++){
      census.observe(observed);observed.step();census.retired(observed);
      ordinary.step();
    }
  }finally{restore();}
  assert.deepEqual(state(observed),state(ordinary));
  assert.deepEqual(observed.mem.slice(0x1000,0x5000),ordinary.mem.slice(0x1000,0x5000));
  const report=census.report().modes.protected32;
  assert.equal(report.entryAttempts,5);
  assert.equal(report.retiredSteps,5);
  assert.equal(report.potentialSteps+report.nonCandidateSteps,report.retiredSteps);
  assert.equal(report.potentialSteps,4);
  assert.equal(report.nonCandidateSteps,1);
  assert.deepEqual(report.runLengthHistogram,{'1':1,'3':1});
  assert.equal(report.runEndReasons['control-flow'],1);
  assert.equal(report.runEndReasons['unsupported-opcode'],1);
  assert.equal(report.firstRefusals['unsupported-opcode'],1);
  assert.equal(report.forms.linear,3);
  assert.equal(report.forms['control-flow'],1);
});

test('run budget closes runs without changing instruction execution',()=>{
  const observed=fixture([0x90,0x90,0x90]),census=createI80386BroadBlockCensus({maxRun:2});
  const restore=census.attach(observed);
  try{
    for(let step=0;step<3;step++){
      census.observe(observed);observed.step();census.retired(observed);
    }
  }finally{restore();}
  const report=census.report().modes.protected32;
  assert.deepEqual(report.runLengthHistogram,{'1':1,'2':1});
  assert.equal(report.runEndReasons['run-budget'],1);
  assert.equal(report.runEndReasons['end-of-observation'],1);
});
