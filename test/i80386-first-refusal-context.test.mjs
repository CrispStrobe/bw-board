import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {classifyI80386FirstRefusalShape as shape} from
  '../src/experimental/i80386-first-refusal-shape.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';

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
    observer.observe(machine);
    try{machine.step();observer.retired(machine);}
    catch(error){observer.aborted(machine);throw error;}
  }
}
const eight=()=>Array(8).fill([0x3c,0]).flat();
const context=(mode,bytes,n,split=null)=>{
  const machine=fixture(mode,bytes);
  const observer=createI80386CrossModePotentialTraceObserver({
    formResolvedAdmission:true,firstRefusalContext:true});
  const restore=observer.attach(machine);
  if(split===null)steps(machine,observer,n);
  else{steps(machine,observer,split);observer.externalEvent();
    steps(machine,observer,n-split);}
  restore();
  return observer.report().formResolvedPotential.firstRefusalContext.modes[mode];
};

for(const mode of ['real','protected16','vm86','protected32']){
  test(`${mode} first refusal records both adjacent admitted runs`,()=>{
    const bucket=context(mode,[...eight(),0x90,...eight()],17);
    assert.equal(bucket.refusedOrdinals,1);
    assert.equal(bucket.followingResolved,1);
    assert.equal(bucket.bridgeAtLeast8,1);
    const [entry]=Object.values(bucket.records);
    assert.equal(entry.opcode,'90');
    assert.equal(entry.reason,'unsupported-opcode');
    assert.deepEqual(entry.precedingLengthHistogram,{'8':1});
    assert.deepEqual(entry.followingLengthHistogram,{'8':1});
  });
}

test('consecutive refusals resolve zero following and zero preceding distinctly',()=>{
  const bucket=context('protected16',[...eight(),0x90,0x90,...eight()],18);
  const [entry]=Object.values(bucket.records);
  assert.equal(bucket.refusedOrdinals,2);
  assert.deepEqual(entry.precedingLengthHistogram,{'0':1,'8':1});
  assert.deepEqual(entry.followingLengthHistogram,{'0':1,'8':1});
  assert.equal(entry.bridgeAtLeast8,0);
  assert.equal(entry.followingEndReasons['next-refusal'],1);
});

test('external event blocks following run association across the cut',()=>{
  const bucket=context('protected16',[...eight(),0x90,...eight()],17,9);
  const [entry]=Object.values(bucket.records);
  assert.deepEqual(entry.precedingLengthHistogram,{'8':1});
  assert.deepEqual(entry.followingLengthHistogram,{'0':1});
  assert.equal(entry.followingEndReasons['external-event'],1);
});

test('group /reg and observed register versus RAM access shape are separate',()=>{
  const register=shape([0x66,0x83,0xc0,0x01]);
  assert.equal(register.opcode,'83');
  assert.equal(register.prefixSignature,'66');
  assert.equal(register.operandWidth,32);
  assert.equal(register.modrm.reg,0);
  assert.equal(register.eaClass,'register');
  assert.equal(register.observedAccess,'none');
  const ram=shape([0x83,0x06,0x40,0x00,0x01],
    {dataReads:1,dataWrites:1});
  assert.equal(ram.modrm.mod,0);
  assert.equal(ram.modrm.reg,0);
  assert.equal(ram.eaClass,'mem16-disp16');
  assert.equal(ram.observedAccess,'ram-read+write');
  assert.notEqual(ram.shapeKey,register.shapeKey);
  const sib=shape([0x67,0x8e,0x84,0x8d,1,2,3,4],{dataReads:1});
  assert.equal(sib.modrm.sib.base,5);
  assert.equal(sib.eaClass,'mem32-sib-disp32');
});

test('stack, call, return, segment and FF forms expose only proved syntax',()=>{
  assert.equal(shape([0x50]).eaClass,'implicit-stack-or-control');
  assert.equal(shape([0xc3]).opcode,'c3');
  assert.equal(shape([0xe8,0,0]).opcode,'e8');
  assert.equal(shape([0x8e,0xd8]).modrm.reg,3);
  assert.equal(shape([0xff,0xd0]).modrm.reg,2);
  assert.equal(shape([0xff,0x10],{dataReads:1,dataWrites:1})
    .observedAccess,'ram-read+write');
  assert.equal(shape([0x0f,0xb6,0xc0]).opcode,'0fb6');
  assert.equal(shape([0x0f,0xb6,0xc0]).modrm.mod,3);
  assert.equal(shape([0x0f,0x77]).parseStatus,'not-declared-modrm');
});

test('ordinary group ADD retirement is a refusal with surrounding runs',()=>{
  const bucket=context('protected16',
    [...eight(),0x83,0xc0,1,...eight()],17);
  const [entry]=Object.values(bucket.records);
  assert.equal(entry.reason,'unsupported-group-extension');
  assert.equal(entry.modrm.mod,3);
  assert.equal(entry.modrm.reg,0);
  assert.equal(entry.eaClass,'register');
  assert.equal(entry.bridgeAtLeast8,1);
});

test('ordinary RAM group ADD reports extension, EA and observed read/write',()=>{
  const machine=fixture('protected16',
    [...eight(),0x83,0x06,0x40,0x00,1,...eight()]);
  machine.mem[0x20040]=7;
  const observer=createI80386CrossModePotentialTraceObserver({
    formResolvedAdmission:true,firstRefusalContext:true});
  const restore=observer.attach(machine);
  steps(machine,observer,17);restore();
  const bucket=observer.report().formResolvedPotential.firstRefusalContext
    .modes.protected16;
  const [entry]=Object.values(bucket.records);
  assert.equal(entry.reason,'unsupported-group-extension');
  assert.equal(entry.modrm.reg,0);
  assert.equal(entry.eaClass,'mem16-disp16');
  assert.equal(entry.observedAccess,'ram-read+write');
  assert.equal(entry.bridgeAtLeast8,1);
  assert.equal(machine.mem[0x20040],8);
});
