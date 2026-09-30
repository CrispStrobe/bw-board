/** Fail-closed validation of the free CPU3 host-event self-comparison. */
import {isDeepStrictEqual} from 'node:util';

const arms={continuous:null,budget1:1,budget2:2,budget257:257};
const counts=['ticks','attempts','completed','repIterations','repPartial','faults',
  'portCommits','irqDeliveries','haltIdleCuts'];
const api=['irq-before-activation','resume-before-activation','zero-budget',
  'null-callbacks','incomplete-callbacks','invalid-irq-line','due-now',
  'stale-deadline','callback-reentry'];
const guards={outOfRangePhysical:['out-of-range-physical','host-physical-read'],
  unexpectedPio:['unexpected-pio','host-port-out'],
  bochsRamRead:['bochs-ram-read','Bochs-RAM-read-fallback'],
  bochsRamWrite:['bochs-ram-write','Bochs-RAM-write-fallback'],
  bochsDirectPointer:['bochs-direct-pointer','Bochs-direct-pointer-fallback'],
  bochsPio:['bochs-pio','Bochs-PIO-fallback'],
  bochsTimer:['bochs-timer','Bochs-timer-fallback']};
const fallback=['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'];
const state=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
  'cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
const requiredSources=['scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/bochs-cpu3-native-events/abi.h','scripts/bochs-cpu3-native-events/runtime.h',
  'scripts/bochs-cpu3-native-events/runtime.inc','scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-events.mjs',
  'scripts/bochs-cpu3-native-events-compare.mjs',
  'scripts/run-bochs-cpu3-native-events-compare.mjs',
  'test/i80386-native-events.test.mjs',
  'test/fixtures/i80386-native-events-smoke-arm.json',
  'test/fixtures/i80386-bochs-cpu3-native-events.S',
  'docs/receipts/2026-09-30-i80386-bochs-cpu3-native-slice-capture.json'];
const requiredPatches=['bochs/bochs.h','bochs/cpu/cpu.cc','bochs/cpu/event.cc',
  'bochs/cpu/exception.cc','bochs/cpu/paging.cc','bochs/iodev/devices.cc',
  'bochs/main.cc','bochs/memory/memory.cc','bochs/memory/misc_mem.cc',
  'bochs/pc_system.cc','bochs/pc_system.h'];
const bad=(at,reason)=>{throw Error(`native event proof ${at}: ${reason}`);};
const object=(v,at)=>{if(!v || typeof v!=='object' || Array.isArray(v))bad(at,'object required');return v;};
const array=(v,at)=>{if(!Array.isArray(v))bad(at,'array required');return v;};
const fields=(v,names,at)=>{object(v,at);for(const n of names)if(!Object.hasOwn(v,n))bad(at,`missing ${n}`);};
const uint=(v,at)=>{if(!Number.isSafeInteger(v)||v<0)bad(at,'nonnegative integer required');return v;};
const bool=(v,at)=>{if(typeof v!=='boolean')bad(at,'boolean required');return v;};
const equal=(a,b,at)=>{if(!isDeepStrictEqual(a,b))bad(at,'fixed expectation or arm parity differs');};
const sha=(v,at,width=64)=>{if(typeof v!=='string'||!new RegExp(`^[0-9a-f]{${width}}$`).test(v))bad(at,'lowercase hash required');};
const point=(v,at)=>{fields(v,['cs','eip'],at);uint(v.cs,at+'.cs');uint(v.eip,at+'.eip');return {cs:v.cs,eip:v.eip};};
const tally=(v,at)=>{fields(v,counts,at);for(const n of counts)uint(v[n],at+'.'+n);return v;};

