/** Fail-closed proof for the freely owned CPU3 A20 and host memory-map fixture. */
import {isDeepStrictEqual} from 'node:util';

const budgets={continuous:null,budget1:1,budget2:2,budget257:257};
const counts=['ticks','attempts','completed','repIterations','repPartial','faults',
  'portCommits','irqDeliveries','haltIdleCuts'];
const selected=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
  'cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const api=['resume-before-activation','zero-budget','null-callbacks',
  'incomplete-callbacks','due-now','callback-reentry'];
const guards={outOfRangePhysical:['out-of-range-physical','host-physical-read'],
  unsupportedSpanWidth:['unsupported-span-width','host-physical-read'],
  unexpectedPio:['unexpected-pio','host-port-out'],
  unsafeExecuteRom:['unsafe-execute-rom','unsafe-execute-page'],
  unsafeExecuteMmio:['unsafe-execute-mmio','unsafe-execute-page'],
  unsafeExecuteUnmapped:['unsafe-execute-unmapped','unsafe-execute-page'],
  bochsRamRead:['bochs-ram-read','Bochs-RAM-read-fallback'],
  bochsRamWrite:['bochs-ram-write','Bochs-RAM-write-fallback'],
  bochsDirectPointer:['bochs-direct-pointer','Bochs-direct-pointer-fallback'],
  bochsPio:['bochs-pio','Bochs-PIO-fallback'],
  bochsTimer:['bochs-timer','Bochs-timer-fallback']};
const fallback=['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'];
const mapId='ram00000-9ffff,mmio-a0000,rom-f0000-fffff,ram-100000-17ffff,openbus-rest';
const requiredSources=['scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-memory-map/abi.h',
  'scripts/bochs-cpu3-native-memory-map/runtime.h',
  'scripts/bochs-cpu3-native-memory-map/runtime.inc',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-memory-map.mjs',
  'scripts/bochs-cpu3-native-memory-map-compare.mjs',
  'scripts/run-bochs-cpu3-native-memory-map-compare.mjs',
  'test/i80386-native-memory-map.test.mjs',
  'test/fixtures/i80386-bochs-cpu3-native-memory-map.S',
  'docs/receipts/2026-09-30-i80386-bochs-cpu3-native-slice-capture.json'];
const requiredPatches=['bochs/bochs.h','bochs/cpu/cpu.cc','bochs/cpu/event.cc',
  'bochs/cpu/exception.cc','bochs/cpu/paging.cc','bochs/iodev/devices.cc',
  'bochs/main.cc','bochs/memory/memory.cc','bochs/memory/misc_mem.cc',
  'bochs/pc_system.cc','bochs/pc_system.h'];
const fail=(at,message)=>{throw Error(`native memory-map proof ${at}: ${message}`);};
const obj=(v,at)=>{if(!v||typeof v!=='object'||Array.isArray(v))fail(at,'object required');return v;};
const arr=(v,at)=>{if(!Array.isArray(v))fail(at,'array required');return v;};
const fields=(v,keys,at)=>{obj(v,at);for(const key of keys)if(!Object.hasOwn(v,key))fail(at,`missing ${key}`);};
const uint=(v,at)=>{if(!Number.isSafeInteger(v)||v<0)fail(at,'nonnegative integer required');return v;};
const bool=(v,at)=>{if(typeof v!=='boolean')fail(at,'boolean required');return v;};
const equal=(a,b,at)=>{if(!isDeepStrictEqual(a,b))fail(at,'fixed expectation or arm parity differs');};
const sha=(v,at,n=64)=>{if(typeof v!=='string'||!new RegExp(`^[0-9a-f]{${n}}$`).test(v))fail(at,'lowercase hash required');};
const point=(v,at)=>{fields(v,['cs','eip'],at);uint(v.cs,at+'.cs');uint(v.eip,at+'.eip');return {cs:v.cs,eip:v.eip};};
const tally=(v,at)=>{fields(v,counts,at);for(const key of counts)uint(v[key],at+'.'+key);return v;};

