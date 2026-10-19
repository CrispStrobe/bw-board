import test from 'node:test';
import assert from 'node:assert/strict';
import {createI80386NativeSuccessorCensus} from
  '../src/experimental/i80386-native-successor-census.js';
import {createI80386NativeDispatcher} from
  '../src/experimental/i80386-native-dispatch.js';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from
  '../src/experimental/i80386-at-machine.js';

function fixture() {
  const machine=new ExperimentalI80386ATMachine(
    PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP);
  const put32=(address,value)=>{
    for(let i=0;i<4;i++)machine._write386(address+i,(value>>>(8*i))&255);
  };
  put32(0x1800,0x4007);
  put32(0x4000+0x120*4,0x120007);
  [0xb8,1,0,0,0,0x83,0xf8,2,0x75,0xf6]
    .forEach((byte,i)=>machine._write386(0x120000+i,byte));
  const cpu=machine.cpu;
  cpu.segmentCaches[1]={base:0,limit:0xffffffff,default32:true,
    present:true,code:true,readable:true,writable:false};
  cpu.segmentCaches[3]={base:0,limit:0xffffffff,default32:true,
    present:true,code:false,readable:true,writable:true};
  cpu.cr0=0x80000001;cpu.cr3=0x1000;cpu.eip=0x80120000;
  cpu._translate(cpu.eip);
  machine._chipDebt=0;machine._chipDeadline=1000;
  return machine;
}

test('successor categories partition completed calls and preserve unknown ties',()=>{
  const census=createI80386NativeSuccessorCensus();
  const common={beforeCs:8,beforeEip:0x100,afterCs:8,afterEip:0x102,
    retired:2,sourceInstructions:2,sourceRegisterOnly:true,
    linkedInside:'none',successorStatus:'cached-valid-register-only',
    postChipDue:false,postLapicDue:false,
    limits:{caller:16,chip:40,lapic:64}};
  census.observe({...common,resultReason:'done'});
  census.observe({...common,resultReason:'event',retired:4,
    limits:{caller:16,chip:4,lapic:8},linkedInside:'taken-proven'});
  census.observe({...common,resultReason:'event',retired:3,
    limits:{caller:3,chip:3,lapic:8},successorStatus:'cold',
    linkedInside:'present-taken-unknown'});
  census.observe({...common,resultReason:'done',
    sourceRegisterOnly:false,successorStatus:'cached-code-or-window-unsafe'});
  const report=census.report();
  assert.equal(report.completedCalls,4);
  assert.equal(report.retiredInstructions,11);
  assert.deepEqual(report.exitReasons,{done:2,event:2});
  assert.deepEqual(report.nextPcRelations,{'same-cs-different-eip':4});
  assert.deepEqual(report.eventLimits,{'not-event':2,chip:1,'tie-unknown':1});
  assert.deepEqual(report.postEventStatus,{none:4});
  assert.equal(report.optimisticElidableCalls,1);
  assert.equal(report.firstTranche['source-memory-or-repeat'],1);
  assert.equal(report.firstTranche['exit-event'],2);
  assert.equal(report.withinBlockLinks['present-taken-unknown'],1);
  census.observe({...common,resultReason:'done',postChipDue:true});
  assert.equal(census.report().firstTranche['post-event-boundary'],1,
    'a completed block cannot hide an immediately due chip event');
});

test('opt-in dispatcher observes actual completed native EIP without guest change',async()=>{
  const observed=fixture(),plain=fixture();
  const census=createI80386NativeSuccessorCensus();
  const a=await createI80386NativeDispatcher(observed,
    {successorObserver:census});
  const b=await createI80386NativeDispatcher(plain);
  assert.equal(a.run(6),b.run(6));
  assert.deepEqual(a.stats,b.stats);
  assert.deepEqual({eip:observed.cpu.eip,eflags:observed.cpu.eflags,
    cycles:observed.cpu.cycles,boardCycles:observed.cycles},
  {eip:plain.cpu.eip,eflags:plain.cpu.eflags,
    cycles:plain.cpu.cycles,boardCycles:plain.cycles});
  const report=census.report();
  assert.equal(report.completedCalls,1);
  assert.equal(report.retiredInstructions,6);
  assert.deepEqual(report.exitReasons,{event:1});
  assert.deepEqual(report.nextPcRelations,{'same-cs-same-eip':1});
  assert.deepEqual(report.eventLimits,{caller:1});
  assert.deepEqual(report.withinBlockLinks,{'taken-proven':1});
  assert.equal(report.optimisticElidableCalls,0,
    'an existing linked loop at its caller budget is not a new trace edge');
});

test('cached successor is counted once and code edits revoke its eligibility',async()=>{
  const machine=fixture();
  const source=[0xb8,1,0,0,0,0x83,0xf8,2,0x75,6];
  const target=[0xb8,2,0,0,0,0x90,0xc3];
  source.forEach((byte,i)=>machine._write386(0x120000+i,byte));
  target.forEach((byte,i)=>machine._write386(0x120010+i,byte));
  const records=[];
  let recording=false;
  const dispatcher=await createI80386NativeDispatcher(machine,
    {successorObserver:{observe:record=>{if(recording)records.push(record);}}});
  machine.cpu.eip=0x80120010;
  assert.equal(dispatcher.run(2),2); // Populate this dispatcher's successor cache.
  machine.cpu.eip=0x80120000;
  recording=true;
  assert.equal(dispatcher.run(16),3);
  assert.equal(machine.cpu.eip,0x80120010);
  assert.equal(records[0].successorStatus,'cached-valid-register-only');
  assert.deepEqual([records[0].beforeEip,records[0].afterEip],
    [0x80120000,0x80120010]);

  machine._write386(0x120010,0x40); // A code write outside the source block.
  machine.cpu.eip=0x80120000;
  assert.equal(dispatcher.run(16),3);
  assert.equal(records[1].successorStatus,'cached-code-or-window-unsafe');
  const census=createI80386NativeSuccessorCensus();
  records.forEach(record=>census.observe(record));
  assert.equal(census.report().optimisticElidableCalls,1);
  assert.equal(census.report().firstTranche
    ['successor-cached-code-or-window-unsafe'],1);
});

test('actual chip and LAPIC budget exits are attributed separately',async()=>{
  for(const kind of ['chip','lapic']) {
    const machine=fixture();
    const charge=machine.functionalInstructionCycles;
    if(kind==='chip') machine._chipDeadline=2*charge-1;
    else {
      machine._lapicTimerInterval=100*charge;
      machine._lapicTimerNext=machine.cycles+2*charge-1;
    }
    const census=createI80386NativeSuccessorCensus();
    const dispatcher=await createI80386NativeDispatcher(machine,
      {successorObserver:census});
    assert.equal(dispatcher.run(16),2);
    assert.deepEqual(census.report().eventLimits,{[kind]:1});
  }
});
