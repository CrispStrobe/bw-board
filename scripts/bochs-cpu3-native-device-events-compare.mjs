/** Fail-closed proof for one free CPU3 PIT0→single-PIC timer wake. */
import {isDeepStrictEqual} from 'node:util';

const budgets={continuous:1000000,budget1:1,budget2:2,budget257:257};
const mapId='ram00000-9ffff,mmio-a0000,rom-f0000-fffff,ram-100000-17ffff,openbus-rest';
const shaPattern=/^[0-9a-f]{64}$/;
const fail=(at,why)=>{throw Error(`native device proof ${at}: ${why}`);};
const obj=(x,at)=>{if(!x||typeof x!=='object'||Array.isArray(x))fail(at,'object required');return x;};
const arr=(x,at)=>{if(!Array.isArray(x))fail(at,'array required');return x;};
const fields=(x,keys,at)=>{obj(x,at);for(const key of keys)
  if(!Object.hasOwn(x,key))fail(at,`missing ${key}`);};
const uint=(x,at)=>{if(!Number.isSafeInteger(x)||x<0)fail(at,'nonnegative integer required');return x;};
const bool=(x,at)=>{if(typeof x!=='boolean')fail(at,'boolean required');return x;};
const equal=(a,b,at)=>{if(!isDeepStrictEqual(a,b))fail(at,'fixed expectation or arm parity differs');};
const sha=(x,at)=>{if(typeof x!=='string'||!shaPattern.test(x))fail(at,'SHA-256 required');};

function sourceProof(source){
  fields(source,['boardRevision','sourceHashes','bochsRevision','patchHashes',
    'binarySha256','configSha256','imageSha256','floppySha256','bochsrcSha256',
    'biosSha256','vgaBiosSha256','romIncludeSha256','mapId','timing'], 'source');
  if(typeof source.boardRevision!=='string'||!/^[0-9a-f]{40}$/.test(source.boardRevision)||
      source.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47'||
      source.imageSha256!=='ce06e9c8ebb8e014f548cf03ba2fd11b16b13e1eaed1ea58fd056da3bbc08cff'||
      source.biosSha256!=='6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'||
      source.vgaBiosSha256!=='76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1'||
      source.binarySha256!=='a97dc9f7519da1d65fd181e62dad4b5a88c60f6dce295c866e596bbd3ba632ca'||
      source.configSha256!=='d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c'||
      source.mapId!==mapId)
    fail('source','pinned upstream/free input identity changed');
  for(const key of ['binarySha256','configSha256','imageSha256','floppySha256',
    'bochsrcSha256','biosSha256','vgaBiosSha256','romIncludeSha256'])
    sha(source[key],`source.${key}`);
  for(const key of ['sourceHashes','patchHashes']){
    const values=obj(source[key],`source.${key}`);
    if(!Object.keys(values).length)fail(`source.${key}`,'empty inventory');
    for(const [path,value] of Object.entries(values)){
      if(!path||path.startsWith('/')||path.split('/').includes('..'))
        fail(`source.${key}`,'unsafe inventory path');
      sha(value,`source.${key}.${path}`);
    }
  }
  for(const [path,digest] of Object.entries({
    'scripts/bochs-cpu3-native-device-events/runtime.inc':
      'a24450d9ac314db4f3f69b09caa350dacdaf45d222ccd8f9a2fc7d1106be2eea',
    'scripts/prepare-bochs-cpu3-native-device-events.mjs':
      'b33ae2651a247f5e7682d13c4c8cf85d059dbab7b327e39a4fc6ca19e80bfa5e',
    'scripts/bochs-cpu3-native-device-events/patch.mjs':
      'd07b6e5f77f7376f05a16d06d17764a8766ce141f52ae2701d1b609e8322e958',
  }))if(source.sourceHashes[path]!==digest)
    fail('source','frozen native runtime/preparer bytes changed');
  equal(source.timing,{boardHz:6_000_000,clocksPerQuantum:6,pitHz:1_193_182,
    biosIps:10_000_000,hostEpoch:'fresh-zero-at-owned-setup'},'source.timing');
}

