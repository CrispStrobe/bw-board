import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386RamBridge} from '../src/experimental/i80386-ram-bridge.js';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {createI80386NativeByteRunner,isI80386NativeByteBlockValid} from
  '../src/experimental/i80386-native-byte-block.js';

const CODE=0x80120000, DATA=0x80130000;
const CODE_PHYS=0x120000, DATA_PHYS=0x130000;

async function fixture(shared) {
  const machine=new ExperimentalI80386ATMachine(PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  let bridge;
  if (shared) {bridge=await createI80386RamBridge();bridge.attach(machine);}
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,(value>>>(8*i))&255);
  };
  put32(0x1800,0x4007);
  put32(0x4000+0x120*4,CODE_PHYS|7);
  put32(0x4000+0x130*4,DATA_PHYS|7);
  // MOV EAX,[EBX+ECX*4+10h]; CMP EAX,EDX; JNZ back to MOV.
  for(const [i,v] of [0x8b,0x44,0x8b,0x10,0x39,0xd0,0x75,0xf8].entries())
    machine._write386(CODE_PHYS+i,v);
  put32(DATA_PHYS+24,0x12345679);
  const cpu=machine.cpu;
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.eip=CODE;
  cpu.ebx=DATA;cpu.ecx=2;cpu.edx=0x12345678;
  cpu._translate(CODE);cpu._translate(DATA+24);
  machine._chipDebt=0;machine._chipDeadline=100;
  return {machine,bridge,put32};
}

function state(machine) {
  const cpu=machine.cpu;
  return {eax:cpu.eax,ecx:cpu.ecx,edx:cpu.edx,ebx:cpu.ebx,
    eip:cpu.eip,eflags:cpu.eflags,cpuCycles:cpu.cycles,
    boardCycles:machine.cycles,chipDebt:machine._chipDebt};
}

test('real paged bytes execute a linked native loop with AT cycle accounting',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(block?.instructions.map(ins=>ins.op),[8,2,5]);
  assert.equal(isI80386NativeByteBlockValid(block),true);
  assert.deepEqual(runner.run(block,6),{instructions:6,cycles:36,reason:'event'});
  for(let i=0;i<6;i++)slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.machine.cpu.eip,CODE);

  fast.machine._write386(CODE_PHYS+5,0xc8); // Host edits the decoded CMP.
  assert.equal(isI80386NativeByteBlockValid(block),false);
  const before=state(fast.machine);
  assert.deepEqual(runner.run(block,6),{instructions:0,cycles:0,reason:'fallback'});
  assert.deepEqual(state(fast.machine),before);
});

test('native block exits at the same AT chip horizon as ordinary steps',async()=>{
  const fast=await fixture(true),slow=await fixture(false);
  fast.machine._chipDeadline=slow.machine._chipDeadline=7;
  const runner=await createI80386NativeByteRunner(fast.machine,fast.bridge);
  const block=runner.decode(8);
  assert.deepEqual(runner.run(block,8),{instructions:2,cycles:12,reason:'event'});
  slow.machine.step();slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  fast.machine.cpu.eflags|=0x100; // Single-step tracing uses the JS CPU.
  assert.deepEqual(runner.run(block,8),{instructions:0,cycles:0,reason:'fallback'});
});

test('page-table remap invalidates a previously decoded native load',async()=>{
  const {machine,bridge,put32}=await fixture(true);
  const runner=await createI80386NativeByteRunner(machine,bridge);
  const block=runner.decode(8);
  assert.equal(isI80386NativeByteBlockValid(block),true);
  put32(0x4000+0x130*4,0x140007);
  assert.equal(isI80386NativeByteBlockValid(block),false);
  assert.deepEqual(runner.run(block,8),{instructions:0,cycles:0,reason:'fallback'});
});