function sourceAndActivation(r){
  if(r.schema!=='bw.bochs-cpu3-native-events.v1')bad('report','schema changed');
  fields(r.source,['boardRevision','sourceHashes','bochsRevision','patchHashes',
    'configSha256','binarySha256','imageSha256','floppySha256','bochsrcSha256',
    'biosSha256','vgaBiosSha256'],'source');
  sha(r.source.boardRevision,'source.boardRevision',40);
  if(r.source.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47' ||
      r.source.imageSha256!=='afc595c407f4c7cfd1651cc2b28b51e83ffcd7d9aa4383deb553ae6f3fa42c2c')
    bad('source','pinned Bochs or free fixture changed');
  for(const n of ['configSha256','binarySha256','imageSha256','floppySha256',
    'bochsrcSha256','biosSha256','vgaBiosSha256'])sha(r.source[n],'source.'+n);
  for(const n of ['sourceHashes','patchHashes']){
    const set=object(r.source[n],'source.'+n);
    equal(Object.keys(set).sort(),
      (n==='sourceHashes'?requiredSources:requiredPatches).slice().sort(),
    'source.'+n+' inventory');
    for(const [path,hash] of Object.entries(set)){
      if(!path||path.startsWith('/')||path.split('/').includes('..'))bad('source.'+n,'unsafe path');
      sha(hash,'source.'+n+'.'+path);
    }
  }
  const a=r.activation;
  fields(a,['cs','eip','copiedBytes','tlbFlushed','prefetchInvalidated',
    'icacheFlushed','ramSha256','cpuSeedSha256','handoff'],'activation');
  if(a.cs!==0||a.eip!==0x7e00||a.copiedBytes!==1048576||
      bool(a.tlbFlushed,'activation.tlbFlushed')!==true||
      bool(a.prefetchInvalidated,'activation.prefetchInvalidated')!==true||
      bool(a.icacheFlushed,'activation.icacheFlushed')!==true)
    bad('activation','post-BIOS ownership boundary changed');
  sha(a.ramSha256,'activation.ramSha256');sha(a.cpuSeedSha256,'activation.cpuSeedSha256');
  fields(a.handoff,['inheritedPending','inheritedMask','inheritedIF','ownedPending'],'handoff');
  for(const n of ['inheritedPending','inheritedMask','inheritedIF','ownedPending'])uint(a.handoff[n],'handoff.'+n);
  if(a.handoff.ownedPending&0x400)bad('handoff','bootstrap PIC pending edge retained');
  equal(Object.keys(object(r.armSeeds,'armSeeds')).sort(),Object.keys(arms).sort(),'armSeeds keys');
  for(const name of Object.keys(arms))equal(r.armSeeds[name],
    {ramSha256:a.ramSha256,cpuSeedSha256:a.cpuSeedSha256,handoff:a.handoff},
    'armSeeds.'+name);
  equal(Object.keys(object(r.apiProbes,'apiProbes')).sort(),api.slice().sort(),'apiProbes keys');
  for(const n of api)if(r.apiProbes[n] !== (n==='due-now'?'zero-tick':'rejected'))
    bad('apiProbes.'+n,'API rejection or due-now proof absent');
  equal(Object.keys(object(r.probes,'probes')).sort(),Object.keys(guards).sort(),'probes keys');
  for(const [n,[kind,observedFailure]] of Object.entries(guards))
    equal(r.probes[n],{rejected:true,kind,observedFailure},'probes.'+n);
  return a;
}

function journalProof(a,at){
  const events=array(a.journal,at+'.journal'),totals=tally(a.totals,at+'.totals');
  let ordinal=-1,tick=0,ticks=0,writes=0,ports=0;
  for(const [i,e] of events.entries()){
    const where=`${at}.journal[${i}]`;
    fields(e,['kind','tick','ordinal'],where);
    uint(e.tick,where+'.tick');uint(e.ordinal,where+'.ordinal');
    if(e.ordinal<=ordinal||e.tick<tick||e.tick>totals.ticks)bad(where,'event order changed');
    ordinal=e.ordinal;tick=e.tick;
    if(e.kind==='tick'){
      if(e.count!==1||e.preTick+1!==e.tick||e.tick!==++ticks)bad(where,'native tick schedule changed');
    }else if(e.kind==='write'){
      if(e.tick!==ticks)bad(where,'write did not match charged tick ledger');
      fields(e,['address','bytes','provenance'],where);uint(e.address,where+'.address');
      if(e.provenance!=='host-physical'||typeof e.bytes!=='string'||
          !/^(?:[0-9a-f]{2})+$/.test(e.bytes)||e.address+e.bytes.length/2>1048576||
          (e.address&4095)+e.bytes.length/2>4096)bad(where,'host write domain/bytes changed');
      writes++;
    }else if(e.kind==='port'){
      if(e.tick!==ticks)bad(where,'port did not match charged tick ledger');
      if(e.port!==0xe9||e.width!==1||!Number.isInteger(e.value)||e.value<0||e.value>255)
        bad(where,'unexpected owned PIO');
      ports++;
    }else if(e.kind==='irq-line'){
      if(e.tick!==ticks)bad(where,'line action did not match charged tick ledger');
      bool(e.asserted,where+'.asserted');if(e.vector!==0x20)bad(where,'IRQ vector changed');
    }else if(e.kind==='irq-ack'||e.kind==='irq-delivered'){
      if(e.tick!==ticks)bad(where,'IRQ did not match charged tick ledger');
      if(e.vector!==0x20)bad(where,'IRQ vector changed');point(e.entry,where+'.entry');
    }else if(e.kind==='halt-idle'){
      if(e.tick!==ticks)bad(where,'idle cut did not match charged tick ledger');
      point(e.cursor,where+'.cursor');bool(e.ifFlag,where+'.ifFlag');
      if(e.activity!==1)bad(where,'HLT idle lost halted state');
    }else if(e.kind==='deadline-consumed'){
      if(e.tick!==ticks)bad(where,'deadline did not match charged tick ledger');
      if(e.tick!==256)bad(where,'deadline action at wrong tick');
    }else bad(where,'unknown host event');
  }
  if(ticks!==totals.ticks||ports!==totals.portCommits)bad(at,'tick/port callback inventory differs');
  fields(a.hostCallbacks,['physicalReads','physicalWrites','executePages','tickCallbacks'],at+'.hostCallbacks');
  if(!a.hostCallbacks.physicalReads||!a.hostCallbacks.executePages||
      a.hostCallbacks.physicalWrites!==writes||a.hostCallbacks.tickCallbacks!==ticks)
    bad(at,'host callback totals do not substantiate journal');
  fields(a.fallback,fallback,at+'.fallback');
  for(const n of fallback)if(uint(a.fallback[n],at+'.fallback.'+n)!==0)bad(at,'Bochs fallback used');
  return events;
}

