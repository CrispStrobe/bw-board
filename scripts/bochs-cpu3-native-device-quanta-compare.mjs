/** Fail-closed selected proof for successful-work clocks in the free CPU3 fixture. */
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {NativeDeviceQuantumHost} from './bochs-cpu3-native-device-quanta-host.mjs';

const shaBytes=value=>createHash('sha256').update(value).digest('hex');
const shaPattern=/^[0-9a-f]{64}$/;
const budgets={continuous:1000000,budget1:1,budget2:2,budget257:257};
const mapId='ram00000-9ffff,mmio-a0000,rom-f0000-fffff,ram-100000-17ffff,openbus-rest';
const fail=(at,why)=>{throw Error(`native quanta proof ${at}: ${why}`);};
const check=(yes,at,why)=>{if(!yes)fail(at,why);};
const object=(x,at)=>{check(x&&typeof x==='object'&&!Array.isArray(x),at,'object required');return x;};
const array=(x,at)=>{check(Array.isArray(x),at,'array required');return x;};
const keys=(x,names,at)=>{object(x,at);for(const name of names)
  check(Object.hasOwn(x,name),at,`missing ${name}`);};
const uint=(x,at)=>check(Number.isSafeInteger(x)&&x>=0,at,'uint required');
const boolean=(x,at)=>check(typeof x==='boolean',at,'boolean required');
const equal=(a,b,at)=>check(isDeepStrictEqual(a,b),at,'fixed expectation or parity differs');
const digest=(x,at)=>check(typeof x==='string'&&shaPattern.test(x),at,'SHA-256 required');

const fixedInput={
  bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',
  imageSha256:'57f0247a8c198cd3aa0aa33b35e80d303eb3ae9ca50483cd22917e1d6d6b1d3c',
  biosSha256:'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac',
  vgaBiosSha256:'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1',
  configSha256:'d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c',
  mapId,
};
const requiredSourcePaths=[
  'scripts/bochs-cpu3-native-device-quanta/abi.h',
  'scripts/bochs-cpu3-native-device-quanta/runtime.h',
  'scripts/bochs-cpu3-native-device-quanta/runtime.inc',
  'scripts/bochs-cpu3-native-device-quanta/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-device-quanta.mjs',
  'scripts/bochs-cpu3-native-device-quanta-host.mjs',
  'scripts/bochs-cpu3-native-device-quanta-compare.mjs',
  'scripts/run-bochs-cpu3-native-device-quanta-compare.mjs',
  'test/fixtures/i80386-bochs-cpu3-native-device-quanta.S',
  'test/i80386-native-device-quanta.test.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'src/i8254.js','src/i8259.js','src/i8086-machine.js',
  'src/experimental/i80386.js','src/experimental/i80386-at-machine.js',
  'scripts/lib/i80386-source-inventory.mjs',
  'roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin',
  'docs/receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-capture.json',
];
const expectedPatchPaths=['bochs/bochs.h','bochs/cpu/cpu.cc','bochs/cpu/event.cc',
  'bochs/cpu/exception.cc','bochs/cpu/paging.cc','bochs/iodev/devices.cc',
  'bochs/main.cc','bochs/memory/memory.cc','bochs/memory/misc_mem.cc',
  'bochs/pc_system.cc','bochs/pc_system.h'];

