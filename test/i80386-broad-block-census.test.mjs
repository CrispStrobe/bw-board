import test from 'node:test';
import assert from 'node:assert/strict';
import {ExperimentalI80386ATMachine,
  PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP} from '../src/experimental/i80386-at-machine.js';
import {classifyI80386BroadForm,classifyI80386SelectedForm,
  createI80386BroadBlockCensus} from
  '../src/experimental/i80386-broad-block-census.js';

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

const observeSteps=(machine,census,count,between=()=>{})=>{
  const restore=census.attach(machine);
  try{
    for(let step=0;step<count;step++){
      between(step,machine,census);
      census.observe(machine);machine.step();census.retired(machine);
    }
  }finally{restore();}
  return census.report();
};

for(const [name,zf,outcome] of [['taken',false,'taken'],['fallthrough',true,'fallthrough']]){
  test(`linked JNZ joins observed ${name} successor without altering unlinked counts`,()=>{
    const code=[0x75,0x02,0x90,0xf4,0x90];
    const measured=fixture(code),ordinary=fixture(code);
    measured.cpu.eflags=(measured.cpu.eflags&~0x40)|(zf?0x40:0);
    ordinary.cpu.eflags=measured.cpu.eflags;
    const linked=observeSteps(measured,createI80386BroadBlockCensus({linkJcc:true}),2);
    const unlinked=observeSteps(ordinary,createI80386BroadBlockCensus(),2);
    assert.deepEqual(state(measured),state(ordinary));
    assert.deepEqual(linked.modes,unlinked.modes);
    const view=linked.jccLinkedPotential.modes.protected32;
    assert.equal(view.jccAttempts,1);
    assert.equal(view.jccOutcomes[outcome],1);
    assert.equal(view.jccJoined[outcome],1);
    assert.equal(view.successorPageByOutcome[`${outcome}:same`],1);
    assert.deepEqual(view.runLengthHistogram,{'2':1});
  });
}

test('linked near Jcc uses its observed 32-bit displacement',()=>{
  const machine=fixture([0x0f,0x85,1,0,0,0,0x90,0x90]);
  machine.cpu.eflags&=~0x40;
  const view=observeSteps(machine,createI80386BroadBlockCensus({linkJcc:true}),2)
    .jccLinkedPotential.modes.protected32;
  assert.equal(view.jccJoined.taken,1);
  assert.deepEqual(view.runLengthHistogram,{'2':1});
});

test('16-bit taken target wraps while fallthrough stays a full EIP',()=>{
  const machine=fixture([0x75,0xfe]);
  machine.cpu.segmentCaches[1]={...machine.cpu.segmentCaches[1],default32:false};
  machine.cpu.eflags&=~0x40;
  const view=observeSteps(machine,createI80386BroadBlockCensus({linkJcc:true}),1)
    .jccLinkedPotential.modes.protected16;
  assert.equal(machine.cpu.eip,0);
  assert.equal(view.jccOutcomes.taken,1);
  assert.equal(view.jccRefusals['end-of-observation'],1);
});

test('linked view refuses an external event and a redirected successor',()=>{
  const code=[0x75,0,0x90,0x90];
  const external=fixture(code);
  const externalView=observeSteps(external,createI80386BroadBlockCensus({linkJcc:true}),2,
    (step,_machine,census)=>{if(step===1)census.externalEvent();})
    .jccLinkedPotential.modes.protected32;
  assert.equal(externalView.jccRefusals['external-event'],1);
  assert.deepEqual(externalView.runLengthHistogram,{'1':2});
  const redirected=fixture(code);
  const redirectView=observeSteps(redirected,createI80386BroadBlockCensus({linkJcc:true}),2,
    (step,machine)=>{if(step===1)machine.cpu.eip++;})
    .jccLinkedPotential.modes.protected32;
  assert.equal(redirectView.jccRefusals['nonsequential-entry'],1);
  assert.equal(redirectView.jccJoined.taken??0,0);
});

