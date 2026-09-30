import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {assertA20AliasWindow,assertMemoryMapByte,
  assertNativeMemoryMapSelfParity} from
  '../scripts/bochs-cpu3-native-memory-map-compare.mjs';
import {parseArm,failureProbe} from
  '../scripts/run-bochs-cpu3-native-memory-map-compare.mjs';

const byte=(overrides={})=>({rw:'R',raw:0x500,effective:0x500,
  class:'ram',value:0x31,effect:'ram-read',why:'ordinary',...overrides});
const mutationInput='test/fixtures/i80386-bochs-cpu3-native-memory-map-initial-capture.json.gz';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

function initialCapture(){
  const compressed=readFileSync(new URL('./fixtures/i80386-bochs-cpu3-native-memory-map-initial-capture.json.gz',import.meta.url));
  assert.equal(hash(compressed),'f137e71e0d0e28839fbe7e078401636ed63b2e9ae1798baf1e8a9e05107cf416');
  const decoded=gunzipSync(compressed);
  assert.equal(hash(decoded),'cb67147b13aa788cfc61470b8ac3aba57d3e7d83750e5ea4fa1694b36a0e306b');
  const report=JSON.parse(decoded);
  // The historical capture remains immutable. Only this test's source
  // inventory is adapted to include its later-committed free regression input.
  report.source.sourceHashes[mutationInput]=hash(compressed);
  return report;
}
function replace(parent,key,value){
  const original=parent[key];parent[key]=value;
  return ()=>{parent[key]=original;};
}
function remove(parent,key){
  const original=parent[key];delete parent[key];
  return ()=>{parent[key]=original;};
}

test('accepts an already gated host RAM byte and typed device effects',()=>{
  assert.equal(assertMemoryMapByte(byte(),false).effective,0x500);
  assertMemoryMapByte(byte({rw:'W',raw:0xffff0,effective:0xffff0,
    class:'rom',value:0x12,effect:'rom-ignored'}),true);
  assertMemoryMapByte(byte({rw:'W',raw:0xa0000,effective:0xa0000,
    class:'mmio',value:0x5a,effect:'mmio-write'}),true);
  assertMemoryMapByte(byte({raw:0xd0000,effective:0xd0000,
    class:'unmapped',value:0xff,effect:'open-bus'}),true);
});

test('rejects a page walk that bypasses A20 or borrows a data access',()=>{
  assert.throws(()=>assertMemoryMapByte(byte({raw:0x111014,effective:0x111014,
    why:'pte-read'}),false),/A20 raw\/effective/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0x111014,effective:0x11014,
    why:'pte-ad-write'}),false),/page-walk cause\/direction/);
  assertMemoryMapByte(byte({raw:0x111014,effective:0x11014,
    why:'pte-read'}),false);
  assertMemoryMapByte(byte({raw:0x180000,effective:0x80000}),false);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0x100080000,effective:0x80000}),false),
    /effective mapped domain/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0x200000,effective:0x200000}),false),
    /effective mapped domain/);
});

test('A20 alias uses actual pre-gated callback bytes inside the guest phase',()=>{
  const events=[{kind:'a20',enabled:false,latch:0,ordinal:11},
    {kind:'mem',rw:'R',raw:0x500,effective:0x500,value:0x31,
      why:'ordinary',ordinal:12},
    {kind:'mem',rw:'W',raw:0x500,effective:0x500,value:0x52,
      why:'ordinary',ordinal:13},
    {kind:'mem',rw:'R',raw:0x500,effective:0x500,value:0x52,
      why:'ordinary',ordinal:14}];
  assert.equal(assertA20AliasWindow(events,10,20).lowRead52.ordinal,14);
  const changed=edit=>{const copy=structuredClone(events);edit(copy);return copy;};
  assert.throws(()=>assertA20AliasWindow(changed(e=>{e[1].raw=0x100500;}),10,20),
    /fabricated pre-mask/);
  assert.throws(()=>assertA20AliasWindow(changed(e=>{e[1].ordinal=21;}),10,20),
    /phase-bounded low callback/);
  assert.throws(()=>assertA20AliasWindow(changed(e=>{e[3].value=0x31;}),10,20),
    /phase-bounded low callback/);
});

test('rejects ROM/RAM/MMIO/open-bus class or effect substitutions',()=>{
  assert.throws(()=>assertMemoryMapByte(byte({class:'rom'}),false),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({effect:'ram-commit'}),false),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({rw:'W',raw:0xffff0,effective:0xffff0,
    class:'rom',value:0x12,effect:'ram-commit'}),true),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0xa0000,effective:0xa0000,
    class:'ram',effect:'ram-read'}),true),/map class or effect/);
  assert.throws(()=>assertMemoryMapByte(byte({raw:0xd0000,effective:0xd0000,
    class:'unmapped',effect:'open-bus',value:0}),true),/open bus/);
});

test('full report cannot be inferred from a single mapped access',()=>{
  assert.throws(()=>assertNativeMemoryMapSelfParity({}),/missing schema/);
});

test('BWS6 parser refuses a fabricated completion or undecoded seed page',()=>{
  assert.throws(()=>parseArm('BWS6\tDEACTIVATE\tproof-complete\n',
    'continuous',null),/deactivation lacks final proof/);
  assert.throws(()=>parseArm('BWS6\tSEEDPAGE\t160\t00\n',
    'continuous',null),/misplaced page/);
  assert.throws(()=>parseArm('BWS5\tDEACTIVATE\tproof-complete\n',
    'continuous',null),/no BWS6 records/);
});