function sourceProof(source){
  keys(source,['boardRevision','sourceHashes','patchHashes','binarySha256',
    'configSha256','bochsRevision','imageSha256','floppySha256','bochsrcSha256',
    'biosSha256','vgaBiosSha256','romIncludeSha256','mapId','timing'],'source');
  check(/^[0-9a-f]{40}$/.test(source.boardRevision),'source','board commit missing');
  for(const [name,value] of Object.entries(fixedInput))equal(source[name],value,`source.${name}`);
  for(const name of ['binarySha256','configSha256','imageSha256','floppySha256',
    'bochsrcSha256','biosSha256','vgaBiosSha256','romIncludeSha256'])
    digest(source[name],`source.${name}`);
  for(const name of ['sourceHashes','patchHashes']){
    object(source[name],`source.${name}`);
    for(const [path,value] of Object.entries(source[name])){
      check(path&&!path.startsWith('/')&&!path.split('/').includes('..'),
        `source.${name}`,'unsafe path');
      digest(value,`source.${name}.${path}`);
    }
  }
  equal(Object.keys(source.patchHashes).sort(),expectedPatchPaths.slice().sort(),
    'source.patched paths');
  for(const path of requiredSourcePaths)
    check(Object.hasOwn(source.sourceHashes,path),'source',`missing ${path}`);
  equal(source.sourceHashes[
    'docs/receipts/2026-09-30-i80386-bochs-cpu3-native-memory-map-capture.json'],
    '7f5edc6639491b49b015784dda968e4786a271f71551e50a24b3350b30f5591a',
    'source.predecessor receipt');
  equal(source.timing,{boardHz:6_000_000,clocksPerQuantum:6,pitHz:1_193_182,
    biosIps:10_000_000,hostEpoch:'fresh-zero-at-owned-setup'},'source.clock ownership');
}

function replayRam(native,at){
  const seedRows=native.records.filter(row=>row.tag==='SEEDPAGE');
  check(seedRows.length===288,at,'decoded RAM seed pages missing');
  const ram=Buffer.alloc(0x180000);
  for(let i=0;i<seedRows.length;i++){
    const row=seedRows[i],page=i<160?i:i+96;
    check(Number(row.fields[0])===page&&/^[0-9a-f]{8192}$/.test(row.fields[1]),
      at,'seed page sequence/bytes changed');
    Buffer.from(row.fields[1],'hex').copy(ram,page*4096);
  }
  const seed=Buffer.concat(seedRows.map(row=>Buffer.from(row.fields[1],'hex')));
  equal(shaBytes(seed),native.activation.decodedRamSeedSha256,at+'.seed digest');
  for(const event of native.events.filter(e=>e.tag==='MEM')){
    uint(event.raw,at+'.MEM.raw');uint(event.effective,at+'.MEM.effective');
    check(event.effective<=0x9ffff||(event.effective>=0x100000&&event.effective<ram.length),at,'memory outside decoded domain');
    check(event.raw===event.effective&&['R','W'].includes(event.rw)&&Number.isInteger(event.value)&&event.value>=0&&event.value<=255,at,'invalid identity mapped RAM byte');
    check(event.class==='ram'&&['ram-read','ram-commit'].includes(event.effect),
      at,'unexpected ROM/MMIO/open-bus access in owned fixture');
    if(event.rw==='R')equal(event.value,ram[event.effective],at+'.MEM read');
    else {equal(event.effect,'ram-commit',at+'.MEM write effect');
      ram[event.effective]=event.value;}
  }
  const word=address=>ram.readUInt32LE(address);
  const b=address=>ram[address];
  equal([word(0x9000),word(0xa014),word(0xa018),word(0x4000),word(0x4ffc),
    word(0x5000),word(0x500c),word(0x6000),word(0x6004),word(0x0520),word(0x0528),
    b(0x0524),b(0x0530),b(0x0534),word(0x0540),word(0x0544),word(0x0548),
    word(0x8ff4),word(0x8ff8),word(0x8ffc)],
    ['pde0','pte5','pte6','data4000','data4ffc','data5000','data500c',
      'data6000','data6004','cr2a','cr2b','pfCount','shadow','irqCount',
      'copiedEip','copiedCs','copiedFlags','stackEip','stackCs','stackFlags']
      .map(name=>native.ramFinal[name]),at+'.final RAM replay');
}