test('linked view refuses page and mode boundaries after observed Jcc',()=>{
  const crossing=fixture([0x75,0,0x90],0xffe);
  const pageView=observeSteps(crossing,createI80386BroadBlockCensus({linkJcc:true}),2)
    .jccLinkedPotential.modes.protected32;
  assert.equal(pageView.successorPages.cross,1);
  assert.equal(pageView.jccRefusals['linear-page-change'],1);
  const mode=fixture([0x75,0,0x90]);
  const modeReport=observeSteps(mode,createI80386BroadBlockCensus({linkJcc:true}),2,
    (step,machine)=>{
      if(step===1)machine.cpu.segmentCaches[1]={...machine.cpu.segmentCaches[1],default32:false};
    }).jccLinkedPotential;
  assert.equal(modeReport.modes.protected32.jccRefusals['mode-change'],1);
  assert.equal(modeReport.modes.protected16.potentialSteps,1);
});

test('linked view refuses prefixed Jcc, CS-cache identity change, and due chip event',()=>{
  const prefixed=fixture([0x66,0x75,0,0x90]);
  const prefixView=observeSteps(prefixed,createI80386BroadBlockCensus({linkJcc:true}),2)
    .jccLinkedPotential.modes.protected32;
  assert.equal(prefixView.jccRefusals['prefixed-jcc'],1);
  const cache=fixture([0x75,0,0x90]);
  const cacheView=observeSteps(cache,createI80386BroadBlockCensus({linkJcc:true}),2,
    (step,machine)=>{
      if(step===1)machine.cpu.segmentCaches[1]={...machine.cpu.segmentCaches[1]};
    }).jccLinkedPotential.modes.protected32;
  assert.equal(cacheView.jccRefusals['identity-change'],1);
  const event=fixture([0x75,0,0x90]);
  const eventView=observeSteps(event,createI80386BroadBlockCensus({linkJcc:true}),2,
    (step,machine)=>{if(step===1)machine._chipDeadline=machine._chipDebt;})
    .jccLinkedPotential.modes.protected32;
  assert.equal(eventView.jccRefusals['chip-event-due'],1);
});

test('linked run histograms and >=4/>=8 tails partition potential steps',()=>{
  const code=[0x90,0x90,0x75,0,0x90,0x90,0x90,0x90,0x90,0x90];
  const report=observeSteps(fixture(code),createI80386BroadBlockCensus({linkJcc:true}),9);
  const view=report.jccLinkedPotential.modes.protected32;
  assert.equal(view.potentialSteps,9);
  assert.equal(view.runs,1);
  assert.deepEqual(view.runLengthHistogram,{'9':1});
  assert.equal(view.runsAtLeast4,1);
  assert.equal(view.stepsInRunsAtLeast4,9);
  assert.equal(view.runsAtLeast8,1);
  assert.equal(view.stepsInRunsAtLeast8,9);
  assert.equal(Object.entries(view.runLengthHistogram).reduce((n,[length,count])=>n+length*count,0),
    view.potentialSteps);
  assert.equal(Object.values(view.jccJoined).reduce((n,count)=>n+count,0)+
    Object.values(view.jccRefusals).reduce((n,count)=>n+count,0),view.jccAttempts);
});

test('refusal opcode view records bounded prefix and fetched group forms with parity',()=>{
  const code=[0x26,0xf6,0xc0,0x01,0x66,0xff,0xc0,0x0f,0xb6,0xc0];
  const measured=fixture(code),ordinary=fixture(code);
  const census=createI80386BroadBlockCensus({refusalOpcodes:true});
  const report=observeSteps(measured,census,3);
  for(let step=0;step<3;step++)ordinary.step();
  assert.deepEqual(state(measured),state(ordinary));
  const mode=report.modes.protected32;
  const hist=report.refusalOpcodeHistograms.modes.protected32;
  assert.equal(mode.firstRefusals['unsupported-opcode'],2);
  assert.equal(mode.firstRefusals['unsupported-0f'],1);
  assert.deepEqual(hist.unsupportedFirstOpcode,{f6:1,ff:1,'0f':1});
  assert.deepEqual(hist.unsupported0fSecondOpcode,{b6:1});
  assert.deepEqual(hist.unsupportedPrefixedForm,{'26:f6':1,'66:ff':1,'-:0fb6':1});
  assert.deepEqual(hist.unsupportedGroupExtension,{'f6/0':1,'ff/0':1});
  assert.equal(Object.values(hist.unsupportedFirstOpcode).reduce((a,b)=>a+b,0),
    mode.firstRefusals['unsupported-opcode']+mode.firstRefusals['unsupported-0f']);
});