function hostProof(arm,at){
  fields(arm.host,['seed','journal','final'],'host');
  const seed=obj(arm.host.seed,at+'.host.seed'),final=obj(arm.host.final,at+'.host.final');
  equal([seed.nativeTicks,seed.successfulQuanta,seed.boardCycles,seed.idleBoardCycles,
    seed.pitFraction,seed.lineAsserted],[0,0,0,0,0,false],at+'.fresh model epoch');
  if(seed.pic.irr!==0||seed.pic.isr!==0||seed.pic.intActive!==false||
      seed.pit.counters[0].nullCount!==true)
    fail(at,'host model did not start freshly reset');
  const journal=arr(arm.host.journal,at+'.host.journal');
  for(const [index,event] of journal.entries()){
    fields(event,['ordinal','kind','nativeTicks','successfulQuanta','boardCycles'],
      `${at}.host.journal[${index}]`);
    if(event.ordinal!==index)fail(at,'host journal ordinal gap');
    for(const key of ['nativeTicks','successfulQuanta','boardCycles'])
      uint(event[key],`${at}.host.journal[${index}].${key}`);
  }
  const all=kind=>journal.filter(e=>e.kind===kind);
  const pio=all('pio'),output=pio.filter(e=>e.direction==='out');
  equal(output.map(e=>[e.port,e.value]),[
    [0x20,0x13],[0x21,0x20],[0x21,0x01],[0x21,0xfe],
    [0x43,0x30],[0x40,0x00],[0x40,0x10],
    [0x20,0x20],...[...Buffer.from('BDEV001')].map(value=>[0xe9,value])],
  at+'.guest PIO/PIC/PIT program');
  if(pio.some(e=>e.direction!=='out'||e.width!==1||
      e.before.boardCycles!==e.after.boardCycles))
    fail(at,'PIO read, width or unsettled device debt changed');
  const edge=all('pit-output').filter(e=>e.channel===0&&e.level===1);
  if(edge.length!==1||edge[0].nativeTicks!==all('idle-advance')[0]?.nativeTicks)
    fail(at,'timer edge was not a single HLT idle event');
  const lines=all('line-stage');
  equal(lines.map(e=>e.asserted),[true,false],at+'.staged native INTR line');
  const ack=all('pic-ack');
  if(ack.length!==1||ack[0].vector!==0x20||
      ack[0].beforePic.irr!==1||ack[0].afterPic.isr!==1||
      !(edge[0].ordinal<lines[0].ordinal&&lines[0].ordinal<ack[0].ordinal&&
        ack[0].ordinal<lines[1].ordinal&&lines[1].ordinal<output[7].ordinal))
    fail(at,'actual PIC edge/ACK/EOI order changed');
  const idle=all('idle-advance');
  if(idle.length!==1||!uint(idle[0].elapsedBoardCycles,at+'.idle cycles')||
      idle[0].nativeTicks!==ack[0].nativeTicks||
      idle[0].requestedCycles+idle[0].correctionCycles!==idle[0].elapsedBoardCycles)
    fail(at,'HLT device-time advance changed');
  if(final.nativeTicks!==final.successfulQuanta||
      final.boardCycles!==final.nativeTicks*6+final.idleBoardCycles||
      final.idleBoardCycles!==idle[0].elapsedBoardCycles||
      final.marker!=='BDEV001'||final.lineAsserted!==false||
      final.pic.irr!==0||final.pic.isr!==0||final.pic.imr!==0xfe||
      final.pic.vectorBase!==0x20||final.pic.intActive!==false||
      final.pit.counters[0].reload!==4096||final.pit.counters[0].mode!==0||
      final.pit.counters[0].out!==1||final.pit.counters[0].ce!==0||
      !(final.pitFraction>=0&&final.pitFraction<1))
    fail(at,'final actual model/clock state changed');
  return {journal,final,edge:edge[0],ack:ack[0],idle:idle[0]};
}