function armProof(arm,name){
  const at=`arms.${name}`;
  keys(arm,['mode','requestedBudget','host','native','rpc','artifacts'],at);
  equal(arm.mode,name,at+'.mode');equal(arm.requestedBudget,budgets[name],at+'.budget');
  const {host,native,rpc}=arm;
  keys(host,['seed','journal','final'],at+'.host');
  keys(native,['activation','records','events','slices','finalState','ramFinal',
    'finalCounters','callbacks','fallback','apiProbes'],at+'.native');
  keys(rpc,['commands','requests','replies','dones'],at+'.rpc');
  equal([host.seed.nativeTicks,host.seed.successfulQuanta,host.seed.boardCycles],
    [0,0,0],at+'.fresh host epoch');
  check(host.seed.pic.irr===0&&host.seed.pic.isr===0&&
    host.seed.pit.counters[0].nullCount===true,at,'host PIC/PIT not fresh');
  equal(native.activation.mapId,mapId,at+'.map');
  equal([native.activation.cs,native.activation.eip,native.activation.copiedBytes],
    [0,0x7e00,1179648],at+'.activation');
  equal(native.activation.romId.sha256,fixedInput.biosSha256,at+'.ROM');
  equal(native.seed,{ramSha256:native.activation.decodedRamSeedSha256,
    cpuSha256:native.activation.cpuSeedSha256},at+'.seed mirrors');
  check(native.ready.cs===0&&native.ready.eip===0x7e00&&
    native.ready.nativeTicks===0&&native.ready.successfulQuanta===0,
    at,'READY changed');
  replayRam(native,at);
  protocolProof(arm,at);
  const events=array(native.events,at+'.events');
  for(let i=0;i<events.length;i++){
    const e=events[i];uint(e.ordinal,at+'.ordinal');
    check(e.ordinal===i+1,at,'native event ordinal gap');
  }
  const type=tag=>events.filter(e=>e.tag===tag);
  const q=type('QUANTUM'),n=type('NATIVE_TICK');
  check(q.length===4041&&n.length===4043,at,'successful/native callback counts changed');
  for(let i=0;i<q.length;i++){
    const e=q[i];equal([e.preQ,e.successfulQuanta],[i,i+1],at+'.quantum ledger');
    check(e.kind===0||e.kind===1,at,'unknown quantum kind');
    if(e.kind===1){
      check([0x7f0c,0x7fcf].includes(e.eip)&&e.cs===8,at,'REP quantum at wrong instruction');
    }else check(e.eip!==0x7f0c&&e.eip!==0x7fcf,at,'REP charged as ordinary');
  }
  equal(type('QUANTUM').filter(e=>e.eip===0x7f0c).length,1028,at+'.REP 1028');
  equal(type('QUANTUM').filter(e=>e.eip===0x7fcf).length,1,at+'.REP final one');
  equal(type('QUANTUM').filter(e=>e.eip===0x7f64).length,1,at+'.zero-count REP');
  for(let i=0;i<n.length;i++)equal([n[i].count,n[i].preTick,n[i].nativeTicks],
    [1,i,i+1],at+'.native tick ledger');
  const begins=type('FAULT_BEGIN'),delivered=type('FAULT_DELIVERED');
  check(begins.length===2&&delivered.length===2,at,'two #PF cuts required');
  for(let i=0;i<2;i++){
    const b=begins[i],d=delivered[i],address=[0x5000,0x6000][i],
      eip=[0x7f0c,0x7f84][i],expectedQ=[3907,3953][i];
    equal([b.vector,b.error,b.cr2,b.cs,b.eip,b.successfulQuanta],
      [14,2,address,8,eip,expectedQ],at+`.fault${i}.cause`);
    equal([d.causeOrdinal,d.preTick,d.nativeTicks,d.successfulQuanta,
      d.handlerCs,d.handlerEip,d.sp,d.frameError,d.frameEip,d.frameCs],
      [b.ordinal,b.nativeTicks,b.nativeTicks+1,b.successfulQuanta,
        8,0x8026,0x8ff0,2,eip,8],at+`.fault${i}.delivery`);
    equal(d.frameFlags,0x10046,at+'.fault frame flags');
    check(!events.slice(b.ordinal,d.ordinal).some(e=>e.tag==='MEM'&&e.rw==='W'&&e.effective>=address&&e.effective<address+4),at,'failed operand committed');
    check(b.ordinal<d.ordinal&&
      events.slice(b.ordinal,d.ordinal-1).filter(e=>e.tag==='NATIVE_TICK').length===1,
      at,'fault tick/frame ordering changed');
    check(!events.slice(b.ordinal,d.ordinal-1).some(e=>e.tag==='QUANTUM'),
      at,'failed instruction charged functional quantum');
  }
  const ack=type('IRQ_ACK'),irq=type('IRQ_DELIVERED');
  check(ack.length===1&&irq.length===1,at,'one real PIC delivery required');
  equal([ack[0].vector,irq[0].vector,irq[0].handlerCs,irq[0].handlerEip,
    irq[0].frameEip,irq[0].frameCs],
    [0x20,0x20,8,0x809f,0x7ff9,8],at+'.PIC ACK/frame');
  check(delivered[1].ordinal<ack[0].ordinal&&ack[0].ordinal<irq[0].ordinal,
    at,'PIC ACK before both retries completed');
  const output=type('PORT').filter(e=>e.direction==='out');
  equal(output.map(e=>[e.port,e.value]),[
    [0x20,0x13],[0x21,0x20],[0x21,0x01],[0x21,0xfe],
    [0x43,0x30],[0x40,0x80],[0x40,0x00],[0x20,0x20],
    ...[...Buffer.from('BQNT001')].map(value=>[0xe9,value])],at+'.guest PIO');
  const c=native.finalCounters;
  equal([c.nativeTicks,c.successfulQuanta,c.repIterations,c.faults,
    c.irqDeliveries,c.nativeTickCallbacks,c.quantumCallbacks],
    [4043,4041,1029,2,1,4043,4041],at+'.final counters');
  equal([host.final.nativeTicks,host.final.successfulQuanta,host.final.boardCycles],
    [4043,4041,24246],at+'.functional clock');
  check(host.final.marker==='BQNT001'&&host.final.pic.irr===0&&
    host.final.pic.isr===0&&host.final.pic.imr===0xfe&&
    host.final.pic.vectorBase===0x20&&host.final.lineAsserted===false,
    at,'PIC EOI/marker state');
  equal([native.ramFinal.pde0,native.ramFinal.pte5,native.ramFinal.pte6,
    native.ramFinal.data4000,native.ramFinal.data4ffc,
    native.ramFinal.data5000,native.ramFinal.data500c,
    native.ramFinal.data6000,native.ramFinal.data6004,
    native.ramFinal.cr2a,native.ramFinal.cr2b,native.ramFinal.pfCount,
    native.ramFinal.shadow,native.ramFinal.irqCount,native.ramFinal.markerCount],
    [0xa023,0x5063,0x6063,0x11223344,0x11223344,0x11223344,
      0x11223344,0x55667788,0x99aabbcc,0x5000,0x6000,2,1,1,7],
    at+'.fixed RAM witness');
  check(native.ramFinal.copiedEip===0x7ff9&&
    native.ramFinal.stackEip===native.ramFinal.copiedEip&&
    native.ramFinal.stackCs===native.ramFinal.copiedCs&&
    native.ramFinal.stackFlags===native.ramFinal.copiedFlags&&
    (native.ramFinal.copiedFlags&0x37fd7)===0x246,
    at,'retained IRQ frame mismatch');
  check(native.finalState.eip===0x801e&&native.finalState.cs===8&&
    native.finalState.esp===0x9000&&
    ((native.finalState.cr0&0x80000001)>>>0)===0x80000001&&
    (native.finalState.eflags&0x200)===0,
    at,'selected final CPU state');
  check(native.callbacks.nativeTickCallbacks===4043&&
    native.callbacks.quantumCallbacks===4041&&
    Object.values(native.fallback).every(value=>value===0),
    at,'callback/fallback counts changed');
  check(array(native.slices,at+'.slices').length>0,at,'no bounded resumes');
  let previousN=0,previousQ=0;
  for(const slice of native.slices){
    equal([slice.requestedNativeTicks,slice.effectiveNativeTicks,slice.requestedQuanta],[1000000,1000000,budgets[name]],at+'.fixed slice limits');
    check(slice.beforeNativeTicks===previousN&&slice.beforeQuanta===previousQ,
      at,'slice ledger gap');
    check(slice.afterNativeTicks-slice.beforeNativeTicks===slice.chargedNativeTicks&&
      slice.afterQuanta-slice.beforeQuanta===slice.chargedQuanta&&
      slice.chargedNativeTicks<=slice.effectiveNativeTicks&&
      slice.chargedQuanta<=slice.requestedQuanta,
      at,'slice budget exceeded');
    previousN=slice.afterNativeTicks;previousQ=slice.afterQuanta;
  }
  equal([previousN,previousQ],[4043,4041],at+'.slice totals');
  const dueSlices=native.slices.filter(s=>s.eventDue);
  check(dueSlices.length===1,at,'one actual active timer cut required');
  equal([dueSlices[0].afterQuanta,dueSlices[0].exit.cs,dueSlices[0].exit.eip],[2985,8,0x7f0c],at+'.timer cut boundary');
  const edgeQuantum=q.find(e=>e.successfulQuanta===2985);
  equal([edgeQuantum.kind,edgeQuantum.postCX,edgeQuantum.postEDI&0xffff],[1,926,0x4198],at+'.timer partial progress');
  const pitEdges=host.journal.filter(e=>e.kind==='pit-output'&&
    e.channel===0&&e.level===1);
  check(pitEdges.length===1&&pitEdges[0].successfulQuanta===2985&&
    pitEdges[0].nativeTicks<begins[0].nativeTicks,
    at,'PIT edge did not occur in active REP before #PF');
  check(host.journal.some(e=>e.kind==='pic-ack'&&e.vector===0x20&&
    e.successfulQuanta===3999),at,'real PIC ACK timing changed');
  equal(rpc.requests.length,rpc.replies.length,at+'.RPC request/reply balance');
  equal(rpc.requests.length,c.rpcRequests,at+'.RPC counter');
  const requestKinds=rpc.requests.map(r=>r.operation);
  equal(requestKinds.filter(x=>x==='QUANTUM').length,4041,at+'.RPC quanta');
  equal(requestKinds.filter(x=>x==='NATIVE_TICK').length,4043,at+'.RPC native ticks');
  equal(requestKinds.filter(x=>x==='ACK').length,1,at+'.RPC PIC ACK');
  return {activation:native.activation,seed:native.seed,hostJournal:host.journal,finalHost:host.final,
    selectedState:native.finalState,ramFinal:native.ramFinal,
    logicalEvents:events.filter(e=>!['ATTEMPT','CMD','RPC_REQ','RPC_REP'].includes(e.tag))
      .map(({ordinal,causeOrdinal,...e})=>e),
    writes:events.filter(e=>e.tag==='MEM'&&e.rw==='W')
      .map(({raw,effective,class:kind,value,effect,tick,why})=>
        ({raw,effective,kind,value,effect,tick,why})),
    quantumJournal:q.map(({kind,cs,eip,postECX,postCX,postEDI,
      preQ,successfulQuanta,nativeTicks})=>
      ({kind,cs,eip,postECX,postCX,postEDI,preQ,successfulQuanta,nativeTicks})),
    nativeTickJournal:n.map(({count,preTick,nativeTicks,successfulQuanta})=>
      ({count,preTick,nativeTicks,successfulQuanta}))};
}

