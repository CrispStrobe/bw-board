import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {createI80386Native32Census} from '../src/experimental/i80386-native32-census.js';

const CODE=0x80120000,PHYSICAL=0x120000;
function fixture(code,physical=PHYSICAL){
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,value>>>(8*i)&255);
  };
  put32(0x1800,0x4007);
  put32(0x4000+0x120*4,physical|7);
  code.forEach((byte,i)=>machine._write386(physical+i,byte));
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
const state=machine=>({eax:machine.cpu.eax,eip:machine.cpu.eip,
  eflags:machine.cpu.eflags,cpuCycles:machine.cpu.cycles,
  cycles:machine.cycles,chipDebt:machine._chipDebt});

test('native32 census observes actual fetched opcode and ModRM with guest parity',()=>{
  const code=[0xb8,1,0,0,0,0x83,0xf8,2,0x75,0xf6];
  const measured=fixture(code),ordinary=fixture(code);
  const census=createI80386Native32Census();
  const restore=census.attach(measured);
  try{
    for(let i=0;i<3;i++){
      census.observe(measured);measured.step();census.retired(measured);
      ordinary.step();
    }
  }finally{restore();}
  assert.deepEqual(state(measured),state(ordinary));
  assert.deepEqual(measured.mem.slice(0x1000,0x5000),ordinary.mem.slice(0x1000,0x5000));
  const report=census.report();
  assert.equal(report.entryAttempts,3);
  assert.equal(report.sameEntryRetirements,3);
  assert.equal(report.completedCoreSteps+report.noRetirement,report.entryAttempts);
  assert.equal(report.codeWindowRefusedAttempts+report.decodeNullAttempts+
    report.singleCandidateAttempts+report.multiCandidateAttempts+
    report.repeatCandidateAttempts,report.entryAttempts);
  assert.equal(report.multiCandidateAttempts,2);
  assert.equal(report.singleCandidateAttempts,1);
  assert.equal(report.retiredOpcodes.b8,1);
  assert.equal(report.retiredModrmForms['83:m3:g7'],1);
  assert.equal(report.candidateCategoryByRetiredModrmForm['multi|83:m3:g7'],1);
  assert.equal(report.retiredOpcodes['75'],1);
  assert.equal(report.codeWindowRefusedAttempts,0);
});

test('native32 census reports unsupported first opcode without altering execution',()=>{
  const measured=fixture([0x40,0x90]),ordinary=fixture([0x40,0x90]);
  const census=createI80386Native32Census();
  const restore=census.attach(measured);
  try{census.observe(measured);measured.step();census.retired(measured);}
  finally{restore();}
  ordinary.step();
  assert.deepEqual(state(measured),state(ordinary));
  assert.deepEqual(measured.mem.slice(0x1000,0x5000),ordinary.mem.slice(0x1000,0x5000));
  assert.equal(census.report().decodeNullAttempts,1);
  assert.equal(census.report().nullByRetiredOpcode['40'],1);
});

test('native32 census observes fetched opcode when native RAM window refuses low memory',()=>{
  const measured=fixture([0x90],0x90000),ordinary=fixture([0x90],0x90000);
  const census=createI80386Native32Census();
  const restore=census.attach(measured);
  try{census.observe(measured);measured.step();census.retired(measured);}
  finally{restore();}
  ordinary.step();
  assert.deepEqual(state(measured),state(ordinary));
  assert.deepEqual(measured.mem.slice(0x1000,0x5000),ordinary.mem.slice(0x1000,0x5000));
  assert.equal(census.report().codeWindowRefusedAttempts,1);
  assert.equal(census.report().codeWindowRefusedByRetiredOpcode['90'],1);
});