function eventProof(a,at,events){
  const of=k=>events.filter(e=>e.kind===k);
  const line=of('irq-line'),ack=of('irq-ack'),irq=of('irq-delivered'),idle=of('halt-idle');
  equal(line.map(e=>e.asserted),[true,false,true,false,true,false],at+'.line sequence');
  if(of('deadline-consumed').length!==1||line[0].tick!==256||
      of('deadline-consumed')[0].ordinal>=line[0].ordinal)
    bad(at,'host asserted IRQ before consuming REP deadline');
  if(ack.length!==2||irq.length!==2||idle.length!==5||
      !(line[0].ordinal<ack[0].ordinal&&ack[0].ordinal<irq[0].ordinal&&
        irq[0].ordinal<line[1].ordinal&&line[2].ordinal<ack[1].ordinal&&
        ack[1].ordinal<irq[1].ordinal&&irq[1].ordinal<line[3].ordinal&&
        line[4].ordinal<idle[4].ordinal&&idle[4].ordinal<line[5].ordinal))
    bad(at,'IRQ/HLT action and delivery order changed');
  const shadow=events.find(e=>e.kind==='write'&&e.address===0x530&&e.bytes==='01');
  if(!shadow||shadow.ordinal>=ack[0].ordinal)bad(at,'STI successor did not retire before IRQ');
  for(let i=0;i<2;i++){
    const x=irq[i],y=ack[i],eip=i?0x7e90:0x7e81;
    equal(x.entry,{cs:8,eip},`${at}.irq[${i}].entry`);
    equal(y.entry,x.entry,`${at}.irq[${i}].ack`);
    equal(x.handler,{cs:8,eip:0x7ebd},`${at}.irq[${i}].handler`);
    if(x.tick!==y.tick||x.sp!==0x6ff4||x.frame.eip!==eip||
        (x.frame.cs&0xffff)!==8||(x.frame.eflags&0x37fd7)!==0x246)
      bad(at,'protected IRQ frame or tick changed');
    const frame=events.filter(e=>e.kind==='write'&&e.ordinal>y.ordinal&&
      e.ordinal<x.ordinal&&e.tick===x.tick&&[0x6ff4,0x6ff8,0x6ffc].includes(e.address));
    const le32=n=>Buffer.from([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]).toString('hex');
    if(frame.length!==3||!isDeepStrictEqual(frame.map(e=>[e.address,e.bytes]),
      [[0x6ffc,le32(x.frame.eflags)],[0x6ff8,le32(x.frame.cs)],
        [0x6ff4,le32(x.frame.eip)]])||
        events.some(e=>e.kind==='tick'&&e.ordinal>y.ordinal&&e.ordinal<x.ordinal))
      bad(at,'ACK-frame-delivery bus/tick sequence changed');
  }
  if(idle.slice(0,2).some(e=>!e.ifFlag||e.tick!==idle[0].tick)||
      idle.slice(2).some(e=>e.ifFlag||e.tick!==idle[2].tick)||
      idle.slice(0,4).some(e=>(e.pendingEvent&0x400)!==0)||
      (idle[4].pendingEvent&0x400)===0||
      !(idle[1].ordinal<line[2].ordinal&&idle[3].ordinal<line[4].ordinal)||
      !isDeepStrictEqual(idle[0].cursor,idle[1].cursor)||
      !isDeepStrictEqual(idle[2].cursor,idle[3].cursor)||
      !isDeepStrictEqual(idle[3].cursor,idle[4].cursor)||
      ack[1].tick!==idle[1].tick||irq[1].tick!==idle[1].tick)
    bad(at,'zero-tick idle or eligible wake sequence changed');
  const rep=events.filter(e=>e.kind==='write'&&e.address>=0x9000&&e.address<0xa000);
  if(rep.length!==1024||rep.some((e,i)=>e.address!==0x9000+4*i||e.bytes!=='00000000')||
      !rep.some(e=>e.ordinal<line[0].ordinal)||rep.every(e=>e.ordinal<line[0].ordinal))
    bad(at,'REP write coverage or in-REP deadline changed');
  const port=of('port');
  if(Buffer.from(port.map(e=>e.value)).toString('ascii')!=='BHEV001')bad(at,'marker changed');
  return {irq,idle};
}