test('Jcc successor refusal histograms partition linked reasons without changing old views',()=>{
  for(const [code,reason,first,second,group] of [
    [[0x75,0,0x0f,0xb6,0xc0],'unsupported-0f','0f','b6',null],
    [[0x75,0,0xf6,0xd0],'unsupported-opcode','f6',null,'f6/2'],
  ]){
    const measured=fixture(code),ordinary=fixture(code);
    const withHist=observeSteps(measured,
      createI80386BroadBlockCensus({linkJcc:true,refusalOpcodes:true}),2);
    const withoutHist=observeSteps(ordinary,
      createI80386BroadBlockCensus({linkJcc:true}),2);
    assert.deepEqual(state(measured),state(ordinary));
    assert.deepEqual(withHist.modes,withoutHist.modes);
    assert.deepEqual(withHist.jccLinkedPotential,withoutHist.jccLinkedPotential);
    const linked=withHist.jccLinkedPotential.modes.protected32;
    const hist=withHist.refusalOpcodeHistograms.modes.protected32;
    assert.equal(linked.jccRefusals[reason],1);
    assert.equal(hist.jccSuccessorFirstOpcode[first],1);
    if(second)assert.equal(hist.jccSuccessor0fSecondOpcode[second],1);
    if(group)assert.equal(hist.jccSuccessorGroupExtension[group],1);
  }
});

test('refusal opcode options must be booleans',()=>{
  assert.throws(()=>createI80386BroadBlockCensus({refusalOpcodes:1}),TypeError);
  assert.throws(()=>createI80386BroadBlockCensus({linkJcc:'yes'}),TypeError);
  assert.throws(()=>createI80386BroadBlockCensus({selectedFormsPotential:1}),TypeError);
});

test('selected scenario admits exactly its observed forms and requires group ModR/M',()=>{
  for(const [bytes,key] of [
    [[0x3a,0xe0],'3a'],[[0x3c,1],'3c'],[[0x24,1],'24'],
    [[0x66,0x3d,1,0],'3d'],[[0x05,1,0,0,0],'05'],
    [[0x25,1,0,0,0],'25'],[[0xa8,1],'a8'],[[0x84,0xe0],'84'],
    [[0xf6,0xc4,1],'f6/0'],[[0x66,0xf7,0xc4,1,0],'f7/0'],
    [[0x0f,0xb6,0xc4],'0fb6'],[[0x0f,0xb7,0xc0],'0fb7'],
  ])assert.equal(classifyI80386SelectedForm(bytes),key);
  for(const bytes of [[0xf6],[0xf7],[0x3a],[0x84],[0x0f,0xb6],
    [0x0f,0xb7],[0xff,0xc0],[0x0f,0xb3,0xc0],
    ...Array.from({length:7},(_,index)=>[0xf6,0xc0+8*(index+1)]),
    ...Array.from({length:7},(_,index)=>[0xf7,0xc0+8*(index+1)])])
    assert.equal(classifyI80386SelectedForm(bytes),null);
});

