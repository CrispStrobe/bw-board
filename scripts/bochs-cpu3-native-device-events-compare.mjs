/** Fail-closed proof for one free CPU3 PIT0→single-PIC timer wake. */
import {isDeepStrictEqual} from 'node:util';
import {createHash} from 'node:crypto';
import {NativeDeviceHost} from './bochs-cpu3-native-device-events-host.mjs';

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
const shaBytes=bytes=>createHash('sha256').update(bytes).digest('hex');
const expectedPatchPaths=['bochs/bochs.h','bochs/cpu/cpu.cc','bochs/cpu/event.cc',
  'bochs/cpu/exception.cc','bochs/cpu/paging.cc','bochs/iodev/devices.cc',
  'bochs/main.cc','bochs/memory/memory.cc','bochs/memory/misc_mem.cc',
  'bochs/pc_system.cc','bochs/pc_system.h'];
const requiredSourcePaths=[
  'scripts/bochs-cpu3-native-device-events/abi.h',
  'scripts/bochs-cpu3-native-device-events/runtime.h',
  'scripts/bochs-cpu3-native-device-events/runtime.inc',
  'scripts/bochs-cpu3-native-device-events/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-device-events.mjs',
  'scripts/bochs-cpu3-native-device-events-host.mjs',
  'scripts/bochs-cpu3-native-device-events-compare.mjs',
  'scripts/run-bochs-cpu3-native-device-events-compare.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/lib/i80386-source-inventory.mjs',
  'src/i8254.js','src/i8259.js','src/experimental/i80386-at-machine.js',
  'test/fixtures/i80386-bochs-cpu3-native-device-events.S',
  'test/i80386-native-device-events.test.mjs',
  'roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin',
  'docs/receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-capture.json'];

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
  equal(Object.keys(source.patchHashes).sort(),expectedPatchPaths.slice().sort(),
    'source.pinned Bochs patch path set');
  for(const path of requiredSourcePaths)
    if(!Object.hasOwn(source.sourceHashes,path))fail('source',`missing ${path}`);
  if(source.sourceHashes['docs/receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-capture.json']!==
    '7f5edc6639491b49b015784dda968e4786a271f71551e50a24b3350b30f5591a')
    fail('source','historical memory map receipt changed');
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
      final.nativeTicks!==92||final.idleBoardCycles!==20492||
      edge[0].boardCycles!==20804||edge[0].nativeTicks!==52||
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
  const seed=arm.native.activation;
  fields(seed,['cs','eip','copiedBytes','inheritedA20','decodedRamPages',
    'decodedRamSeedSha256','cpuSeedSha256','romId','mapId','handoff','a20Handoff'],
  at+'.activation');
  if(seed.cs!==0||seed.eip!==0x7e00||seed.copiedBytes!==1179648||
      seed.decodedRamPages!==288||seed.inheritedA20!==true||
      seed.decodedRamSeedSha256!==
        '210650a54b49507834a8d486274368cd8fd13efdaef5686eff0f505bc8e3ffea'||
      seed.cpuSeedSha256!==
        '61cb9e1fce52fda00241b80d70e6cf88f69c83559bc6521f7e4f39bae43904d7'||
      seed.romId.sha256!==
        '6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac'||
      seed.mapId!==mapId||seed.handoff.ownedPending!==0||
      seed.handoff.inheritedIF!==0||seed.a20Handoff.enabled!==true||
      seed.a20Handoff.latch!==2||seed.a20Handoff.source!=='8042-low')
    fail(at,'owned seed, ROM/map, IRQ or A20 handoff changed');
  equal(arm.native.seed,{ramSha256:seed.decodedRamSeedSha256,
    cpuSha256:seed.cpuSeedSha256},at+'.seed hashes');
  const expectedApi={
    'irq-before-activation':'rejected','resume-before-activation':'rejected',
    'zero-budget':'rejected','null-callbacks':'rejected',
    'incomplete-callbacks':'rejected','due-now':'zero-tick',
    'invalid-irq-line':'rejected','callback-reentry':'rejected',
    'line-reentry':'rejected'};
  equal(arm.native.apiProbes,expectedApi,at+'.actual native API probes');
  const records=arr(arm.native.records,at+'.native.records');
  const seedRows=records.filter(row=>row.tag==='SEEDPAGE');
  if(seedRows.length!==288)fail(at,'full decoded RAM seed pages absent');
  const memory=Buffer.alloc(0x180000);
  for(const row of seedRows){
    const page=Number(row.fields[0]);
    if(!Number.isInteger(page)||page<0||page>=384||
        !/^[0-9a-f]{8192}$/.test(row.fields[1]))
      fail(at,'invalid decoded RAM seed page');
    Buffer.from(row.fields[1],'hex').copy(memory,page*4096);
  }
  if(shaBytes(Buffer.concat(seedRows.map(row=>Buffer.from(row.fields[1],'hex'))))!==
      seed.decodedRamSeedSha256)fail(at,'seed RAM bytes/hash mismatch');
  let charged=0,memReads=0,memWrites=0;
  for(const [index,event] of events.entries()){
    if(event.ordinal!==index+1)fail(at,'native event ordinal gap');
    if(event.tag==='CMD')continue;
    if(event.tag==='TICK'){
      if(event.count!==1||event.preTick!==charged||event.tick!==charged+1)
        fail(at,'native tick callback schedule changed');
      charged++;
    }else if(event.tick!==charged)fail(at,'native event tick not current charged tick');
    if(event.tag==='MEM'){
      if(event.class!=='ram'||event.raw!==event.effective||
          event.effective>=memory.length||event.why!=='ordinary')
        fail(at,'owned RAM-only memory access changed');
      if(event.rw==='R'){
        memReads++;
        if(event.effect!=='ram-read'||event.value!==memory[event.effective])
          fail(at,'RAM read differs from ordered seed/write ledger');
      }else if(event.rw==='W'){
        memWrites++;
        if(event.effect!=='ram-commit')fail(at,'RAM write not committed');
        memory[event.effective]=event.value;
      }else fail(at,'unknown RAM operation');
    }
  }
  if(charged!==92||memReads!==96||memWrites!==38)
    fail(at,'owned native tick/RAM byte journal count changed');
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
  const word=at=>memory.readUInt32LE(at);
  if(memory[0x530]!==ram.shadow||memory[0x534]!==ram.irqCount||
      word(0x540)!==ram.copiedEip||word(0x544)!==ram.copiedCs||
      word(0x548)!==ram.copiedFlags||word(0x6ff4)!==ram.stackEip||
      word(0x6ff8)!==ram.stackCs||word(0x6ffc)!==ram.stackFlags)
    fail(at,'RAM witness differs from ordered byte journal');
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
  equal(arm.native.callbacks,{physicalReads:21,physicalWrites:15,
    executePages:4,tickCallbacks:92},at+'.actual host callback totals');
  const slices=arr(arm.native.slices,at+'.slices');
  let priorTick=0,priorExit={cs:0,eip:0x7e00};
  for(const [index,s] of slices.entries()){
    fields(s,['cmdSeq','requestedTicks','effectiveTicks','chargedTicks','reason',
      'entry','exit','beforeTick','afterTick','attempts','completed',
      'repIterations','repPartial','faults','portCommits','irqDeliveries',
      'haltIdleCuts','entryIf','exitIf','entryActivity','exitActivity',
      'eventDue','pendingIrq','irqDelivered','pendingFault','portCommitted'],
    `${at}.slices[${index}]`);
    for(const key of ['cmdSeq','requestedTicks','effectiveTicks','chargedTicks',
      'reason','beforeTick','afterTick','attempts','completed','repIterations',
      'repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'])
      uint(s[key],`${at}.slices[${index}].${key}`);
    for(const key of ['entryIf','exitIf','eventDue','pendingIrq','irqDelivered',
      'pendingFault','portCommitted'])bool(s[key],`${at}.slices[${index}].${key}`);
    if(s.requestedTicks!==arm.requestedBudget||s.effectiveTicks>s.requestedTicks||
        s.chargedTicks>s.effectiveTicks||s.beforeTick!==priorTick||
        s.afterTick!==s.beforeTick+s.chargedTicks||
        !isDeepStrictEqual(s.entry,priorExit)||s.reason<1||s.reason>7||
        [2,5].includes(s.reason)||s.repIterations!==0||s.repPartial!==0||
        s.faults!==0||s.pendingFault||s.attempts!==s.completed||
        s.completed!==s.afterTick)
      fail(at,'bounded slice, ordinary completion, or resume continuity changed');
    if(s.reason===1&&s.chargedTicks!==s.effectiveTicks)
      fail(at,'budget cut exceeded or failed to consume effective cap');
    if(s.reason===6&&(s.chargedTicks!==0||!s.irqDelivered||
        s.irqVector!==0x20||s.exit.eip!==0x7ec9))
      fail(at,'IRQ delivery charged a tick or entered handler');
    if(s.reason===4&&(s.exitActivity!==1||![[8,0x7e9c],[8,0x7ec1]]
      .some(([cs,eip])=>s.exit.cs===cs&&s.exit.eip===eip)))
      fail(at,'HLT cut at unexpected state');
    if(s.irqDelivered&&s.reason!==6)fail(at,'IRQ delivery hidden in ordinary slice');
    if(s.portCommitted&&s.reason!==3)fail(at,'PIO commit hidden in ordinary slice');
    priorTick=s.afterTick;priorExit=s.exit;
  }
  if(priorTick!==92||!isDeepStrictEqual(priorExit,{cs:8,eip:0x7ec1})||
      slices.at(-1).reason!==4||slices.at(-1).chargedTicks!==0||
      slices.filter(s=>s.reason===6).length!==1||
      !slices.some(s=>s.reason===4&&s.chargedTicks===0&&s.exit.eip===0x7e9c))
    fail(at,'zero-tick wake/idle or final STOP boundary missing');
  for(const value of Object.values(obj(arm.native.fallback,at+'.fallback')))
    if(uint(value,at+'.fallback')!==0)fail(at,'Bochs device/timer fallback used');
  // RUN/CMD and RPC sequence numbers are host slicing administration. The
  // native CPU/bus/event chronology is compared after stripping only those
  // records and their global ordinals; raw records remain in the capture.
  const semanticEvents=[];
  for(const {ordinal,...e} of events.filter(e=>
    !['CMD','RPC_REQ','RPC_REP'].includes(e.tag))){
    // Resuming an already-halted CPU can repeat the same administrative idle
    // observation, with no CPU or device event between. Keep every raw record
    // and slice; collapse only adjacent identical observations for self-parity.
    if(e.tag==='HALT_IDLE'&&isDeepStrictEqual(semanticEvents.at(-1),e))continue;
    semanticEvents.push(e);
  }
  return {events,semanticEvents,state,ram,finalCounters:arm.native.finalCounters};
}

