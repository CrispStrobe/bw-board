import assert from 'node:assert/strict';
import test from 'node:test';
import {assertNativeSliceSelfParity} from '../scripts/bochs-cpu3-native-slice-compare.mjs';
import {failureProbe,parseArm} from '../scripts/run-bochs-cpu3-native-slice-compare.mjs';

const totalTicks=1040,faultTick=1030;
const portTicks=[1,1035,1036,1037,1038,1039,1040];
const marker='BHPG004';
const digest='a'.repeat(64);
const selectedState={eax:0x11223334,ecx:0,edx:0,ebx:0,esp:0x7000,ebp:0x6ff0,
  esi:0,edi:0xa400,eip:0x7eeb,eflags:0x46,cr0:0xfffffff1,cr2:0x5000,
  cr3:0x9000,cs:8,ds:16,ss:16,gdtrBase:0x7f50,gdtrLimit:23,
  idtrBase:0,idtrLimit:0x3ff};
const final={selectedState,ramWords:{pde0:'23a00000',pte5:'63500000',
  data5:'44332211',scratchCr2:'00500000'},
frame:{errorCode:2,eip:0x7ebe,cs:8,eflags:0x10046}};
const writes=[...Array.from({length:1024},(_,i)=>({address:0x9000+i*4,
  bytes:'00000000',kind:'host-physical',tick:i+2,ordinal:(i+2)*10-1})),
  {address:0x9000,bytes:'03a00000',kind:'host-physical',tick:1026,ordinal:10259},
  {address:0xa014,bytes:'02500000',kind:'host-physical',tick:1028,ordinal:10279},
  {address:0x6ffc,bytes:'46000100',kind:'host-physical',tick:1029,ordinal:10296},
  {address:0x6ff8,bytes:'08000000',kind:'host-physical',tick:1029,ordinal:10297},
  {address:0x6ff4,bytes:'be7e0000',kind:'host-physical',tick:1029,ordinal:10298},
  {address:0x6ff0,bytes:'02000000',kind:'host-physical',tick:1029,ordinal:10299},
  {address:0xa014,bytes:'03500000',kind:'host-physical',tick:1032,ordinal:10319},
  {address:0x5000,bytes:'44332211',kind:'host-physical',tick:1034,ordinal:10339},
];
const ports=[...marker].map((letter,i)=>({port:0xe9,width:1,
  value:letter.charCodeAt(0),tick:portTicks[i],ordinal:portTicks[i]*10}));
const faultEvent={kind:'fault',tick:faultTick,preTick:faultTick-1,ordinal:10295,
  vector:14,errorCode:2,cr2:0x5000,
  frame:{errorCode:2,eip:0x7ebe,cs:8,eflags:0x10046},
  handler:{cs:8,eip:0x7ef3},faulting:{cs:8,eip:0x7ebe}};
const counters=(tick,mode)=>({ticks:tick,attempts:tick,
  completed:tick-(tick>=faultTick?1:0),repIterations:Math.min(tick,1024),
  repPartial:mode==='continuous'?0:Math.min(1023,Math.ceil(Math.min(tick,1023)/
    (mode==='budget1'?1:mode==='budget2'?2:257))),
  faults:tick>=faultTick?1:0,
  portCommits:portTicks.filter(value=>value<=tick).length});
const exitAt=tick=>tick===faultTick?{cs:8,eip:0x7ef3}:
  tick<faultTick?{cs:0,eip:0x7e10}:{cs:8,eip:0x7eeb};

function arm(mode,budget){
  const slices=[];
  let tick=0,entry={cs:0,eip:0x7e00};
  while(tick<totalTicks){
    const nextSpecial=[faultTick,...portTicks].sort((a,b)=>a-b)
      .find(value=>value>tick)??totalTicks;
    const next=Math.min(totalTicks,nextSpecial,tick+(budget??totalTicks));
    const port=ports.find(value=>value.tick===next);
    const fault=next===faultTick;
    const events=fault?[structuredClone(faultEvent)]:port?
      [{kind:'port',tick:port.tick,ordinal:port.ordinal,
        port:port.port,width:port.width,value:port.value}]:[];
    const exit=exitAt(next);
    slices.push({requestedTicks:budget,chargedTicks:next-tick,
      reason:fault?'fault-delivered':port&&next<tick+(budget??totalTicks)?'port':'budget',
      entry,exit,before:counters(tick,mode),after:counters(next,mode),
      pendingFault:fault,portCommitted:!!port,events});
    tick=next;entry=exit;
  }
  return {mode,requestedBudget:budget,slices,final:structuredClone(final),
    writes:structuredClone(writes),ports:structuredClone(ports),
    totals:counters(totalTicks,mode),
    hostCallbacks:{physicalReads:1,physicalWrites:writes.length,
      executePages:1,tickCallbacks:totalTicks},
    fallback:{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,
      bochsPio:0,bochsTimer:0}};
}