function sliceProof(name,a,activation,events){
  const at='arms.'+name,budget=arms[name],slices=array(a.slices,at+'.slices');
  if(!slices.length)bad(at,'no resume calls');
  let prior={ticks:0,attempts:0,completed:0,repIterations:0,repPartial:0,
    faults:0,portCommits:0,irqDeliveries:0,haltIdleCuts:0};
  let cursor={cs:activation.cs,eip:activation.eip},end=-1,due=0,irqs=0,halts=0;
  for(const [i,s] of slices.entries()){
    const where=`${at}.slices[${i}]`;
    fields(s,['requestedTicks','effectiveTicks','chargedTicks','reason','entry','exit',
      'before','after','journalEndOrdinal'],where);
    if(s.requestedTicks!==budget||s.effectiveTicks<1||
        (budget!==null&&s.effectiveTicks>budget)||s.chargedTicks>s.effectiveTicks)
      bad(where,'requested/effective/charged budget invalid');
    uint(s.effectiveTicks,where+'.effectiveTicks');
    uint(s.chargedTicks,where+'.chargedTicks');
    equal(point(s.entry,where+'.entry'),cursor,where+'.entry continuity');
    tally(s.before,where+'.before');tally(s.after,where+'.after');
    for(const n of ['eventDue','pendingIrq','irqDelivered','ifFlag'])
      bool(s.after[n],where+'.after.'+n);
    for(const n of ['irqVector','activity','pendingEvent'])
      uint(s.after[n],where+'.after.'+n);
    for(const n of counts)if(s.before[n]!==prior[n]||s.after[n]<s.before[n])
      bad(where,n+' count discontinuity');
    if(s.after.ticks-s.before.ticks!==s.chargedTicks)bad(where,'tick charge differs');
    if(!['budget','port','halt','irq-delivered','event-due'].includes(s.reason))
      bad(where,'unsupported yield reason');
    if(s.reason==='budget'&&s.chargedTicks!==s.effectiveTicks)bad(where,'short budget return');
    if(s.reason==='event-due'){
      due++;if(s.after.ticks!==256||!s.after.eventDue||s.after.pendingIrq||
          s.chargedTicks!==s.effectiveTicks)bad(where,'deadline was not pre-action');
    }
    if(s.reason==='irq-delivered'){
      irqs++;if(!s.after.irqDelivered||s.after.irqVector!==0x20||
          !isDeepStrictEqual(point(s.exit,where+'.exit'),{cs:8,eip:0x7ebd}))
        bad(where,'IRQ did not cut before handler');
    }
    if(s.reason==='halt')halts++;
    const next=uint(s.journalEndOrdinal,where+'.journalEndOrdinal');
    if(next<end)bad(where,'journal boundary regressed');
    const owned=events.filter(e=>e.ordinal>end&&e.ordinal<=next);
    if(s.reason==='irq-delivered'&&!owned.some(e=>e.kind==='irq-delivered'))
      bad(where,'IRQ cut lacks delivery record');
    if(s.reason==='halt'&&!owned.some(e=>e.kind==='halt-idle'))
      bad(where,'idle cut lacks HLT observation');
    if(s.chargedTicks===0&&(!['irq-delivered','halt'].includes(s.reason)||
        s.after.attempts!==s.before.attempts||s.after.completed!==s.before.completed||
        owned.some(e=>e.kind==='tick')))
      bad(where,'zero-tick cut lacks justified progress');
    prior=s.after;cursor=point(s.exit,where+'.exit');end=next;
  }
  for(const n of counts)if(prior[n]!==a.totals[n])bad(at,n+' final count differs');
  if(due!==1||irqs!==2||halts<5||!isDeepStrictEqual(cursor,{cs:8,eip:0x7eb5}))
    bad(at,'event/IRQ/HLT inventory incomplete');
  if(name==='budget1'&&slices.length<1024)bad(at,'budget-one REP cuts absent');
  if(name==='budget2'&&!slices.some(s=>s.chargedTicks===2))bad(at,'budget two cap untested');
  if(name==='budget257'&&!slices.some(s=>s.chargedTicks===257))bad(at,'budget257 cap untested');
}