function rpcProof(arm,at){
  fields(arm.rpc,['commands','requests','replies','dones'],at+'.rpc');
  const commands=arr(arm.rpc.commands,at+'.rpc.commands');
  const requests=arr(arm.rpc.requests,at+'.rpc.requests');
  const replies=arr(arm.rpc.replies,at+'.rpc.replies');
  const dones=arr(arm.rpc.dones,at+'.rpc.dones');
  const events=arm.native.events;
  equal(events.filter(e=>e.tag==='CMD').map(e=>
    ({seq:e.seq,verb:e.verb,arg:e.argument,deadline:e.deadline})),
  commands,at+'.native command transcript');
  if(commands.length!==dones.length||
      commands.filter(c=>c.verb==='RUN').length!==arm.native.slices.length||
      commands.filter(c=>c.verb==='LINE').length!==2||
      commands.at(-1)?.verb!=='STOP')
    fail(at,'RPC command/DONE schedule changed');
  for(const [index,c] of commands.entries()){
    if(c.seq!==index+1||!['RUN','LINE','STOP'].includes(c.verb)||
        dones[index].kind!=='DONE'||dones[index].seq!==c.seq||
        dones[index].verb!==c.verb)
      fail(at,'RPC command sequence/DONE mismatch');
    if(c.verb==='RUN'&&c.arg!==arm.requestedBudget)
      fail(at,'RUN budget command changed');
  }
  equal(commands.filter(c=>c.verb==='LINE').map(c=>c.arg),[1,0],
    at+'.between-slice line sequence');
  const runDones=dones.filter(d=>d.verb==='RUN');
  for(const [i,s] of arm.native.slices.entries()){
    const d=runDones[i];
    if(d.seq!==s.cmdSeq||d.reason!==s.reason||
        d.chargedTicks!==s.chargedTicks||d.cs!==s.exit.cs||d.eip!==s.exit.eip||
        d.totalTicks!==s.afterTick||d.attempts!==s.attempts||
        d.completed!==s.completed||d.ifFlag!==s.exitIf||
        d.activity!==s.exitActivity||d.irqDelivered!==s.irqDelivered)
      fail(at,'native DONE does not match bounded SLICE');
  }
  if(requests.length!==108||replies.length!==requests.length||
      arm.native.finalCounters.rpcRequests!==requests.length||
      arm.native.finalCounters.rpcReplies!==replies.length)
    fail(at,'synchronous RPC request/reply count changed');
  const reqEvents=events.filter(e=>e.tag==='RPC_REQ');
  const repEvents=events.filter(e=>e.tag==='RPC_REP');
  if(reqEvents.length!==requests.length||repEvents.length!==replies.length)
    fail(at,'native request/reply mirror incomplete');
  for(let i=0;i<requests.length;i++){
    const req=requests[i],rep=replies[i],ne=reqEvents[i],nr=repEvents[i];
    if(req.kind!=='REQ'||req.seq!==i+1||rep.seq!==i+1||
        ne.seq!==req.seq||ne.kind!==req.operation||
        ne.arg0!==req.arg0||ne.arg1!==req.arg1||ne.arg2!==req.arg2||
        ne.tick!==req.nativeTick||nr.seq!==rep.seq||nr.value!==rep.value||
        nr.tick!==req.nativeTick||!(ne.ordinal<nr.ordinal))
      fail(at,'native/host RPC request/reply transcript mismatch');
    const nextReqOrdinal=reqEvents[i+1]?.ordinal??Number.POSITIVE_INFINITY;
    const completionTag=req.operation==='TICK'?'TICK':
      req.operation==='ACK'?'IRQ_ACK':'PORT';
    const completions=events.filter(e=>e.tag===completionTag&&
      e.ordinal>nr.ordinal&&e.ordinal<nextReqOrdinal);
    if(!(ne.ordinal<nr.ordinal&&completions.length===1))
      fail(at,'RPC reply did not precede exactly one typed native completion');
    const completion=completions[0];
    if(req.operation==='TICK'&&
        (completion.preTick!==req.nativeTick||completion.tick!==req.nativeTick+1))
      fail(at,'native quantum charged before host TICK reply');
    if(req.operation==='PIO_OUT'&&
        (completion.direction!=='out'||completion.port!==req.arg0||
          completion.width!==req.arg1||completion.value!==req.arg2||
          completion.tick!==req.nativeTick))
      fail(at,'native port commit preceded or differs from host reply');
    if(req.operation==='ACK'&&
        (completion.vector!==rep.value||completion.tick!==req.nativeTick||
          !events.some(e=>e.tag==='IRQ_DELIVERED'&&
            e.ordinal>completion.ordinal&&e.tick===completion.tick)))
      fail(at,'IRQ delivery preceded or differs from PIC ACK reply');
  }
  const kinds=requests.reduce((counts,r)=>{
    counts[r.operation]=(counts[r.operation]??0)+1;return counts;},{});
  equal(kinds,{TICK:92,PIO_OUT:15,ACK:1},at+'.actual model RPC kinds');
  const ackIndex=requests.findIndex(r=>r.operation==='ACK');
  if(replies[ackIndex].value!==0x20||
      !requests.every((r,i)=>r.operation!=='TICK'||replies[i].value===0))
    fail(at,'PIC ACK vector or successful ordinary tick RPC changed');
  const ports=events.filter(e=>e.tag==='PORT');
  const pio=requests.filter(r=>r.operation==='PIO_OUT');
  equal(ports.map(e=>[e.direction,e.port,e.width,e.value,e.tick]),
    pio.map(r=>['out',r.arg0,r.arg1,r.arg2,r.nativeTick]),
  at+'.post-commit native/host PIO journal');
  // Replay the actual source-pinned JS PIT/PIC from the retained native RPC
  // chronology. This checks fractional crystal carry and every model state,
  // instead of accepting four arms that share the same false model snapshot.
  const model=new NativeDeviceHost();
  equal(model.state(),arm.host.seed,at+'.fresh host-model seed');
  const nativeCommands=events.filter(e=>e.tag==='CMD');
  let sliceIndex=0;
  for(let i=0;i<nativeCommands.length;i++){
    const cmd=nativeCommands[i],next=nativeCommands[i+1]?.ordinal??Infinity;
    for(const req of events.filter(e=>e.tag==='RPC_REQ'&&
      e.ordinal>cmd.ordinal&&e.ordinal<next)){
      const value=model.handleRequest(req.kind,req.arg0,req.arg1,req.arg2,req.tick);
      const reply=replies[req.seq-1];
      if(!reply||reply.value!==value)
        fail(at,'actual PIT/PIC replay differs at synchronous host callback');
    }
    if(cmd.verb==='RUN'){
      const slice=arm.native.slices[sliceIndex++];
      if(slice.reason===4&&slice.chargedTicks===0&&slice.exit.eip===0x7e9c){
        model.advanceHaltedToFirstEdge();
        if(model.stageLine()!==true)fail(at,'replayed idle timer did not assert PIC');
      }else if(slice.reason===6){
        if(model.stageLine()!==false)fail(at,'replayed PIC ACK did not deassert line');
      }
    }else if(cmd.verb==='LINE'&&model.lineAsserted!==Boolean(cmd.argument))
      fail(at,'staged native INTR differs from replayed PIC line');
  }
  equal(model.journal,arm.host.journal,at+'.source-model exact event/fraction journal');
  equal(model.state(),arm.host.final,at+'.source-model final fractional state');
}