function sourceAndActivation(report){
  if(report.schema!=='bw.bochs-cpu3-native-memory-map.v1')fail('report','schema changed');
  const s=report.source;
  fields(s,['boardRevision','sourceHashes','bochsRevision','patchHashes','configSha256',
    'binarySha256','imageSha256','floppySha256','bochsrcSha256','biosSha256',
    'vgaBiosSha256','mapId','romProbeOffset','romProbeByte'],'source');
  sha(s.boardRevision,'source.boardRevision',40);
  if(s.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47'||
      s.imageSha256!=='e4b4a6412357dae0167e16024a3d24776c568430d98cbea50e853b1701ab0f9f')
    fail('source','pinned Bochs or free fixture changed');
  for(const key of ['configSha256','binarySha256','imageSha256','floppySha256',
    'bochsrcSha256','biosSha256','vgaBiosSha256'])sha(s[key],'source.'+key);
  for(const [key,required] of [['sourceHashes',requiredSources],['patchHashes',requiredPatches]]){
    const inventory=obj(s[key],'source.'+key);
    equal(Object.keys(inventory).sort(),required.slice().sort(),'source.'+key+' inventory');
    for(const [path,digest] of Object.entries(inventory)){
      if(!path||path.startsWith('/')||path.split('/').includes('..'))fail('source.'+key,'unsafe path');
      sha(digest,`source.${key}.${path}`);
    }
  }
  if(s.mapId!==mapId||s.romProbeOffset!==0xfff0||uint(s.romProbeByte,'source.romProbeByte')>255)
    fail('source','map or ROM probe identity changed');
  const a=report.activation;
  fields(a,['cs','eip','copiedBytes','inheritedA20','mapId','romId','ramSha256',
    'cpuSeedSha256','tlbFlushed','prefetchInvalidated','icacheFlushed'],'activation');
  if(a.cs!==0||a.eip!==0x7e00||a.copiedBytes!==0x180000||a.mapId!==mapId||
      !bool(a.tlbFlushed,'activation.tlbFlushed')||
      !bool(a.prefetchInvalidated,'activation.prefetchInvalidated')||
      !bool(a.icacheFlushed,'activation.icacheFlushed'))
    fail('activation','post-BIOS host boundary changed');
  bool(a.inheritedA20,'activation.inheritedA20');
  sha(a.ramSha256,'activation.ramSha256');sha(a.cpuSeedSha256,'activation.cpuSeedSha256');
  equal(a.romId,{sha256:s.biosSha256,bytes:65536},'activation.ROM_ID');
  fields(a,['handoff','a20Handoff'],'activation');
  fields(a.handoff,['inheritedPending','inheritedMask','inheritedIF','ownedPending'],
    'activation.handoff');
  for(const key of ['inheritedPending','inheritedMask','inheritedIF','ownedPending'])
    uint(a.handoff[key],'activation.handoff.'+key);
  if(a.handoff.ownedPending&0x400)fail('activation','bootstrap PIC edge retained');
  equal(a.a20Handoff,{enabled:a.inheritedA20,latch:a.inheritedA20?2:0,
    source:'8042-low'},'activation.A20 handoff');
  equal(Object.keys(obj(report.armSeeds,'armSeeds')).sort(),Object.keys(budgets).sort(),
    'armSeeds keys');
  for(const name of Object.keys(budgets))equal(report.armSeeds[name],
    {ramSha256:a.ramSha256,cpuSeedSha256:a.cpuSeedSha256,
      inheritedA20:a.inheritedA20,mapId,romId:a.romId,
      handoff:a.handoff,a20Handoff:a.a20Handoff},'armSeeds.'+name);
  equal(Object.keys(obj(report.apiProbes,'apiProbes')).sort(),api.slice().sort(),
    'apiProbes keys');
  for(const name of api)if(report.apiProbes[name] !== (name==='due-now'?'zero-tick':'rejected'))
    fail('apiProbes.'+name,'API rejection or due-now proof absent');
  equal(Object.keys(obj(report.probes,'probes')).sort(),Object.keys(guards).sort(),
    'probes keys');
  for(const [name,[kind,observedFailure]] of Object.entries(guards))
    equal(report.probes[name],{rejected:true,kind,observedFailure},'probes.'+name);
  return {source:s,activation:a};
}