function report(){
  const probes={outOfRangePhysical:['out-of-range-physical','host-physical-read'],
    unexpectedPio:['unexpected-pio','host-port-out'],
    bochsRamRead:['bochs-ram-read','Bochs-RAM-read-fallback'],
    bochsRamWrite:['bochs-ram-write','Bochs-RAM-write-fallback'],
    bochsDirectPointer:['bochs-direct-pointer','Bochs-direct-pointer-fallback'],
    bochsPio:['bochs-pio','Bochs-PIO-fallback'],
    bochsTimer:['bochs-timer','Bochs-timer-fallback']};
  return {schema:'bw.bochs-cpu3-native-slice.v1',
    source:{boardRevision:'b'.repeat(40),sourceHashes:{'fixture.S':digest},
      bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',
      patchHashes:{'cpu.cc':digest},
      configSha256:digest,binarySha256:digest,imageSha256:digest,
      biosSha256:digest,vgaBiosSha256:digest},
    activation:{cs:0,eip:0x7e00,copiedBytes:1048576,tlbFlushed:true,
      prefetchInvalidated:true,icacheFlushed:true,ramSha256:digest,
      cpuSeedSha256:digest},
    armSeeds:Object.fromEntries(['continuous','budget1','budget2','budget257']
      .map(name=>[name,{ramSha256:digest,cpuSeedSha256:digest}])),
    apiProbes:Object.fromEntries(['resume-before-activation','zero-budget',
      'null-callbacks','incomplete-callbacks'].map(name=>[name,'rejected'])),
    arms:{continuous:arm('continuous',null),budget1:arm('budget1',1),
      budget2:arm('budget2',2),budget257:arm('budget257',257)},
    probes:Object.fromEntries(Object.entries(probes).map(([name,[kind,observedFailure]])=>
      [name,{rejected:true,kind,observedFailure}])),
  };
}

const baseline=report();
const rejects=(change,pattern)=>{
  const candidate=structuredClone(baseline);
  change(candidate);
  assert.throws(()=>assertNativeSliceSelfParity(candidate),pattern);
};

test('accepts synthetic four-arm REP, fault, port and bus evidence',()=>{
  const result=assertNativeSliceSelfParity(baseline);
  assert.equal(result.status,'native-self-parity');
  assert.equal(result.nativeTicks,totalTicks);
  assert.equal(result.portBytes,marker);
  assert.ok(result.slices.budget1>result.slices.budget257);
});

test('rejects fault cut or frame corruption before handler resume',()=>{
  rejects(r=>{r.arms.budget1.slices.find(s=>s.reason==='fault-delivered').reason='budget';},
    /fault cut/);
  rejects(r=>{r.arms.budget2.slices.find(s=>s.reason==='fault-delivered').pendingFault=false;},
    /fault cut/);
  rejects(r=>{r.arms.continuous.slices.find(s=>s.reason==='fault-delivered').events[0].frame.eip++;},
    /fault frame/);
  rejects(r=>{r.arms.budget257.slices.find(s=>s.reason==='fault-delivered').exit.eip++;},
    /fault cut/);
});

test('rejects uncommitted port or a missing real port event',()=>{
  rejects(r=>{r.arms.budget1.slices.find(s=>s.portCommitted).portCommitted=false;},
    /commit flag/);
  rejects(r=>{r.arms.budget2.slices.find(s=>s.portCommitted).events=[];},
    /count or commit/);
  rejects(r=>{r.arms.continuous.ports[0].value=0;},/owned port marker/);
});

