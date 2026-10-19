import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,PCAT80386_EXPERIMENTAL_4M} from
  '../src/experimental/i80386-at-machine.js';
import {classifyI80386FormResolvedAdmission as classify} from
  '../src/experimental/i80386-form-resolved-admission.js';
import {createI80386CrossModePotentialTraceObserver} from
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js';

const form=(bytes,options={})=>classify(bytes,{startEip:0x20,
  postEip:0x20+bytes.length,...options});

test('prefix, ModR/M, SIB, displacement, width and access are resolved',()=>{
  const register=form([0x8b,0xc0]);
  assert.equal(register.reason,null);
  assert.equal(register.accessClass,'register');
  assert.equal(register.operandWidth,16);
  assert.equal(register.modrm.mod,3);
  assert.equal(form([0x8b,0xc0],{dataAccesses:1}).reason,
    'unexpected-memory-access');
  const ram=form([0x8b,0x07],{dataAccesses:1});
  assert.equal(ram.reason,null);
  assert.equal(ram.accessClass,'ram-read');
  assert.equal(ram.eaClass,'mem16-disp0');
  assert.notEqual(ram.formKey,register.formKey);
  const store=form([0x89,0x47,0x7f],{dataAccesses:1});
  assert.equal(store.accessClass,'ram-write');
  assert.equal(store.modrm.displacementBytes,1);
  assert.equal(form([0x89,0x47,0x7f],
    {dataAccesses:1,dataReads:1,dataWrites:0}).reason,
  'unproved-memory-access');
  const sib=form([0x2e,0x66,0x67,0x8b,0x84,0x8d,1,2,3,4],
    {dataAccesses:1});
  assert.equal(sib.reason,null);
  assert.equal(sib.operandWidth,32);
  assert.equal(sib.addressWidth,32);
  assert.equal(sib.modrm.sib.base,5);
  assert.equal(sib.modrm.displacementBytes,4);
  assert.equal(sib.prefixSignature,'2e/66/67');
  assert.equal(form([0x83,0xf8,0x01]).reason,null);
  assert.equal(form([0x83,0xc0,0x01]).reason,'unsupported-group-extension');
});

test('missing form bytes, unsafe data shape, and branch successor refuse',()=>{
  assert.equal(form([0x8b]).reason,'missing-modrm');
  assert.equal(form([0x67,0x8b,0x04]).reason,'missing-sib');
  assert.equal(form([0x67,0x8b,0x84,0x8d,1]).reason,'missing-displacement');
  assert.equal(form([0x81,0xf8,1]).reason,'missing-immediate');
  assert.equal(form([0x66,0x66,0x8b,0xc0]).reason,'duplicate-prefix');
  assert.equal(form([0x8b,0x07]).reason,'unproved-memory-access');
  assert.equal(form([0x8b,0x07],{dataAccesses:1,dataPageCrossing:true}).reason,
    'data-page-crossing');
  assert.equal(form([0xe4,0x21]).reason,'unproved-port-io');
  assert.equal(form([0xe4,0x21],{io:true}).reason,null);
  assert.equal(form([0x74,0x02],{postEip:0x24}).reason,null);
  assert.equal(form([0x74,0x02],{postEip:0x25}).reason,
    'unexpected-control-successor');
  assert.equal(form([0xeb,0x02],{postEip:0x22}).reason,
    'unexpected-control-successor');
  assert.equal(form([0x66,0x74,0x02]).reason,'prefixed-io-or-control');
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
for(const mode of ['real','protected16','vm86','protected32']){
  test(`${mode} typed form runs split at unsupported opcode and external event`,()=>{
    const bytes=[...Array(8).fill([0x3c,0]).flat(),0x90,
      ...Array(8).fill([0x3c,0]).flat()];
    const machine=fixture(mode,bytes),ordinary=fixture(mode,bytes);
    const observer=createI80386CrossModePotentialTraceObserver({
      formResolvedAdmission:true});
    const restore=observer.attach(machine);
    steps(machine,observer,8);observer.externalEvent();
    steps(machine,observer,9);restore();steps(ordinary,null,17);
    assert.equal(machine.cpu.eip,ordinary.cpu.eip);
    assert.equal(machine.cpu.eflags,ordinary.cpu.eflags);
    assert.equal(machine.cpu.cycles,ordinary.cpu.cycles);
    const typed=observer.report().formResolvedPotential;
    assert.deepEqual(typed.modes[mode].runLengthHistogram,{'8':2});
    assert.equal(typed.modes[mode].refusals['unsupported-opcode'],1);
    assert.equal(typed.modes[mode].runEndReasons['external-event'],1);
    assert.equal(typed.modes[mode].ordinalsInRunsAtLeast8,16);
    assert.equal(typed.modes[mode].admittedAccessClasses.register,16);
  });
}

test('observed RAM, branch and I/O classify with separate cuts',()=>{
  const bytes=[0x8b,0x07,0x74,0x02,0x3c,0,0xe4,0x21];
  const machine=fixture('protected16',bytes);
  machine.cpu.bx=0x40;machine.mem[0x20040]=0x12;
  const observer=createI80386CrossModePotentialTraceObserver({
    formResolvedAdmission:true});
  const restore=observer.attach(machine);
  steps(machine,observer,4);restore();
  const bucket=observer.report().formResolvedPotential.modes.protected16;
  assert.equal(bucket.admittedOrdinals,4);
  assert.equal(bucket.admittedAccessClasses['ram-read'],1);
  assert.equal(bucket.admittedAccessClasses.control,1);
  assert.equal(bucket.admittedAccessClasses['port-read'],1);
});

test('physical code-page identity cuts typed runs',()=>{
  const bytes=Array(20).fill([0x3c,0]).flat();
  const machine=fixture('protected16',bytes);
  const observer=createI80386CrossModePotentialTraceObserver({
    formResolvedAdmission:true});
  const restore=observer.attach(machine);
  steps(machine,observer,8);
  machine.cpu.segmentCaches[1].base=0x110000;
  machine.mem.set(Array(12).fill([0x3c,0]).flat(),0x110030);
  steps(machine,observer,8);
  restore();
  const bucket=observer.report().formResolvedPotential.modes.protected16;
  assert.equal(bucket.runEndReasons['code-page-change'],1);
  assert.equal(bucket.ordinalsInRunsAtLeast8,16);
});

test('pre-step chip horizon refuses an otherwise admitted form',()=>{
  const machine=fixture('protected16',[0x3c,0]);
  machine._chipDebt=machine._chipDeadline;
  const observer=createI80386CrossModePotentialTraceObserver({
    formResolvedAdmission:true});
  const restore=observer.attach(machine);
  steps(machine,observer,1);restore();
  const bucket=observer.report().formResolvedPotential.modes.protected16;
  assert.equal(bucket.refusals['pre-step-event-horizon'],1);
  assert.equal(bucket.admittedOrdinals,0);
});