function mapClass(address){
  if(address<=0x9ffff||(address>=0x100000&&address<=0x17ffff))return 'ram';
  if(address===0xa0000)return 'mmio';
  if(address>=0xf0000&&address<=0xfffff)return 'rom';
  return 'unmapped';
}
function effectFor(rw,kind){
  return ({R:{ram:'ram-read',rom:'rom-read',mmio:'mmio-read',unmapped:'open-bus'},
    W:{ram:'ram-commit',rom:'rom-ignored',mmio:'mmio-write',unmapped:'unmapped-ignored'}})[rw]?.[kind];
}
export function assertMemoryMapByte(event,a20){
  fields(event,['rw','raw','effective','class','value','effect','why'],'MEM');
  if(!['R','W'].includes(event.rw))fail('MEM','read/write direction changed');
  uint(event.raw,'MEM.raw');uint(event.effective,'MEM.effective');
  if(event.raw>0xffffffff||event.effective>0xffffffff||
      event.effective!==((a20?event.raw:(event.raw&~0x100000))>>>0))
    fail('MEM','A20 raw/effective address differs');
  const kind=mapClass(event.effective);
  if(event.class!==kind||event.effect!==effectFor(event.rw,kind))
    fail('MEM','host map class or effect differs');
  if(uint(event.value,'MEM.value')>255)fail('MEM','byte value changed');
  if(!['ordinary','pde-read','pte-read','pde-ad-write','pte-ad-write'].includes(event.why)||
      ((event.why.endsWith('read')&&event.rw!=='R')||
      (event.why.endsWith('write')&&event.rw!=='W')))
    fail('MEM','page-walk cause/direction changed');
  if(event.class==='unmapped'&&event.rw==='R'&&event.value!==0xff)
    fail('MEM','open bus did not read FF');
  return event;
}

function journalProof(arm,at,activation){
  const events=arr(arm.journal,at+'.journal'),totals=tally(arm.totals,at+'.totals');
  let ordinal=-1,ticks=0,a20=activation.inheritedA20,ports=0,execs=0,reads=0,writes=0;
  for(const [i,event] of events.entries()){
    const where=`${at}.journal[${i}]`;
    fields(event,['kind','tick','ordinal'],where);
    uint(event.tick,where+'.tick');uint(event.ordinal,where+'.ordinal');
    if(event.ordinal<=ordinal||event.tick<ticks||event.tick>totals.ticks)
      fail(where,'ordinal or native tick order changed');
    ordinal=event.ordinal;
    if(event.kind==='tick'){
      if(event.count!==1||event.preTick!==ticks||event.tick!==ticks+1)
        fail(where,'native tick callback sequence changed');
      ticks++;
      continue;
    }
    if(event.tick!==ticks)fail(where,'event not at current native tick');
    if(event.kind==='mem'){
      assertMemoryMapByte(event,a20);
      if(event.rw==='R')reads++;else writes++;
    }else if(event.kind==='a20'){
      bool(event.old,where+'.old');bool(event.enabled,where+'.enabled');
      if(event.old!==a20||
          uint(event.latch,where+'.latch')>255||
          event.enabled!==!!(event.latch&2))
        fail(where,'A20 transition/latch changed');
      a20=event.enabled;
    }else if(event.kind==='exec'){
      if(event.class!=='ram'||event.rawPage!==event.effectivePage||
          event.rawPage>=0xa0000||(event.rawPage&4095)!==0)
        fail(where,'unsafe execution page accepted');
      execs++;
    }else if(event.kind==='port'){
      if(!['in','out'].includes(event.direction)||
          ![0x92,0xe9].includes(event.port)||event.width!==1||
          uint(event.value,where+'.value')>255)
        fail(where,'unexpected owned PIO');
      if(event.direction==='out')ports++;
    }else if(event.kind==='attempt'){
      point(event.cursor,where+'.cursor');
      if(![0,8].includes(event.cursor.cs))fail(where,'unexpected selected attempt CS');
    }else fail(where,'unknown host event');
  }
  if(ticks!==totals.ticks||ports!==totals.portCommits)
    fail(at,'tick or PIO callback count differs');
  fields(arm.hostCallbacks,['physicalReads','physicalWrites','executePages','tickCallbacks'],
    at+'.hostCallbacks');
  if(!reads||!writes||!execs||
      !uint(arm.hostCallbacks.physicalReads,at+'.hostCallbacks.physicalReads')||
      !uint(arm.hostCallbacks.physicalWrites,at+'.hostCallbacks.physicalWrites')||
      arm.hostCallbacks.physicalReads>reads||arm.hostCallbacks.physicalWrites>writes||
      arm.hostCallbacks.executePages!==execs||arm.hostCallbacks.tickCallbacks!==ticks)
    fail(at,'host callback totals do not substantiate byte journal');
  fields(arm.fallback,fallback,at+'.fallback');
  for(const key of fallback)if(uint(arm.fallback[key],at+'.fallback.'+key)!==0)
    fail(at,'Bochs direct fallback used');
  return events;
}

