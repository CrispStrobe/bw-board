import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {classifyI80386FirstRefusalShape as shape,
  isI80386GroupedRefusalTarget} from
  '../src/experimental/i80386-first-refusal-shape.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';

const eight=()=>Array(8).fill([0x3c,0]).flat();
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
function observe(mode,bytes,n,split=null){
  const machine=fixture(mode,bytes);
  const observer=createI80386CrossModePotentialTraceObserver({
    groupedShadowAdmission:true,groupedFirstRefusalContext:true});
  const restore=observer.attach(machine);
  for(let i=0;i<n;i++){
    observer.observe(machine);
    try{machine.step();observer.retired(machine);}
    catch(error){observer.aborted(machine);throw error;}
    if(i===split)observer.externalEvent();
  }
  restore();
  return observer.report().groupedShadowPotential;
}

test('target syntax keeps prefixes, 0F secondary, ModR/M and observed access distinct',()=>{
  const segment=shape([0x67,0x8e,0x84,0x8d,1,2,3,4],{dataReads:1});
  assert.equal(segment.opcode,'8e');
  assert.equal(segment.prefixSignature,'67');
  assert.equal(segment.addressWidth,32);
  assert.equal(segment.modrm.reg,0);
  assert.equal(segment.eaClass,'mem32-sib-disp32');
  assert.equal(segment.observedAccess,'ram-read');
  assert.equal(isI80386GroupedRefusalTarget(segment),true);
  const register=shape([0xff,0xd0]);
  const ram=shape([0xff,0x10],{dataReads:1,dataWrites:1});
  assert.equal(register.modrm.reg,2);
  assert.equal(register.eaClass,'register');
  assert.equal(ram.modrm.reg,2);
  assert.equal(ram.eaClass,'mem16-disp0');
  assert.notEqual(register.shapeKey,ram.shapeKey);
  assert.equal(shape([0x0f,0xb6,0xc0]).opcode,'0fb6');
  assert.equal(shape([0x0f,0xb6,0xc0]).modrm.mod,3);
  assert.equal(shape([0x0f,0x77]).parseStatus,'not-declared-modrm');
  assert.equal(shape([0x66,0xc1,0xe0,1]).modrm.reg,4);
  for(const opcode of [0x06,0x07,0x50,0x5f,0xe8,0xc2,0xc3,0xca,0xcb]){
    const item=shape([opcode]);
    assert.equal(isI80386GroupedRefusalTarget(item),true);
    assert.equal(item.eaClass,'implicit-stack-or-control');
  }
  assert.equal(isI80386GroupedRefusalTarget(shape([0x90])),false);
});

for(const mode of ['real','protected16','vm86','protected32']){
  test(`${mode} groups one C1 refusal with adjacent disjoint runs`,()=>{
    const bytes=[...eight(),0xc1,0xe0,1,...eight()];
    const result=observe(mode,bytes,17);
    const bucket=result.firstRefusalContext.modes[mode];
    assert.equal(bucket.refusedOrdinals,1);
    assert.equal(bucket.selectedRefusals,1);
    assert.equal(bucket.unselectedRefusals,0);
    assert.equal(bucket.bridgeAtLeast8,1);
    const [record]=Object.values(bucket.records);
    assert.equal(record.opcode,'c1');
    assert.equal(record.modrm.reg,4);
    assert.deepEqual(record.precedingLengthHistogram,{'8':1});
    assert.deepEqual(record.followingLengthHistogram,{'8':1});
  });
}

test('non-target refusal is partitioned but does not create a shape record',()=>{
  const result=observe('protected16',[...eight(),0x90,...eight()],17);
  const bucket=result.firstRefusalContext.modes.protected16;
  assert.equal(bucket.refusedOrdinals,1);
  assert.equal(bucket.selectedRefusals,0);
  assert.equal(bucket.unselectedRefusals,1);
  assert.deepEqual(bucket.records,{});
});

test('external event severs the following run at zero length',()=>{
  const result=observe('protected16',[...eight(),0xc1,0xe0,1,...eight()],17,8);
  const [record]=Object.values(result.firstRefusalContext.modes.protected16.records);
  assert.deepEqual(record.precedingLengthHistogram,{'8':1});
  assert.deepEqual(record.followingLengthHistogram,{'0':1});
  assert.equal(record.followingEndReasons['external-event'],1);
});

test('a prior non-target refusal gives the selected refusal zero preceding run',()=>{
  const result=observe('protected16',[...eight(),0x90,0xc1,0xe0,1,...eight()],18);
  const bucket=result.firstRefusalContext.modes.protected16;
  assert.equal(bucket.refusedOrdinals,2);
  assert.equal(bucket.selectedRefusals,1);
  assert.equal(bucket.unselectedRefusals,1);
  const [record]=Object.values(bucket.records);
  assert.deepEqual(record.precedingLengthHistogram,{'0':1});
  assert.deepEqual(record.followingLengthHistogram,{'8':1});
});

test('ordinary 0F register retirement records secondary opcode and successor',()=>{
  const result=observe('protected16',
    [...eight(),0x0f,0xb6,0xc0,...eight()],17);
  const [record]=Object.values(result.firstRefusalContext.modes.protected16.records);
  assert.equal(record.opcode,'0fb6');
  assert.equal(record.modrm.mod,3);
  assert.deepEqual(record.precedingLengthHistogram,{'8':1});
  assert.deepEqual(record.followingLengthHistogram,{'8':1});
});

test('ordinary segment-cache change cuts following admission association',()=>{
  const result=observe('real',[...eight(),0x8e,0xd8,...eight()],17);
  const [record]=Object.values(result.firstRefusalContext.modes.real.records);
  assert.equal(record.opcode,'8e');
  assert.equal(record.modrm.reg,3);
  assert.deepEqual(record.precedingLengthHistogram,{'8':1});
  assert.deepEqual(record.followingLengthHistogram,{'0':1});
  assert.equal(record.followingEndReasons['refusal-side-exit'],1);
});

test('diagnostic leaves ordinary CPU, segment cache and RAM state unchanged',()=>{
  const bytes=[...eight(),0x8e,0xd8,...eight()];
  const observed=fixture('real',bytes),baseline=fixture('real',bytes);
  const observer=createI80386CrossModePotentialTraceObserver({
    groupedShadowAdmission:true,groupedFirstRefusalContext:true});
  const restore=observer.attach(observed);
  for(let i=0;i<17;i++){
    observer.observe(observed);observed.step();observer.retired(observed);
    baseline.step();
  }
  restore();
  assert.equal(observed.cpu.eip,baseline.cpu.eip);
  assert.equal(observed.cpu.eflags,baseline.cpu.eflags);
  assert.equal(observed.cpu.cycles,baseline.cpu.cycles);
  assert.deepEqual(observed.cpu.segmentCaches,baseline.cpu.segmentCaches);
  assert.deepEqual(observed.mem.subarray(0x10020,0x10060),
    baseline.mem.subarray(0x10020,0x10060));
});