test('selected scenario joins Jcc to new form while old views and guest stay equal',()=>{
  const code=[0x75,0,0x3c,1,0x24,1,0xa8,1,0x90];
  const measured=fixture(code),ordinary=fixture(code);
  measured.cpu.eflags|=0x40;ordinary.cpu.eflags|=0x40;
  const selected=observeSteps(measured,createI80386BroadBlockCensus({
    linkJcc:true,refusalOpcodes:true,selectedFormsPotential:true}),5);
  const baseline=observeSteps(ordinary,createI80386BroadBlockCensus({
    linkJcc:true,refusalOpcodes:true}),5);
  assert.deepEqual(state(measured),state(ordinary));
  assert.deepEqual(measured.mem.slice(0x1000,0x5000),ordinary.mem.slice(0x1000,0x5000));
  assert.deepEqual(selected.modes,baseline.modes);
  assert.deepEqual(selected.jccLinkedPotential,baseline.jccLinkedPotential);
  assert.deepEqual(selected.refusalOpcodeHistograms,baseline.refusalOpcodeHistograms);
  const view=selected.selectedFormsPotential.modes.protected32;
  assert.equal(view.potentialSteps,5);
  assert.equal(view.addedSteps,3);
  assert.deepEqual(view.addedForms,{'3c':1,'24':1,a8:1});
  assert.equal(view.jccJoined.ambiguous,1);
  assert.deepEqual(view.runLengthHistogram,{'5':1});
  assert.equal(view.runsAtLeast4,1);
  assert.equal(view.stepsInRunsAtLeast4,5);
  assert.equal(Object.entries(view.runLengthHistogram).reduce((n,[length,count])=>
    n+Number(length)*count,0),view.potentialSteps);
  assert.equal(Object.values(view.addedForms).reduce((n,count)=>n+count,0),view.addedSteps);
  assert.equal(Object.values(view.jccJoined).reduce((n,count)=>n+count,0)+
    Object.values(view.jccRefusals).reduce((n,count)=>n+count,0),view.jccAttempts);
});

test('selected scenario excludes REP and LOCK while tracking no-retirement break',()=>{
  assert.equal(classifyI80386BroadForm([0xf3,0x3c,1]).reason,'repeat-non-string');
  assert.equal(classifyI80386BroadForm([0xf0,0x24,1]).reason,'lock-prefix');
  for(const code of [[0xf3,0x3c,1],[0xf0,0x24,1]]){
    const machine=fixture(code);
    const report=observeSteps(machine,createI80386BroadBlockCensus({
      selectedFormsPotential:true}),1);
    assert.equal(report.selectedFormsPotential.modes.protected32.addedSteps,0);
  }
  const idle=fixture([0x90]);
  const census=createI80386BroadBlockCensus({selectedFormsPotential:true});
  const restore=census.attach(idle);
  try{
    census.observe(idle);idle.step();census.retired(idle);
    census.observe(idle);census.retired(idle);
  }finally{restore();}
  assert.equal(census.report().modes.protected32.noRetirement,1);
  assert.equal(census.report().selectedFormsPotential.modes.protected32.runEndReasons['no-retirement'],1);
});

test('selected high-byte register forms preserve ordinary execution',()=>{
  const code=[0x3a,0xe0,0x84,0xe0,0xf6,0xc4,1,0x0f,0xb6,0xc4];
  const measured=fixture(code),ordinary=fixture(code);
  measured.cpu.eax=0x1234;ordinary.cpu.eax=0x1234;
  const report=observeSteps(measured,createI80386BroadBlockCensus({
    selectedFormsPotential:true}),4);
  for(let i=0;i<4;i++)ordinary.step();
  assert.deepEqual(state(measured),state(ordinary));
  const view=report.selectedFormsPotential.modes.protected32;
  assert.deepEqual(view.addedForms,{'3a':1,'84':1,'f6/0':1,'0fb6':1});
  assert.equal(view.potentialSteps,4);
});

test('selected Jcc view refuses observed event, redirect, page and mode changes',()=>{
  for(const [name,code,offset,between,reason] of [
    ['event',[0x75,0,0x3c,1],0,(step,_machine,census)=>{
      if(step===1)census.externalEvent();},'external-event'],
    ['redirect',[0x75,0,0x90,0x90,0x3c,1],0,(step,machine)=>{
      if(step===1)machine.cpu.eip++;},'nonsequential-entry'],
    ['page',[0x75,0,0x3c,1],0xffe,()=>{},'linear-page-change'],
    ['mode',[0x75,0,0x3c,1],0,(step,machine)=>{
      if(step===1)machine.cpu.segmentCaches[1]={
        ...machine.cpu.segmentCaches[1],default32:false};},'mode-change'],
  ]){
    const report=observeSteps(fixture(code,offset),createI80386BroadBlockCensus({
      selectedFormsPotential:true}),2,between).selectedFormsPotential;
    assert.equal(report.modes.protected32.jccRefusals[reason],1,name);
    assert.equal(report.modes.protected32.jccJoined.ambiguous??0,0,name);
  }
});