function sequence(events,at,source){
  const mem=events.filter(e=>e.kind==='mem'),port=events.filter(e=>e.kind==='port');
  const attempts=events.filter(e=>e.kind==='attempt');
  const symbols=[[0,0x7e00],[0,0x7e27],[0,0x7e56],[0,0x7e7b],
    [0,0x7e92],[0,0x7eaa],[0,0x7ec2],[0,0x7ee3],
    [8,0x7f36],[8,0x7f45],[8,0x7f86],[8,0x7f96],
    [8,0x7fc6],[8,0x7ff4]];
  const selected=symbols.map(([cs,eip])=>{
    const matches=attempts.filter(e=>e.cursor.cs===cs&&e.cursor.eip===eip);
    if(matches.length!==1)fail(at,`selected guest attempt ${cs.toString(16)}:${eip.toString(16)} changed`);
    return matches[0];
  });
  if(selected.some((e,i)=>i&&e.ordinal<=selected[i-1].ordinal)||
      attempts.length!==symbols.length)
    fail(at,'guest phase attempts reordered or borrowed');
  const by=(rw,raw,effective,value,why='ordinary')=>mem.filter(e=>
    e.rw===rw&&e.raw===raw&&e.effective===effective&&e.value===value&&e.why===why);
  const one=(xs,where)=>{if(xs.length!==1)fail(where,'exact owned transaction count changed');return xs[0];};
  const ordered=(xs,where)=>{if(xs.some((e,i)=>i&&e.ordinal<=xs[i-1].ordinal))
    fail(where,'transaction order changed');};
  const lowSeed=one(by('W',0x500,0x500,0x31),'low seed');
  const highSeed=one(by('W',0x100500,0x100500,0xa7),'high seed');
  const aliasRead=one(by('R',0x100500,0x500,0x31),'off alias read');
  const aliasWrite=one(by('W',0x100500,0x500,0x52),'off alias write');
  const highRestored=mem.find(e=>e.rw==='R'&&e.raw===0x100500&&
    e.effective===0x100500&&e.value===0xa7&&e.ordinal>aliasWrite.ordinal);
  if(!highRestored)fail(at,'high sentinel not restored after A20 gate');
  ordered([lowSeed,highSeed,aliasRead,aliasWrite,highRestored],'A20 sentinel sequence');
  const mmioWrite=one(by('W',0xa0000,0xa0000,0x5a),'MMIO write');
  const mmioRead=one(by('R',0xa0000,0xa0000,0x5a),'MMIO read');
  const openWrite=one(by('W',0xd0000,0xd0000,0x33),'unmapped discard');
  const openRead=one(by('R',0xd0000,0xd0000,0xff),'open bus');
  const romRead=mem.filter(e=>e.rw==='R'&&e.raw===0xffff0&&
    e.effective===0xffff0&&e.value===source.romProbeByte);
  const romWrite=one(by('W',0xffff0,0xffff0,0x12),'ROM ignored write');
  if(romRead.length!==2)fail(at,'source-pinned ROM read/write/readback changed');
  ordered([mmioWrite,mmioRead,openWrite,openRead,romRead[0],romWrite,romRead[1]],
    'device/ROM transaction sequence');
  const port92=port.filter(e=>e.port===0x92&&e.direction==='out');
  equal(port92.map(e=>e.value),[2,0,2,0,2],at+'.port92 transitions');
  const in92=port.filter(e=>e.port===0x92&&e.direction==='in');
  equal(in92.map(e=>e.value),[2,0],at+'.port92 readback');
  const marker=port.filter(e=>e.port===0xe9&&e.direction==='out');
  equal(Buffer.from(marker.map(e=>e.value)).toString('ascii'),'BMAP001',at+'.marker');
  ordered([port92[0],lowSeed,port92[1],aliasRead,aliasWrite,port92[2],
    highRestored,mmioWrite,romRead[0],port92[3],port92[4],marker[0]],
  at+'.guest phases');
  const a20=events.filter(e=>e.kind==='a20');
  if(a20.length!==5||a20.some((e,i)=>e.ordinal+1!==port92[i].ordinal||
      e.tick!==port92[i].tick||e.latch!==port92[i].value))
    fail(at,'A20 host transition sequence absent');
  if(!(selected[1].ordinal<a20[0].ordinal&&selected[2].ordinal<a20[1].ordinal&&
      selected[3].ordinal<a20[2].ordinal&&selected[10].ordinal<a20[3].ordinal&&
      selected[12].ordinal<a20[4].ordinal&&selected[13].ordinal<marker[0].ordinal))
    fail(at,'A20/marker callback borrowed from wrong guest phase');
  const four=(rw,raw,effective,bytes,why)=>{
    const matches=[];
    for(let i=0;i<events.length-3;i++){
      const group=events.slice(i,i+4);
      if(group.every((e,j)=>e.kind==='mem'&&e.rw===rw&&e.why===why&&
          e.raw===raw+j&&e.effective===effective+j&&e.value===bytes[j]&&
          e.tick===group[0].tick&&e.ordinal===group[0].ordinal+j))matches.push(group);
    }
    if(!matches.length)fail(at,`${why} raw/gated four-byte transaction absent`);
    return matches[0];
  };
  const highPde=four('W',0x110000,0x110000,[2,0x20,0xb0,0], 'ordinary');
  const highPte=four('W',0x111014,0x111014,[2,0x50,0x50,0], 'ordinary');
  if(!(selected[9].ordinal<highPde[0].ordinal&&
      highPde[3].ordinal<highPte[0].ordinal&&
      highPte[3].ordinal<selected[10].ordinal))
    fail(at,'distinctive high table sentinels not seeded before gate-off');
  const pdeRead=four('R',0x110000,0x10000,[3,0x10,0x11,0],'pde-read');
  const pteRead=four('R',0x111014,0x11014,[3,0x50,0,0],'pte-read');
  const pdeWrite=four('W',0x110000,0x10000,[0x23,0x10,0x11,0],'pde-ad-write');
  const pteWrite=four('W',0x111014,0x11014,[0x63,0x50,0,0],'pte-ad-write');
  const data=mem.filter(e=>e.rw==='W'&&e.raw>=0x5000&&e.raw<0x5004&&
    e.effective===e.raw&&e.why==='ordinary');
  equal(data.map(e=>e.value),[0x44,0x33,0x22,0x11],at+'.data5 commit');
  if(!(port92[3].ordinal<pdeRead[0].ordinal&&pdeRead[0].ordinal<pteRead[0].ordinal&&
      pdeWrite[0].ordinal<data[0].ordinal&&pteWrite[0].ordinal<data[0].ordinal&&
      data[3].ordinal<selected[12].ordinal&&selected[12].ordinal<port92[4].ordinal))
    fail(at,'aliased page walk did not cause low A/D updates before data store');
  return {a20Transitions:a20.length,romByte:source.romProbeByte,
    pageWalkRaw:[0x110000,0x111014],pageWalkEffective:[0x10000,0x11014]};
}