function artifactProof(report){
  fields(report.artifacts,['bochsrc','floppy',...Object.keys(budgets),
    ...Object.keys(report.probes).map(name=>`guard-${name}`)],'artifacts');
  if(report.artifacts.bochsrc.sha256!==report.source.bochsrcSha256||
      report.artifacts.floppy.sha256!==report.source.floppySha256)
    fail('artifacts','bochsrc/floppy source pin changed');
  const files=(entry,names,at)=>{
    fields(entry,['files'],at);
    equal(Object.keys(entry.files).sort(),names.slice().sort(),at+'.file inventory');
    for(const [key,value] of Object.entries(entry.files)){
      fields(value,['path','sha256'],`${at}.${key}`);
      if(typeof value.path!=='string'||!/^[a-zA-Z0-9.-]+$/.test(value.path))
        fail(at,'unsafe artifact path');
      sha(value.sha256,`${at}.${key}.sha256`);
    }
  };
  for(const [name,arm] of Object.entries(report.arms)){
    equal(arm.artifacts,report.artifacts[name],`artifacts.${name}`);
    if(arm.artifacts.exitCode!==0||arm.artifacts.signal!==null)
      fail(`artifacts.${name}`,'normal arm did not exit zero');
    files(arm.artifacts,['stdout','stderr','rpcToNative','rpcFromNative','bochsLog'],
      `artifacts.${name}`);
  }
  const expected={
    'out-of-range-physical':'host-physical-read',
    'unsupported-span-width':'host-physical-read',
    'unexpected-pio':'host-port-out',
    'unsafe-execute-rom':'unsafe-execute-page',
    'unsafe-execute-mmio':'unsafe-execute-page',
    'unsafe-execute-unmapped':'unsafe-execute-page',
    'bochs-ram-read':'Bochs-RAM-read-fallback',
    'bochs-ram-write':'Bochs-RAM-write-fallback',
    'bochs-direct-pointer':'Bochs-direct-pointer-fallback',
    'bochs-pio':'Bochs-PIO-fallback',
    'bochs-timer':'Bochs-timer-fallback'};
  equal(Object.keys(report.probes).sort(),Object.keys(expected).sort(),
    'exact actual native abort guard inventory');
  for(const [name,reason] of Object.entries(expected)){
    const probe=report.probes[name];
    fields(probe,['name','expected','exit','observedFailure','files'],
      `probes.${name}`);
    if(probe.name!==name||probe.expected!==reason||
        probe.observedFailure!==reason||probe.exit.signal!=='SIGABRT'||
        probe.exit.code!==null)
      fail(`probes.${name}`,'wrong named SIGABRT guard');
    equal(probe.files,report.artifacts[`guard-${name}`],`probes.${name}.files`);
    files(probe,['stdout','stderr','bochsLog'],`probes.${name}`);
  }
}