function protocolProof(arm,at){
  const {native,rpc,host}=arm;
  const replay=new NativeDeviceQuantumHost();
  equal(host.seed,replay.state(),at+'.host seed');
  const requests=native.events.filter(e=>e.tag==='RPC_REQ');
  const replies=native.events.filter(e=>e.tag==='RPC_REP');
  const commands=native.events.filter(e=>e.tag==='CMD');
  equal(requests.length,8100,at+'.RPC exact count');
  equal(replies.length,requests.length,at+'.RPC reply count');
  equal(commands.length,rpc.commands.length,at+'.command count');
  equal(rpc.dones.length,commands.length,at+'.completion count');
  let requestIndex=0,sliceIndex=0,n=0,q=0,active=null,attempt=null;
  let previousReply=null,completion=null,requestOperation=null;
  const repSeen=new Map();
  const finishAttempt=()=>{if(attempt){
    equal(attempt.ticks,attempt.quanta+(attempt.fault?1:0),at+'.attempt clock classification');
    if(!attempt.fault&&![0x7f0c,0x7fcf].includes(attempt.eip))
      equal(attempt.quanta,1,at+'.ordinary or zero-count attempt');
    attempt=null;
  }};
  for(const e of native.events){
    if(['QUANTUM','NATIVE_TICK','IRQ_ACK','PORT'].includes(e.tag))
      check(completion!==null&&previousReply===null,at,'typed completion without settled RPC');
    if(completion){
      const tag={QUANTUM:'QUANTUM',NATIVE_TICK:'NATIVE_TICK',
        ACK:'IRQ_ACK',PIO_IN:'PORT',PIO_OUT:'PORT'}[completion.kind];
      equal(e.tag,tag,at+'.REQ REP completion order');
      if(tag==='QUANTUM')equal(e.kind,completion.arg0,at+'.quantum RPC kind');
      if(tag==='NATIVE_TICK')equal(e.count,completion.arg0,at+'.native RPC count');
      if(tag==='IRQ_ACK')equal([e.vector,e.tick],[completion.value,n],at+'.ACK completion');
      if(tag==='PORT')equal([e.direction,e.port,e.width,e.value,e.tick],
        [completion.kind==='PIO_IN'?'in':'out',completion.arg0,completion.arg1,
          completion.kind==='PIO_IN'?completion.value:completion.arg2,n],at+'.PIO completion');
      completion=null;
    }
    if(e.tag==='CMD'){
      check(active===null,at,'overlapping commands');
      const c=rpc.commands[e.seq-1];
      equal(c,{seq:e.seq,verb:e.verb,arg0:e.arg0,arg1:e.arg1,deadline:e.deadline},at+'.command mirror');
      check(e.seq>=1&&e.seq<=commands.length,at,'command sequence');
      if(e.verb==='RUN'){
        equal([e.arg0,e.arg1,e.deadline],[1000000,arm.requestedBudget,'18446744073709551615'],at+'.independent budgets');
        active=e;
      }else{
        check(e.arg1===0&&e.deadline==='0',at,'non-RUN shape');
        if(e.verb==='LINE')equal(e.arg0,Number(replay.stageLine()),at+'.line handoff');
        else equal([e.verb,e.arg0],['STOP',0],at+'.STOP');
        const done=rpc.dones[e.seq-1];
        equal(done,{kind:'DONE',verb:e.verb,seq:e.seq,value:e.arg0,totalNativeTicks:n,totalQuanta:q},at+'.command DONE');
      }
    }else if(e.tag==='RPC_REQ'){
      check(active&&previousReply===null,at,'callback outside RUN or overlapping request');
      equal(e.seq,requestIndex+1,at+'.request sequence');
      equal([e.nativeTicks,e.successfulQuanta],[n,q],at+'.request ledger');
      equal(rpc.requests[requestIndex],{kind:'REQ',seq:e.seq,operation:e.kind,arg0:e.arg0,arg1:e.arg1,arg2:e.arg2,nativeTicks:n,successfulQuanta:q},at+'.request mirror');
      const value=replay.handleRequest(e.kind,e.arg0,e.arg1,e.arg2,n,q);
      previousReply={seq:e.seq,value,nativeTicks:n,successfulQuanta:q};
      requestOperation={kind:e.kind,arg0:e.arg0,arg1:e.arg1,arg2:e.arg2,value};
      requestIndex++;
    }else if(e.tag==='RPC_REP'){
      check(previousReply!==null,at,'unsolicited reply');
      equal({seq:e.seq,value:e.value,nativeTicks:e.nativeTicks,successfulQuanta:e.successfulQuanta},previousReply,at+'.reply mirror');
      equal(rpc.replies[e.seq-1],{seq:e.seq,value:e.value},at+'.wire reply');
      previousReply=null;completion=requestOperation;requestOperation=null;
    }else if(e.tag==='ATTEMPT'){
      check(active&&previousReply===null,at,'attempt outside settled RUN');
      equal([e.nativeTicks,e.successfulQuanta],[n,q],at+'.attempt ledger');
      finishAttempt();
      attempt={...e,quanta:0,ticks:0,fault:false};
    }else if(e.tag==='QUANTUM'){
      check(previousReply===null&&attempt&&!attempt.fault,at,'quantum without settled successful attempt');
      equal([e.cs,e.eip],[attempt.cs,attempt.eip],at+'.attempt identity');
      equal([e.preQ,e.successfulQuanta,e.nativeTicks],[q,q+1,n],at+'.ordered quantum ledger');
      if(e.kind===1){
        const limit=e.eip===0x7f0c?1028:1;
        const seen=(repSeen.get(e.eip)??0)+1;
        repSeen.set(e.eip,seen);
        equal(e.postCX,limit-seen,at+'.committed REP CX');
        equal(e.postEDI&0xffff,(e.eip===0x7f0c?0x4000:0x6004)+4*seen,at+'.committed REP DI');
      }else check(attempt.quanta===0,at,'ordinary attempt charged twice');
      attempt.quanta++;q++;
      equal([replay.nativeTicks,replay.successfulQuanta],[n,q],at+'.quantum callback settlement');
    }else if(e.tag==='NATIVE_TICK'){
      check(previousReply===null,at,'native tick before RPC reply');
      equal([e.preTick,e.nativeTicks,e.successfulQuanta],[n,n+1,q],at+'.ordered native ledger');
      if(attempt)attempt.ticks++;
      n++;
      equal([replay.nativeTicks,replay.successfulQuanta],[n,q],at+'.native callback settlement');
    }else if(e.tag==='FAULT_BEGIN'){
      check(attempt,at,'fault without attempt');attempt.fault=true;
    }
    // SLICE is a record rather than an event. Its command boundary is identified by the next CMD.
    if(e.tag==='CMD'&&e.verb==='RUN'){
      const slice=native.slices[sliceIndex++];
      equal(slice.cmdSeq,e.seq,at+'.slice command sequence');
      const done=rpc.dones[e.seq-1];
      equal(done,{kind:'DONE',verb:'RUN',seq:e.seq,reason:slice.reason,
        chargedNativeTicks:slice.chargedNativeTicks,chargedQuanta:slice.chargedQuanta,
        cs:slice.exit.cs,eip:slice.exit.eip,totalNativeTicks:slice.afterNativeTicks,
        totalQuanta:slice.afterQuanta,attempts:slice.attempts,completed:slice.completed,
        repIterations:slice.repIterations,faults:slice.faults,ifFlag:slice.exitIf,
        activity:slice.exitActivity,irqDelivered:slice.irqDelivered},at+'.RUN DONE mirror');
    }
    // The final event before a following command closes the current RUN.
    const next=native.events[e.ordinal];
    if(active&&(!next||next.tag==='CMD')){
      const slice=native.slices[sliceIndex-1];
      equal([slice.afterNativeTicks,slice.afterQuanta],[n,q],at+'.slice event ledger');
      check(previousReply===null&&completion===null,at,'RUN closes with outstanding callback or completion');
      finishAttempt();
      active=null;
    }
  }
  equal([requestIndex,sliceIndex],[rpc.requests.length,native.slices.length],at+'.protocol coverage');
  equal(replay.journal,host.journal,at+'.actual model replay journal');
  equal(replay.state(),host.final,at+'.actual model replay state');
  const ack=native.events.findIndex(e=>e.tag==='IRQ_ACK');
  const delivered=native.events.findIndex(e=>e.tag==='IRQ_DELIVERED');
  check(ack>=0&&delivered>ack&&!native.events.slice(ack,delivered+1)
    .some(e=>['QUANTUM','NATIVE_TICK'].includes(e.tag)),at,'IRQ delivery earned work');
  const expectedApi=['callback-reentry','line-reentry','irq-before-activation',
    'resume-before-activation','zero-native-budget','zero-quantum-budget','null-callbacks',
    'incomplete-native-tick','incomplete-quantum','due-now','invalid-irq-line','stale-deadline'];
  equal(Object.keys(native.apiProbes).sort(),expectedApi.sort(),at+'.API probe set');
  for(const key of expectedApi)equal(native.apiProbes[key],key==='due-now'?'zero-work':'rejected',at+'.API rejection');
}