function sliceProof(name,arm,activation,events){
  const at='arms.'+name,budget=budgets[name],slices=arr(arm.slices,at+'.slices');
  if(!slices.length)fail(at,'no native resume calls');
  let prior={ticks:0,attempts:0,completed:0,repIterations:0,repPartial:0,
    faults:0,portCommits:0,irqDeliveries:0,haltIdleCuts:0};
  let cursor={cs:activation.cs,eip:activation.eip},end=-1;
  for(const [i,s] of slices.entries()){
    const where=`${at}.slices[${i}]`;
    fields(s,['requestedTicks','effectiveTicks','chargedTicks','reason','entry','exit',
      'before','after','journalEndOrdinal'],where);
    if(s.requestedTicks!==budget||!Number.isSafeInteger(s.effectiveTicks)||
        s.effectiveTicks<1||(budget!==null&&s.effectiveTicks>budget)||
        !Number.isSafeInteger(s.chargedTicks)||s.chargedTicks<0||
        s.chargedTicks>s.effectiveTicks)
      fail(where,'bounded native budget invalid');
    equal(point(s.entry,where+'.entry'),cursor,where+'.entry');
    tally(s.before,where+'.before');tally(s.after,where+'.after');
    for(const key of counts)if(s.before[key]!==prior[key]||s.after[key]<s.before[key])
      fail(where,key+' count discontinuity');
    if(s.after.ticks-s.before.ticks!==s.chargedTicks)fail(where,'native tick charge differs');
    if(!['budget','port'].includes(s.reason)||
        (s.reason==='budget'&&s.chargedTicks!==s.effectiveTicks)||
        (s.reason==='port'&&!s.after.portCommitted))
      fail(where,'unsupported memory-map yield');
    const next=uint(s.journalEndOrdinal,where+'.journalEndOrdinal');
    if(next<end)fail(where,'journal boundary regressed');
    prior=s.after;cursor=point(s.exit,where+'.exit');end=next;
  }
  for(const key of counts)if(prior[key]!==arm.totals[key])fail(at,key+' total differs');
  equal(cursor,{cs:8,eip:0x8010},at+'.terminal cursor');
  if(name==='budget1'&&slices.length<1024)fail(at,'one-tick REP cuts absent');
  if(name==='budget2'&&!slices.some(s=>s.chargedTicks===2))fail(at,'two-tick budget untested');
  if(name==='budget257'&&!slices.some(s=>s.chargedTicks===257))fail(at,'257-tick budget untested');
  if(events.at(-1)?.ordinal!==end)fail(at,'unclaimed final journal events');
}