test('guard proof requires exact SIGABRT and named unsafe-execute failure',()=>{
  const raw='BWS6\tFAIL\tunsafe-execute-page\n';
  assert.deepEqual(failureProbe({code:null,signal:'SIGABRT',stderr:raw},
    'unsafeExecuteRom'),{rejected:true,kind:'unsafe-execute-rom',
    observedFailure:'unsafe-execute-page'});
  assert.throws(()=>failureProbe({code:null,signal:'SIGTERM',stderr:raw},
    'unsafeExecuteRom'),/did not abort/);
  assert.throws(()=>failureProbe({code:null,signal:'SIGABRT',stderr:
    'BWS6\tFAIL\tBochs-timer-fallback\n'},'unsafeExecuteRom'),/exact active guard/);
});

test('actual four-arm free capture rejects source, seed, API, and guard substitutions',()=>{
  const report=initialCapture();
  assert.equal(assertNativeMemoryMapSelfParity(report).status,'native-memory-map-self-parity');
  const cases=[
    ['missing runtime source hash',()=>remove(report.source.sourceHashes,
      'scripts/bochs-cpu3-native-memory-map/runtime.inc')],
    ['missing regression input hash',()=>remove(report.source.sourceHashes,mutationInput)],
    ['different map identity',()=>replace(report.source,'mapId','ram-only')],
    ['different pinned ROM byte',()=>replace(report.source,'romProbeByte',0x90)],
    ['one arm different decoded RAM seed',()=>replace(report.armSeeds.budget1,
      'decodedRamSeedSha256','0'.repeat(64))],
    ['accepted callback reentry',()=>replace(report.apiProbes,'callback-reentry','accepted')],
    ['missing timer guard',()=>remove(report.probes,'bochsTimer')],
    ['wrong ROM execution guard',()=>replace(report.probes.unsafeExecuteRom,
      'observedFailure','host-physical-read')],
    ['missing budget2 arm',()=>remove(report.arms,'budget2')],
    ['one arm fewer physical callbacks',()=>replace(report.arms.budget1.hostCallbacks,
      'physicalReads',31)],
  ];
  for(const [name,mutate] of cases){
    const undo=mutate();
    try{assert.throws(()=>assertNativeMemoryMapSelfParity(report),undefined,name);}
    finally{undo();}
  }
  const original=Object.values(report.arms).map(arm=>arm.hostCallbacks.physicalReads);
  try{
    for(const arm of Object.values(report.arms))arm.hostCallbacks.physicalReads=1;
    assert.throws(()=>assertNativeMemoryMapSelfParity(report),
      /hostCallbacks fixed fixture/,'matching false callback totals');
  }finally{
    Object.values(report.arms).forEach((arm,i)=>{arm.hostCallbacks.physicalReads=original[i];});
  }
  assert.equal(assertNativeMemoryMapSelfParity(report).nativeTicks,1927);
});

test('actual ordered journal rejects alias, page-walk, device, and tick drift',()=>{
  const report=initialCapture();
  const journal=report.arms.budget1.journal;
  const find=(predicate,label)=>{
    const item=journal.find(predicate);
    assert(item,`missing actual ${label}`);
    return item;
  };
  const off=find(e=>e.kind==='a20'&&!e.enabled,'A20-off');
  const alias=find(e=>e.kind==='mem'&&e.ordinal>off.ordinal&&
    e.raw===0x500&&e.rw==='R'&&e.value===0x31,'real-mode alias');
  const pagewalk=find(e=>e.kind==='mem'&&e.why==='pde-read', 'PDE read');
  const romWrite=find(e=>e.kind==='mem'&&e.class==='rom'&&e.rw==='W','ROM write');
  const mmioRead=find(e=>e.kind==='mem'&&e.class==='mmio'&&e.rw==='R','MMIO read');
  const tick=find(e=>e.kind==='tick','tick callback');
  const exec=find(e=>e.kind==='exec','execution page');
  const cases=[
    ['fabricated pre-mask alias',()=>replace(alias,'raw',0x100500)],
    ['page walk did not gate',()=>replace(pagewalk,'effective',pagewalk.raw)],
    ['page-walk source tag removed',()=>replace(pagewalk,'why','ordinary')],
    ['ROM write-through',()=>replace(romWrite,'effect','ram-commit')],
    ['MMIO read value changed',()=>replace(mmioRead,'value',0)],
    ['native tick shifted',()=>replace(tick,'tick',tick.tick+1)],
    ['safe but different execution page',()=>{
      const raw=exec.rawPage,effective=exec.effectivePage;
      exec.rawPage=raw===0x8000?0x7000:0x8000;
      exec.effectivePage=exec.rawPage;
      return ()=>{exec.rawPage=raw;exec.effectivePage=effective;};
    }],
  ];
  for(const [name,mutate] of cases){
    const undo=mutate();
    try{assert.throws(()=>assertNativeMemoryMapSelfParity(report),undefined,name);}
    finally{undo();}
  }
  assert.equal(assertNativeMemoryMapSelfParity(report).nativeTicks,1927);
});