test('rejects budget-one overrun, zero progress and copied arms',()=>{
  rejects(r=>{r.arms.budget1.slices[0].chargedTicks=2;},/budget overrun/);
  rejects(r=>{r.arms.budget2.slices[0].chargedTicks=0;},/zero progress/);
  rejects(r=>{r.arms.budget257=structuredClone(r.arms.budget1);
    r.arms.budget257.mode='budget257';r.arms.budget257.requestedBudget=257;
    for(const slice of r.arms.budget257.slices)slice.requestedTicks=257;},
  /budget yield did not consume|budget 257 never exercised/);
});

test('rejects changed RAM-write schedule even with matching final state',()=>{
  rejects(r=>{r.arms.budget2.writes[2].tick++;},/writes/);
  rejects(r=>{r.arms.budget257.writes.splice(2,1);},/callback totals/);
  rejects(r=>{for(const arm of Object.values(r.arms))arm.final.selectedState.eax=0;},
    /eax differs/);
});

test('rejects missing source, host-bus activation and fail-closed probes',()=>{
  rejects(r=>{delete r.source.binarySha256;},/missing binarySha256/);
  rejects(r=>{r.activation.tlbFlushed=false;},/activation incomplete/);
  rejects(r=>{r.arms.continuous.fallback.bochsRamReads=1;},/fallback was used/);
  rejects(r=>{r.probes.unexpectedPio.rejected=false;},/exact fail-closed guard/);
  rejects(r=>{r.probes.bochsPio.observedFailure='unrelated-timeout';},
    /exact fail-closed guard/);
  rejects(r=>{r.armSeeds.budget1.ramSha256='b'.repeat(64);},/same selected CPU\/RAM seed/);
  rejects(r=>{r.apiProbes['zero-budget']='accepted';},/argument refusal absent/);
});

test('rejects unknown exits, a shortened budget exit and stale final CPU cursor',()=>{
  rejects(r=>{r.arms.budget1.slices[2].reason='halt';},/unsupported yield reason/);
  rejects(r=>{const s=r.arms.budget257.slices.find(s=>s.reason==='budget');
    s.chargedTicks--;},/budget yield did not consume requested ticks|charged tick delta/);
  rejects(r=>{r.arms.budget2.slices.at(-1).exit.eip++;},/final CPU state differs/);
});

test('rejects an out-of-page write, dropped host callback and missing fault tick',()=>{
  rejects(r=>{r.arms.budget1.writes[0].address=0xfffff;},/owned 1 MiB page domain/);
  rejects(r=>{r.arms.budget257.hostCallbacks.physicalWrites--;},/callback totals/);
  rejects(r=>{r.arms.continuous.hostCallbacks.tickCallbacks--;},/callback totals/);
  rejects(r=>{r.arms.budget2.slices.find(s=>s.reason==='fault-delivered')
    .events[0].preTick--;},/attempted-fault tick/);
});

test('rejects missing or displaced guest-written fault frame',()=>{
  rejects(r=>{r.arms.budget2.writes.find(w=>w.address===0x6ff4).bytes='00000000';},
    /guest-written fault frame absent/);
  rejects(r=>{r.arms.budget257.writes.find(w=>w.address===0x6ffc).tick--;},
    /guest-written fault frame absent/);
});

test('raw parser rejects forged completion and missing native seed pages',()=>{
  assert.throws(()=>parseArm('BWS3\tDEACTIVATE\tproof-complete\n','budget1',1),
    /deactivation without validated final records/);
  assert.throws(()=>parseArm('BWS3\tSEEDPAGE\t0\t00\n','budget1',1),
    /misplaced seed page/);
});

test('negative probe requires exact aborting guard, not an unrelated failure',()=>{
  const guard='BWS3\tFAIL\tBochs-RAM-read-fallback\n';
  assert.deepEqual(failureProbe({code:null,signal:'SIGABRT',stderr:guard},'bochsRamRead'),
    {rejected:true,kind:'bochs-ram-read',observedFailure:'Bochs-RAM-read-fallback'});
  assert.throws(()=>failureProbe({code:1,signal:null,stderr:guard},'bochsRamRead'),
    /did not abort/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGTERM',stderr:guard},'bochsRamRead'),
    /did not abort/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGABRT',stderr:
    'BWS3\tFAIL\tBochs-timer-fallback\n'},'bochsRamRead'),
  /exact active guard/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGABRT',stderr:
    guard+'BWS3\tDEACTIVATE\tproof-complete\n'},'bochsRamRead'),
  /exact active guard/);
});