/** Bounded diagnostic assertion for one actual arm before four-arm capture. */
export function assertNativeDeviceEventsArm(arm){
  fields(arm,['mode','requestedBudget','host','native','rpc','artifacts'],'arm');
  const host=hostProof(arm,'arm');
  const native=nativeProof(arm,host,'arm');
  rpcProof(arm,'arm');
  return {nativeTicks:host.final.nativeTicks,boardCycles:host.final.boardCycles,
    nativeEvents:native.events.length,slices:arm.native.slices.length};
}

/** Historical four-arm CPU/device proof, before transport malformation tests. */
export function assertNativeDeviceEventsCoreProof(report){
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
    rpcProof(arm,at);
    proved[name]={host,native};
  }
  artifactProof(report);
  const first=proved.continuous;
  for(const name of ['budget1','budget2','budget257']){
    equal(proved[name].host.journal,first.host.journal,name+'.actual PIT/PIC journal');
    equal(proved[name].host.final,first.host.final,name+'.final model state');
    equal(proved[name].native.semanticEvents,first.native.semanticEvents,
      name+'.native CPU/bus/event journal');
    equal(proved[name].native.state,first.native.state,name+'.final selected CPU');
    equal(proved[name].native.ram,first.native.ram,name+'.final RAM frame');
    equal(report.arms[name].native.seed,report.arms.continuous.native.seed,
      name+'.decoded RAM and selected CPU seed');
    equal(report.arms[name].native.callbacks,report.arms.continuous.native.callbacks,
      name+'.native callback totals');
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

const transportCases={
  'command-bad-sequence':{stage:'command',failure:'rpc-command-sequence',
    payload:`BWR7\tCMD\t2\tRUN\t1\t18446744073709551615\n`},
  'command-negative-budget':{stage:'command',failure:'rpc-decimal',
    payload:`BWR7\tCMD\t1\tRUN\t-1\t18446744073709551615\n`},
  'command-overflow-budget':{stage:'command',failure:'rpc-overflow',
    payload:`BWR7\tCMD\t1\tRUN\t18446744073709551616\t18446744073709551615\n`},
  'command-overlong-line':{stage:'command',failure:'rpc-line-bound',
    payload:`BWR7\tCMD\t1\tRUN\t1\t${'9'.repeat(256)}\n`},
  'reply-wrong-sequence':{stage:'reply',failure:'rpc-reply',
    payload:'BWR7\tREP\t2\tOK\t0\n'},
  'reply-negative-value':{stage:'reply',failure:'rpc-decimal',
    payload:'BWR7\tREP\t1\tOK\t-1\n'},
  'reply-out-of-range':{stage:'reply',failure:'rpc-reply-range',
    payload:'BWR7\tREP\t1\tOK\t4294967296\n'},
};

/** Final proof additionally demands seven actual native transport aborts. */
export function assertNativeDeviceEventsProof(report){
  const result=assertNativeDeviceEventsCoreProof(report);
  fields(report,['transportProbes'],'final report');
  equal(Object.keys(obj(report.transportProbes,'transport probes')).sort(),
    Object.keys(transportCases).sort(),'seven native transport guards');
  for(const [name,spec] of Object.entries(transportCases)){
    const at=`transportProbes.${name}`,probe=report.transportProbes[name];
    fields(probe,['name','stage','expected','exit','observedFailure','request','files'],at);
    if(probe.name!==name||probe.stage!==spec.stage||
        probe.expected!==spec.failure||probe.observedFailure!==spec.failure||
        probe.exit.code!==null||probe.exit.signal!=='SIGABRT')
      fail(at,'actual named SIGABRT transport guard changed');
    if(spec.stage==='command'&&probe.request!==null)fail(at,'command guard ran past READY');
    if(spec.stage==='reply'&&
        (probe.request?.kind!=='REQ'||probe.request.seq!==1||
          probe.request.operation!=='TICK'||probe.request.nativeTick!==0))
      fail(at,'reply guard did not intercept first native TICK');
    equal(probe.files,report.artifacts[`transport-${name}`],at+'.artifact index');
    equal(Object.keys(probe.files).sort(),
      ['stdout','stderr','rpcToNative','rpcFromNative','bochsLog'].sort(),
      at+'.raw file inventory');
    for(const [key,file] of Object.entries(probe.files)){
      fields(file,['path','sha256'],`${at}.${key}`);
      sha(file.sha256,`${at}.${key}.sha256`);
    }
    const command=spec.stage==='reply'?
      'BWR7\tCMD\t1\tRUN\t1\t18446744073709551615\n':'';
    const ready='BWR7\tREADY\t0000\t00007e00\t0\n';
    const request=spec.stage==='reply'?'BWR7\tREQ\t1\tTICK\t1\t0\t0\t0\n':'';
    if(probe.files.rpcToNative.sha256!==shaBytes(Buffer.from(command+spec.payload))||
        probe.files.rpcFromNative.sha256!==shaBytes(Buffer.from(ready+request)))
      fail(at,'raw command/request bytes differ from bounded malformation case');
  }
  return {...result,transportGuards:Object.keys(transportCases).length};
}