function nativeProof(arm,host,at){
  fields(arm.native,['seed','events','slices','finalState','ramFinal',
    'finalCounters','callbacks','fallback','apiProbes'],'native');
  const events=arr(arm.native.events,at+'.native.events');
  const by=tag=>events.filter(e=>e.tag===tag);
  const attempts=by('ATTEMPT'),ticks=by('TICK'),irq=by('IRQ_DELIVERED'),
    ack=by('IRQ_ACK'),idles=by('HALT_IDLE');
  if(!ticks.length||attempts.length!==ticks.length||
      ticks.length!==host.final.nativeTicks||irq.length!==1||ack.length!==1||
      idles.length<2)
    fail(at,'ordinary CPU/IRQ/HLT event count changed');
  if(!attempts.some(e=>e.cs===8&&e.eip===0x7e8f)||
      !attempts.some(e=>e.cs===8&&e.eip===0x7e9b)||
      !attempts.some(e=>e.cs===8&&e.eip===0x7ec9)||
      !attempts.some(e=>e.cs===8&&e.eip===0x7f11))
    fail(at,'owned guest phase did not execute');
  if(irq[0].vector!==0x20||irq[0].entryEip!==0x7e9c||
      irq[0].handlerEip!==0x7ec9||irq[0].frameEip!==0x7e9c||
      (irq[0].frameCs&0xffff)!==8||
      (irq[0].frameFlags&0x37fd7)!==0x246||
      irq[0].tick!==host.ack.nativeTicks||ack[0].vector!==0x20||
      ack[0].tick!==irq[0].tick)
    fail(at,'protected IRQ gate/frame differs from actual PIC vector');
  const firstHalt=idles.find(e=>e.cs===8&&e.eip===0x7e9c);
  const lastHalt=idles.find(e=>e.cs===8&&e.eip===0x7ec1);
  if(!firstHalt||!lastHalt||firstHalt.tick!==host.idle.nativeTicks||
      !(firstHalt.ordinal<irq[0].ordinal&&irq[0].ordinal<lastHalt.ordinal)||
      lastHalt.ifFlag!==false)
    fail(at,'HLT cut/wake/terminal order changed');
  const ram=arm.native.ramFinal;
  fields(ram,['shadow','irqCount','copiedEip','copiedCs','copiedFlags',
    'stackEip','stackCs','stackFlags','markerCount'],at+'.RAM_FINAL');
  if(ram.shadow!==1||ram.irqCount!==1||ram.copiedEip!==0x7e9c||
      (ram.copiedCs&0xffff)!==8||(ram.copiedFlags&0x37fd7)!==0x246||
      ram.stackEip!==ram.copiedEip||ram.stackCs!==ram.copiedCs||
      ram.stackFlags!==ram.copiedFlags||ram.markerCount!==7)
    fail(at,'owned RAM interrupt frame or marker changed');
  const state=arm.native.finalState;
  if(state.cs!==8||state.eip!==0x7ec1||state.esp!==0x7000||
      (state.eflags&0x200)!==0||(state.cr0&0x80000001)!==1)
    fail(at,'terminal selected CPU state changed');
  if(arm.native.finalCounters.ticks!==host.final.nativeTicks||
      arm.native.finalCounters.attempts!==host.final.nativeTicks||
      arm.native.finalCounters.completed!==host.final.nativeTicks||
      arm.native.finalCounters.irqDeliveries!==1||
      arm.native.finalCounters.haltIdleCuts<2)
    fail(at,'native counted CPU/IRQ/HLT work differs');
  for(const value of Object.values(obj(arm.native.fallback,at+'.fallback')))
    if(uint(value,at+'.fallback')!==0)fail(at,'Bochs device/timer fallback used');
  // RUN/CMD and RPC sequence numbers are host slicing administration. The
  // native CPU/bus/event chronology is compared after stripping only those
  // records and their global ordinals; raw records remain in the capture.
  const semanticEvents=events.filter(e=>
    !['CMD','RPC_REQ','RPC_REP'].includes(e.tag)).map(({ordinal,...e})=>e);
  return {events,semanticEvents,state,ram,finalCounters:arm.native.finalCounters};
}

export function assertNativeDeviceEventsProof(report){
  fields(report,['schema','source','arms','probes','artifacts'],'report');
  if(report.schema!=='bw.bochs-cpu3-native-device-events.v1')fail('report','schema changed');
  sourceProof(report.source);
  equal(Object.keys(obj(report.arms,'arms')).sort(),Object.keys(budgets).sort(),
    'four budget arms');
  const proved={};
  for(const [name,budget] of Object.entries(budgets)){
    const arm=report.arms[name],at=`arms.${name}`;
    fields(arm,['mode','requestedBudget','host','native','rpc','artifacts'],at);
    if(arm.mode!==name||arm.requestedBudget!==budget)fail(at,'budget identity changed');
    const host=hostProof(arm,at),native=nativeProof(arm,host,at);
    proved[name]={host,native};
  }
  const first=proved.continuous;
  for(const name of ['budget1','budget2','budget257']){
    equal(proved[name].host.journal,first.host.journal,name+'.actual PIT/PIC journal');
    equal(proved[name].host.final,first.host.final,name+'.final model state');
    equal(proved[name].native.semanticEvents,first.native.semanticEvents,
      name+'.native CPU/bus/event journal');
    equal(proved[name].native.state,first.native.state,name+'.final selected CPU');
    equal(proved[name].native.ram,first.native.ram,name+'.final RAM frame');
  }
  return {schema:'bw.bochs-cpu3-native-device-events-result.v1',
    status:'native-device-events-self-parity',sourceRevision:report.source.boardRevision,
    nativeTicks:first.host.final.nativeTicks,
    successfulQuanta:first.host.final.successfulQuanta,
    boardCycles:first.host.final.boardCycles,
    idleBoardCycles:first.host.final.idleBoardCycles,
    picVector:first.host.ack.vector,
    slices:Object.fromEntries(Object.entries(report.arms).map(([name,arm])=>
      [name,arm.native.slices.length])),
    limitations:['one free strict-386 CPU3 PIT0/single-PIC fixture',
      'fresh host model ownership begins after BIOS at 7e00',
      'six board clocks per ordinary successful quantum are functional, not physical timings',
      'no REP, fault, dual PIC, APIC, DMA, full AT, WASM, or speed qualification']};
}