export function assertNativeMemoryMapArm(name,arm,activation,source){
  const at='arms.'+name;
  fields(arm,['mode','requestedBudget','slices','journal','final','totals',
    'hostCallbacks','fallback','pagewalkProof'],at);
  if(arm.mode!==name||arm.requestedBudget!==budgets[name])fail(at,'arm identity changed');
  const t=tally(arm.totals,at+'.totals');
  if(!t.ticks||!t.completed||t.repIterations!==1024||t.portCommits!==12||
      t.faults||t.irqDeliveries||t.haltIdleCuts)
    fail(at,'owned fixture CPU/port count gate failed');
  const events=journalProof(arm,at,activation);
  fields(arm.pagewalkProof,['aliasedPdeReads','aliasedPte5Reads',
    'aliasedPdeAdWrites','aliasedPte5AdWrites'],at+'.pagewalkProof');
  for(const [key,value] of Object.entries(arm.pagewalkProof))
    if(!uint(value,at+'.pagewalkProof.'+key))fail(at,'source-tagged aliased page walk absent');
  const evidence=sequence(events,at,source);
  fields(arm.final,['selectedState','ramWords'],at+'.final');
  fields(arm.final.selectedState,selected,at+'.selectedState');
  for(const key of selected)uint(arm.final.selectedState[key],at+'.selectedState.'+key);
  const cpu=arm.final.selectedState;
  if(cpu.cs!==8||cpu.ds!==16||cpu.ss!==24||cpu.esp!==0x7000||
      cpu.eip!==0x8010||cpu.cr3!==0x110000||
      (cpu.cr0&0x80000001)!==1||(cpu.eflags&0x200)!==0||
      cpu.gdtrBase!==0x8018||cpu.gdtrLimit!==31)
    fail(at,'terminal selected CPU state changed');
  equal(arm.final.ramWords,{low500:0x52,high100500:0xa7,
    romBefore:source.romProbeByte,romAfter:source.romProbeByte,
    mmioReadback:0x5a,openBusReadback:0xff,mmioRegister:0x5a,
    mmioReads:1,mmioWrites:1,romIgnored:1,unmappedReads:1,unmappedIgnored:1,
    lowPde:'23101100',lowPte5:'63500000',
    highPde:'0220b000',highPte5:'02505000',data5:'44332211',
    a20Enabled:true,port92Latch:2},at+'.final.memory');
  sliceProof(name,arm,activation,events);
  return {journal:events,final:arm.final,totals:t,slices:arm.slices.length,
    pagewalkProof:arm.pagewalkProof,evidence};
}