export function assertNativeEventsArm(name,a,activation){
  const at='arms.'+name;
  fields(a,['mode','requestedBudget','slices','journal','final','totals',
    'hostCallbacks','fallback'],at);
  if(a.mode!==name||a.requestedBudget!==arms[name])bad(at,'arm identity changed');
  const t=tally(a.totals,at+'.totals');
  if(t.faults!==0||t.repIterations!==1024||t.portCommits!==7||
      t.irqDeliveries!==2||t.haltIdleCuts!==5||!t.ticks||!t.completed)
    bad(at,'owned fixture count gate failed');
  const journal=journalProof(a,at);
  const evidence=eventProof(a,at,journal);
  const f=a.final;fields(f,['selectedState','ramWords'],at+'.final');
  fields(f.selectedState,state,at+'.final.selectedState');
  for(const n of state)uint(f.selectedState[n],at+'.final.selectedState.'+n);
  const cpu=f.selectedState;
  if(cpu.cs!==8||cpu.ds!==16||cpu.ss!==16||cpu.esp!==0x7000||
      cpu.edi!==0xa000||cpu.eax!==0x231||cpu.ecx!==0||cpu.ebp!==0x6ff4||
      cpu.eip!==0x7eb5||cpu.gdtrBase!==0x7f48||cpu.gdtrLimit!==23||cpu.idtrBase!==0||
      cpu.idtrLimit!==0x3ff||(cpu.eflags&0x200)!==0)
    bad(at,'terminal selected CPU state changed');
  equal(f.ramWords,{repStart:'00000000',repEnd:'00000000',shadow:1,irqCount:2,
    frame1:{eip:0x7e81,cs:8,eflags:evidence.irq[0].frame.eflags},
    frame2:{eip:0x7e90,cs:8,eflags:evidence.irq[1].frame.eflags}},
  at+'.final.ramWords');
  sliceProof(name,a,activation,journal);
  return {final:f,journal,totals:t,slices:a.slices.length};
}

export function assertNativeEventsSelfParity(report){
  fields(report,['schema','source','activation','armSeeds','apiProbes','arms','probes'],'report');
  const activation=sourceAndActivation(report);
  equal(Object.keys(object(report.arms,'arms')).sort(),Object.keys(arms).sort(),'arms keys');
  const proved=Object.fromEntries(Object.keys(arms).map(n=>
    [n,assertNativeEventsArm(n,report.arms[n],activation)]));
  const baseline=proved.continuous;
  for(const n of ['budget1','budget2','budget257']){
    const arm=proved[n];equal(arm.final,baseline.final,n+'.final');
    equal(arm.journal,baseline.journal,n+'.ordered native host journal');
    for(const key of ['ticks','completed','repIterations','faults','portCommits',
      'irqDeliveries','haltIdleCuts'])
      if(arm.totals[key]!==baseline.totals[key])bad(n+'.totals',key+' differs');
  }
  return {schema:'bw.bochs-cpu3-native-events-self-parity.v1',
    status:'native-host-event-self-parity',sourceRevision:report.source.boardRevision,
    activation,nativeTicks:baseline.totals.ticks,completed:baseline.totals.completed,
    repIterations:baseline.totals.repIterations,irqDeliveries:2,haltIdleCuts:5,
    portBytes:'BHEV001',
    slices:Object.fromEntries(Object.entries(proved).map(([n,a])=>[n,a.slices])),
    limitations:['one owned strict-386 native fixture and selected seed state only',
      'no AT chip, external-device IRQ arbitration, MMIO, A20 or DMA equivalence',
      'no complete reset/hidden state, JavaScript board parity, WASM build or speed measurement']};
}
