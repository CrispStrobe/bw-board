import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {createI80386RamBridge} from '../src/experimental/i80386-ram-bridge.js';
import {createI80386DynamicMemorySpike} from
  '../src/experimental/i80386-dynamic-memory-spike.js';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from
  '../src/experimental/i80386-at-machine.js';

const CODE = 0x80120000, A = 0x80130000, B = 0x80140000;
const CODE_PHYS = 0x120000, A_PHYS = 0x130000, B_PHYS = 0x140000;
const LOAD_CHAIN = [0x8b, 0x03, 0x8b, 0x08]; // MOV EAX,[EBX]; MOV ECX,[EAX]
const STORE = [0x89, 0x03]; // MOV [EBX],EAX

async function fixture({shared = false, code = LOAD_CHAIN, mapB = true,
  primeB = true, dirtyA = false, adjacentB = false} = {}) {
  const machine = new ExperimentalI80386ATMachine(
    PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32 = (address, value) => {
    for (let i=0;i<4;i++) machine._write386(address+i,(value >>> (8*i)) & 255);
  };
  put32(0x1800, 0x4007);
  for (const [linear, physical] of [[CODE,CODE_PHYS],[A,A_PHYS],
    ...(mapB ? [[B,B_PHYS]] : []),
    ...(adjacentB ? [[A+4096,B_PHYS]] : [])])
    put32(0x4000+((linear>>>12)&1023)*4,physical|7);
  code.forEach((byte,i) => machine._write386(CODE_PHYS+i,byte));
  put32(A_PHYS,B);
  put32(B_PHYS,0x12345678);
  const cpu=machine.cpu;
  for (const segment of [0,2,3]) cpu.segmentCaches[segment] = {
    base:0,limit:0xffffffff,default32:true,present:true,code:false,
    readable:true,writable:true};
  cpu.segmentCaches[1] = {base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.eip=CODE;cpu.ebx=A;
  cpu._translate(CODE);
  cpu._translate(A,dirtyA ? {write:true} : undefined);
  if (mapB && primeB) cpu._translate(B);
  machine._chipDebt=0;machine._chipDeadline=1000;
  let bridge, runner;
  if (shared) {
    bridge=await createI80386RamBridge();bridge.attach(machine);
    runner=await createI80386DynamicMemorySpike(machine,bridge);
  }
  return {machine,cpu,runner,put32};
}
function state(machine) {
  const cpu=machine.cpu;
  return {eax:cpu.eax,ecx:cpu.ecx,edx:cpu.edx,ebx:cpu.ebx,
    eip:cpu.eip,eflags:cpu.eflags,cr2:cpu.cr2,
    cpuCycles:cpu.cycles,boardCycles:machine.cycles,chipDebt:machine._chipDebt,
    ramSha256:crypto.createHash('sha256').update(machine.mem).digest('hex')};
}

test('two dependent cached-page loads commit together and match ordinary 386',async()=>{
  const fast=await fixture({shared:true}),slow=await fixture();
  const block=fast.runner.decode(2);
  assert.deepEqual(block?.instructions.map(ins=>ins.op),[1,1]);
  assert.equal(fast.runner.mirrorCachedPage(A),true);
  assert.equal(fast.runner.mirrorCachedPage(B),true);
  assert.deepEqual(fast.runner.run(block,2),{instructions:2,reason:'done'});
  slow.machine.step();slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.ecx,0x12345678);
});

test('second dependent-page miss exits after first load, then JS performs its page walk',async()=>{
  const fast=await fixture({shared:true,primeB:false});
  const slow=await fixture({primeB:false});
  const block=fast.runner.decode(2);
  fast.runner.mirrorCachedPage(A);
  assert.equal(fast.runner.mirrorCachedPage(B),false);
  assert.deepEqual(fast.runner.run(block,2),
    {instructions:1,reason:'slow-exit'});
  slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.eip,CODE+2);
  assert.equal(fast.cpu.eax,B);
  assert.equal(fast.cpu.ecx,0);
  assert.notEqual(fast.cpu._translations[(B>>>12)&511]?.page,B>>>12);
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.ecx,0x12345678);
  assert.equal(fast.cpu._translations[(B>>>12)&511]?.page,B>>>12);
});