export function assertNativeMemoryMapSelfParity(report){
  fields(report,['schema','source','activation','armSeeds','apiProbes','arms','probes'],'report');
  const {source,activation}=sourceAndActivation(report);
  equal(Object.keys(obj(report.arms,'arms')).sort(),Object.keys(budgets).sort(),'arms keys');
  const proved=Object.fromEntries(Object.keys(budgets).map(name=>
    [name,assertNativeMemoryMapArm(name,report.arms[name],activation,source)]));
  const first=proved.continuous;
  const comparable=events=>events.filter(e=>e.kind!=='exec'&&e.kind!=='attempt');
  for(const name of ['budget1','budget2','budget257']){
    equal(proved[name].final,first.final,name+'.final');
    equal(proved[name].pagewalkProof,first.pagewalkProof,name+'.pagewalkProof');
    equal(comparable(proved[name].journal),comparable(first.journal),
      name+'.ordered host memory/PIO/tick journal');
    for(const key of ['ticks','completed','repIterations','faults','portCommits'])
      if(proved[name].totals[key]!==first.totals[key])fail(name+'.totals',key+' differs');
  }
  return {schema:'bw.bochs-cpu3-native-memory-map-self-parity.v1',
    status:'native-memory-map-self-parity',sourceRevision:source.boardRevision,
    activation,nativeTicks:first.totals.ticks,completed:first.totals.completed,
    repIterations:first.totals.repIterations,portCommits:first.totals.portCommits,
    evidence:first.evidence,
    slices:Object.fromEntries(Object.entries(proved).map(([name,arm])=>[name,arm.slices])),
    limitations:['one freely authored CPU3 memory-map fixture and decoded RAM seed only',
      'ROM and MMIO are fixture-specific; no AT device, IRQ-time, DMA or full reset equivalence',
      'no JavaScript board parity, WASM build, physical-cycle equivalence or speed measurement']};
}