function rejectionProof(report){
  const guards={
    'out-of-range-physical':'host-physical-read','unsupported-span-width':'host-physical-read',
    'unexpected-pio':'host-port-out','unsafe-execute-rom':'unsafe-execute-page',
    'unsafe-execute-mmio':'unsafe-execute-page','unsafe-execute-unmapped':'unsafe-execute-page',
    'bochs-ram-read':'Bochs-RAM-read-fallback','bochs-ram-write':'Bochs-RAM-write-fallback',
    'bochs-direct-pointer':'Bochs-direct-pointer-fallback','bochs-pio':'Bochs-PIO-fallback',
    'bochs-timer':'Bochs-timer-fallback'};
  const transports={
    'command-bad-sequence':'rpc-command-sequence','command-negative-budget':'rpc-decimal',
    'command-overflow-budget':'rpc-overflow','command-overlong-line':'rpc-line-bound',
    'reply-wrong-sequence':'rpc-reply','reply-negative-value':'rpc-decimal',
    'reply-out-of-range':'rpc-reply-range'};
  const seen=new Set();
  const artifact=(entry,at)=>{
    keys(entry,['path','sha256'],at);
    check(typeof entry.path==='string'&&/^[a-zA-Z0-9.-]+$/.test(entry.path),at,'unsafe artifact path');
    digest(entry.sha256,at);
    check(!seen.has(entry.path),at,'duplicate artifact path');seen.add(entry.path);
  };
  equal(Object.keys(report.probes).sort(),Object.keys(guards).sort(),'guard set');
  equal(Object.keys(report.transportProbes).sort(),Object.keys(transports).sort(),'transport set');
  for(const [group,expected,prefix] of [[report.probes,guards,'guard'],
    [report.transportProbes,transports,'transport']]){
    for(const [name,reason] of Object.entries(expected)){
      const probe=group[name];
      equal([probe.name,probe.expected,probe.observedFailure],[name,reason,reason],prefix+'.reason');
      check(probe.exit.code===null&&probe.exit.signal==='SIGABRT',prefix,'rejection exit changed');
      if(prefix==='transport')equal(probe.stage,name.startsWith('command-')?'command':'reply',prefix+'.stage');
      equal(probe.files,report.artifacts[`${prefix}-${name}`],prefix+'.artifact mirror');
      const names=prefix==='guard'?['stdout','stderr','bochsLog']:
        ['stdout','stderr','rpcToNative','rpcFromNative','bochsLog'];
      equal(Object.keys(probe.files).sort(),names.sort(),prefix+'.artifact set');
    }
  }
  const expectedGroups=['bochsrc','floppy',...Object.keys(budgets),
    ...Object.keys(guards).map(n=>`guard-${n}`),...Object.keys(transports).map(n=>`transport-${n}`)];
  equal(Object.keys(report.artifacts).sort(),expectedGroups.sort(),'artifact group set');
  for(const [name,group] of Object.entries(report.artifacts)){
    if(['bochsrc','floppy'].includes(name))artifact(group,name);
    else for(const [kind,entry] of Object.entries(group))artifact(entry,`${name}.${kind}`);
  }
  equal(report.artifacts.bochsrc.sha256,report.source.bochsrcSha256,'bochsrc artifact digest');
  equal(report.artifacts.floppy.sha256,report.source.floppySha256,'floppy artifact digest');
  for(const name of Object.keys(budgets)){
    equal(report.arms[name].artifacts,report.artifacts[name],name+'.artifact mirror');
    equal(Object.keys(report.artifacts[name]).sort(),
      ['stdout','stderr','rpcToNative','rpcFromNative','bochsLog'].sort(),name+'.artifact set');
  }
}

export function assertNativeDeviceQuantaProof(report){
  keys(report,['schema','source','arms','probes','transportProbes','artifacts'],'report');
  equal(report.schema,'bw.bochs-cpu3-native-device-quanta.v1','schema');
  sourceProof(report.source);
  rejectionProof(report);
  equal(Object.keys(report.arms).sort(),Object.keys(budgets).sort(),'arm set');
  const evidence=Object.fromEntries(Object.keys(budgets).map(name=>
    [name,armProof(report.arms[name],name)]));
  const reference=evidence.continuous;
  for(const name of ['budget1','budget2','budget257']){
    const observed=evidence[name];
    for(const field of ['activation','seed','hostJournal','finalHost','selectedState','ramFinal',
      'logicalEvents','writes','quantumJournal','nativeTickJournal'])
      equal(observed[field],reference[field],`arms.${name}.${field}`);
  }
  return {status:'native-device-quanta-proof-pass',nativeTicks:4043,
    successfulQuanta:4041,boardCycles:24246,
    slices:Object.fromEntries(Object.entries(report.arms)
      .map(([name,arm])=>[name,arm.native.slices.length]))};
}