test('second dependent-page fault leaves first load committed and JS owns CR2',async()=>{
  const fast=await fixture({shared:true,mapB:false});
  const slow=await fixture({mapB:false});
  const block=fast.runner.decode(2);
  fast.runner.mirrorCachedPage(A);
  assert.deepEqual(fast.runner.run(block,2),
    {instructions:1,reason:'slow-exit'});
  slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.cr2,0);
  assert.equal(fast.cpu.eip,CODE+2);
  // Disable delivery so the underlying #PF is observable without needing an
  // unrelated IDT/stack setup in this two-instruction fixture.
  fast.cpu.deliverFaults=slow.cpu.deliverFaults=false;
  for (const cpu of [fast.cpu,slow.cpu])
    assert.throws(()=>cpu.step(),error=>error.vector===14);
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.cr2,B);
});

test('clean write exits before RAM or D-bit changes; ordinary step sets D',async()=>{
  const fast=await fixture({shared:true,code:STORE});
  const slow=await fixture({code:STORE});
  fast.cpu.eax=slow.cpu.eax=0xcafebabe;
  const block=fast.runner.decode(1);
  fast.runner.mirrorCachedPage(A);
  const before=state(fast.machine);
  assert.deepEqual(fast.runner.run(block,1),
    {instructions:0,reason:'slow-exit'});
  assert.deepEqual(state(fast.machine),before);
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu._translations[(A>>>12)&511].dirty,true);
  assert.equal(fast.machine._read386(A_PHYS),0xbe);
});

test('CPL0 mirror of supervisor page exits before CPL3 read or write #PF',async()=>{
  for (const {code,errorCode} of [
    {code:[0x8b,0x03],errorCode:5},
    {code:STORE,errorCode:7},
  ]) {
    const fast=await fixture({shared:true,code,dirtyA:true});
    const slow=await fixture({code,dirtyA:true});
    for (const cpu of [fast.cpu,slow.cpu]) {
      cpu._translations[(A>>>12)&511].userPage=false;
      cpu.eax=0xabcddcba;
    }
    // Mirror while still in CPL0. The subsequent CPL3 run must not inherit
    // supervisor access, even though no remirror occurs after the mode change.
    assert.equal(fast.cpu.currentPrivilegeLevel,0);
    assert.equal(fast.runner.mirrorCachedPage(A),true);
    for (const cpu of [fast.cpu,slow.cpu]) {
      cpu.cs=3;
      cpu.deliverFaults=false;
    }
    const block=fast.runner.decode(1);
    assert.ok(block);
    assert.equal(fast.runner.stats.mirrors,1);
    const before=state(fast.machine);
    assert.deepEqual(fast.runner.run(block,1),
      {instructions:0,reason:'slow-exit'});
    assert.deepEqual(state(fast.machine),before);
    for (const cpu of [fast.cpu,slow.cpu])
      assert.throws(()=>cpu.step(),error=>error.vector===14 &&
        error.errorCode===errorCode);
    assert.deepEqual(state(fast.machine),state(slow.machine));
    assert.equal(fast.cpu.cr2,A);
  }
});

test('dirty ordinary-RAM store matches JS and revokes on code/table-page registration',async()=>{
  const fast=await fixture({shared:true,code:STORE,dirtyA:true});
  const slow=await fixture({code:STORE,dirtyA:true});
  fast.cpu.eax=slow.cpu.eax=0xcafebabe;
  const block=fast.runner.decode(1);
  fast.runner.mirrorCachedPage(A);
  assert.deepEqual(fast.runner.run(block,1),{instructions:1,reason:'done'});
  slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));

  fast.cpu.eip=CODE;
  fast.runner.registerCachedCodePage(A_PHYS);
  const before=state(fast.machine);
  assert.deepEqual(fast.runner.run(block,1),
    {instructions:0,reason:'slow-exit'});
  assert.deepEqual(state(fast.machine),before);
  const other=await fixture({shared:true,code:STORE,dirtyA:true});
  other.cpu.eax=0x88776655;
  const otherBlock=other.runner.decode(1);
  other.runner.mirrorCachedPage(A);
  other.cpu._translationTablePages.add(A_PHYS>>>12);
  const old=state(other.machine);
  assert.deepEqual(other.runner.run(otherBlock,1),
    {instructions:0,reason:'slow-exit'});
  assert.deepEqual(state(other.machine),old);
});

test('event budget stops before the next dependent load',async()=>{
  const fast=await fixture({shared:true}),slow=await fixture();
  fast.machine._chipDeadline=slow.machine._chipDeadline=6;
  const block=fast.runner.decode(2);
  fast.runner.mirrorCachedPage(A);fast.runner.mirrorCachedPage(B);
  assert.deepEqual(fast.runner.run(block,2),{instructions:1,reason:'event'});
  slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.eip,CODE+2);
});

test('cross-page dword exits before the read and ordinary JS resolves both pages',async()=>{
  const fast=await fixture({shared:true,code:[0x8b,0x03],adjacentB:true});
  const slow=await fixture({code:[0x8b,0x03],adjacentB:true});
  for (const machine of [fast.machine,slow.machine]) {
    machine.cpu.ebx=A+4094;
    machine._write386(A_PHYS+4094,0x12);
    machine._write386(A_PHYS+4095,0x34);
    machine._write386(B_PHYS,0x56);
    machine._write386(B_PHYS+1,0x78);
  }
  const block=fast.runner.decode(1);
  fast.runner.mirrorCachedPage(A);fast.runner.mirrorCachedPage(B);
  const before=state(fast.machine);
  assert.deepEqual(fast.runner.run(block,1),
    {instructions:0,reason:'slow-exit'});
  assert.deepEqual(state(fast.machine),before);
  fast.machine.step();slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.eax,0x78563412);
});

test('remap, MMIO classification, and current-code-page stores cannot use stale mirrors',async()=>{
  const remap=await fixture({shared:true,code:[0x8b,0x03]});
  const block=remap.runner.decode(1);
  remap.runner.mirrorCachedPage(A);
  remap.put32(0x4000+((A>>>12)&1023)*4,B_PHYS|7);
  assert.deepEqual(remap.runner.run(block,1),
    {instructions:0,reason:'fallback'});
  assert.equal(remap.cpu.eax,0);

  const cr3=await fixture({shared:true,code:[0x8b,0x03]});
  const cr3Block=cr3.runner.decode(1);
  cr3.runner.mirrorCachedPage(A);
  cr3.cpu.cr3=0x2000;
  assert.deepEqual(cr3.runner.run(cr3Block,1),
    {instructions:0,reason:'fallback'});
  assert.equal(cr3.cpu.eax,0);

  const mmio=await fixture({shared:true,code:[0x8b,0x03]});
  mmio.machine._page[A_PHYS>>>12]=0;
  assert.equal(mmio.runner.mirrorCachedPage(A),false);
  assert.deepEqual(mmio.runner.run(mmio.runner.decode(1),1),
    {instructions:0,reason:'slow-exit'});

  const self=await fixture({shared:true,code:STORE});
  self.cpu.ebx=CODE;
  self.cpu.eax=0x12345678;
  self.cpu._translate(CODE,{write:true});
  const selfBlock=self.runner.decode(1);
  self.runner.mirrorCachedPage(CODE);
  const before=state(self.machine);
  assert.deepEqual(self.runner.run(selfBlock,1),
    {instructions:0,reason:'slow-exit'});
  assert.deepEqual(state(self.machine),before);
});

test('native store feeds a later same-page load and dependent next-page load',async()=>{
  // MOV [EBX],EAX; MOV EAX,[EBX]; MOV ECX,[EAX]
  const code=[0x89,0x03,0x8b,0x03,0x8b,0x08];
  const fast=await fixture({shared:true,code,dirtyA:true});
  const slow=await fixture({code,dirtyA:true});
  for (const machine of [fast.machine,slow.machine]) {
    machine.cpu.eax=B;
    machine._write386(A_PHYS,0);
  }
  const block=fast.runner.decode(3);
  assert.deepEqual(block?.instructions.map(ins=>ins.op),[2,1,1]);
  fast.runner.mirrorCachedPage(A);fast.runner.mirrorCachedPage(B);
  assert.deepEqual(fast.runner.run(block,3),
    {instructions:3,reason:'done'});
  for (let i=0;i<3;i++) slow.machine.step();
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.cpu.ecx,0x12345678);
  assert.equal(fast.machine._read386(A_PHYS),B&255);
});

test('bounded 128-call dependent-read workload equals 256 ordinary steps',async()=>{
  const fast=await fixture({shared:true}),slow=await fixture();
  const block=fast.runner.decode(2);
  fast.runner.mirrorCachedPage(A);fast.runner.mirrorCachedPage(B);
  fast.machine._chipDeadline=slow.machine._chipDeadline=2000;
  for (let i=0;i<128;i++) {
    fast.cpu.eip=slow.cpu.eip=CODE;
    fast.cpu.ebx=slow.cpu.ebx=A;
    assert.deepEqual(fast.runner.run(block,2),{instructions:2,reason:'done'});
    slow.machine.step();slow.machine.step();
  }
  assert.deepEqual(state(fast.machine),state(slow.machine));
  assert.equal(fast.runner.stats.retired,256);
  assert.equal(fast.runner.stats.mirrors,2);
  assert.equal(fast.runner.stats.validityChecks,256);
  assert.equal(state(fast.machine).ramSha256,
    'efa5c6f2dc0a798a35a0c477b803e5cec5794c9397af80770c6e2b8aeee9819c');
});
