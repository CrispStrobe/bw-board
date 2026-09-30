/** Validate a bounded native CPU3 host-bus/yield self-comparison. */
import {isDeepStrictEqual} from 'node:util';

const schema='bw.bochs-cpu3-native-slice.v1';
const armsSpec={continuous:null,budget1:1,budget2:2,budget257:257};
const counters=['ticks','attempts','completed','repIterations','repPartial','faults','portCommits'];
const fallbackFields=['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'];
const probeFields=['outOfRangePhysical','unexpectedPio','bochsRamRead','bochsRamWrite',
  'bochsDirectPointer','bochsPio','bochsTimer'];
const probeGuards={
  outOfRangePhysical:['out-of-range-physical','host-physical-read'],
  unexpectedPio:['unexpected-pio','host-port-out'],
  bochsRamRead:['bochs-ram-read','Bochs-RAM-read-fallback'],
  bochsRamWrite:['bochs-ram-write','Bochs-RAM-write-fallback'],
  bochsDirectPointer:['bochs-direct-pointer','Bochs-direct-pointer-fallback'],
  bochsPio:['bochs-pio','Bochs-PIO-fallback'],
  bochsTimer:['bochs-timer','Bochs-timer-fallback'],
};
const apiProbeFields=['resume-before-activation','zero-budget','null-callbacks',
  'incomplete-callbacks'];
const fail=(where,message)=>{throw new Error(`native slice proof ${where}: ${message}`);};
const object=(value,where)=>{
  if(value===null || typeof value!=='object' || Array.isArray(value))
    fail(where,'object required');
  return value;
};
const array=(value,where)=>{
  if(!Array.isArray(value))fail(where,'array required');
  return value;
};
const uint=(value,where)=>{
  if(!Number.isSafeInteger(value) || value<0)fail(where,'nonnegative safe integer required');
  return value;
};
const bool=(value,where)=>{
  if(typeof value!=='boolean')fail(where,'boolean required');
  return value;
};
const hex=(value,where,length=null)=>{
  if(typeof value!=='string' || !/^[0-9a-f]+$/.test(value) || value.length%2 ||
      (length!==null && value.length!==length))
    fail(where,'lowercase even-length hexadecimal bytes required');
  return value;
};
const fields=(value,names,where)=>{
  for(const name of names)if(!Object.hasOwn(value,name))fail(where,`missing ${name}`);
};
const equal=(actual,expected,where)=>{
  if(!isDeepStrictEqual(actual,expected))fail(where,'continuous/sliced evidence differs');
};
const point=(value,where)=>{
  object(value,where); fields(value,['cs','eip'],where);
  uint(value.cs,`${where}.cs`);uint(value.eip,`${where}.eip`);
  return {cs:value.cs,eip:value.eip};
};
const counts=(value,where)=>{
  object(value,where);fields(value,counters,where);
  for(const name of counters)uint(value[name],`${where}.${name}`);
  return value;
};
const sameCounts=(a,b,where)=>{
  for(const name of counters)if(a[name]!==b[name])fail(where,`${name} discontinuity`);
};
const journal=(value,where,type)=>{
  array(value,where);
  let lastOrdinal=-1,lastTick=-1;
  for(const [i,item] of value.entries()){
    const at=`${where}[${i}]`;
    object(item,at);fields(item,['tick','ordinal'],at);
    const tick=uint(item.tick,`${at}.tick`),ordinal=uint(item.ordinal,`${at}.ordinal`);
    if(tick<lastTick || ordinal<=lastOrdinal)fail(at,'tick/ordinal order regressed');
    lastTick=tick;lastOrdinal=ordinal;
    if(type==='write'){
      fields(item,['address','bytes','kind'],at);
      uint(item.address,`${at}.address`);
      hex(item.bytes,`${at}.bytes`);
      const length=item.bytes.length/2;
      if(item.address+length>1048576 || (item.address&4095)+length>4096)
        fail(at,'write exceeds owned 1 MiB page domain');
      if(item.kind!=='host-physical')fail(at,'unexpected write provenance');
    }else{
      fields(item,['port','width','value'],at);
      uint(item.port,`${at}.port`);uint(item.width,`${at}.width`);
      uint(item.value,`${at}.value`);
      if(![1,2,4].includes(item.width) || item.value>=2**(8*item.width))
        fail(at,'port width/value mismatch');
    }
  }
  return value;
};

function validateFault(event,where){
  fields(event,['vector','errorCode','cr2','preTick','frame','handler','faulting'],where);
  if(uint(event.preTick,`${where}.preTick`)+1!==event.tick)
    fail(where,'native attempted-fault tick missing');
  if(event.vector!==14 || event.errorCode!==2 || event.cr2!==0x5000)
    fail(where,'expected one supervisor not-present write fault at 0x5000');
  const frame=object(event.frame,`${where}.frame`);
  fields(frame,['errorCode','eip','cs','eflags'],`${where}.frame`);
  for(const name of ['errorCode','eip','cs','eflags'])uint(frame[name],`${where}.frame.${name}`);
  if(frame.errorCode!==2 || frame.eip!==0x7ebe || (frame.cs&0xffff)!==8 ||
      (frame.eflags&0x00037fd7)!==0x00010046)
    fail(where,'fault frame does not match owned 386 gate');
  equal(point(event.handler,`${where}.handler`),{cs:8,eip:0x7ef3},`${where}.handler`);
  equal(point(event.faulting,`${where}.faulting`),{cs:8,eip:0x7ebe},`${where}.faulting`);
}

function validateArm(name,arm,activation){
  const where=`arms.${name}`,budget=armsSpec[name];
  object(arm,where);
  fields(arm,['mode','requestedBudget','slices','final','writes','ports','totals',
    'hostCallbacks','fallback'],where);
  if(arm.mode!==name || arm.requestedBudget!==budget)fail(where,'arm identity or budget changed');
  const slices=array(arm.slices,`${where}.slices`);
  if(!slices.length)fail(where,'no resume calls');
  const writes=journal(arm.writes,`${where}.writes`,'write');
  const ports=journal(arm.ports,`${where}.ports`,'port');
  if(writes.length<=1024)fail(where,'1024 REP writes and later RAM writes not evidenced');
  for(const [address,bytes] of [[0x9000,'03a00000'],[0xa014,'02500000'],
    [0xa014,'03500000'],[0x5000,'44332211'],[0x6ff0,'02000000']])
    if(!writes.some(write=>write.address===address && write.bytes===bytes))
      fail(where,`owned RAM write absent at ${address.toString(16)}:${bytes}`);
  const portBytes=ports.map(p=>{
    if(p.port!==0xe9 || p.width!==1)fail(where,'unexpected owned port');
    return p.value;
  });
  if(Buffer.from(portBytes).toString('ascii')!=='BHPG004')
    fail(where,'owned port marker differs');
  const fallback=object(arm.fallback,`${where}.fallback`);
  fields(fallback,fallbackFields,`${where}.fallback`);
  for(const field of fallbackFields)
    if(uint(fallback[field],`${where}.fallback.${field}`)!==0)
      fail(where,`Bochs ${field} fallback was used`);
  const totals=counts(arm.totals,`${where}.totals`);
  if(totals.faults!==1 || totals.portCommits!==7 || totals.repIterations!==1024 ||
      totals.completed===0 || totals.ticks===0)
    fail(where,'owned fixture count gate failed');
  if(totals.portCommits!==ports.length)fail(where,'port journal/count mismatch');
  for(const item of [...writes,...ports])
    if(item.tick>totals.ticks)fail(where,'journal tick exceeds final native ticks');
  const hostCallbacks=object(arm.hostCallbacks,`${where}.hostCallbacks`);
  fields(hostCallbacks,['physicalReads','physicalWrites','executePages','tickCallbacks'],
    `${where}.hostCallbacks`);
  for(const [field,value] of Object.entries(hostCallbacks))
    uint(value,`${where}.hostCallbacks.${field}`);
  if(hostCallbacks.physicalReads===0 || hostCallbacks.executePages===0 ||
      hostCallbacks.physicalWrites!==writes.length ||
      hostCallbacks.tickCallbacks!==totals.ticks)
    fail(where,'host callback totals do not substantiate bus/tick journal');
  const busSequence=[...writes.map(item=>({kind:'write',...item})),
    ...ports.map(item=>({kind:'port',...item}))]
    .sort((a,b)=>a.ordinal-b.ordinal);
  for(let i=1;i<busSequence.length;i++)
    if(busSequence[i].ordinal===busSequence[i-1].ordinal ||
        busSequence[i].tick<busSequence[i-1].tick)
      fail(where,'host bus ordinal/tick interleaving is invalid');
  const final=object(arm.final,`${where}.final`);
  fields(final,['selectedState','ramWords','frame'],`${where}.final`);
  const state=object(final.selectedState,`${where}.final.selectedState`);
  const stateFields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
    'cr0','cr2','cr3','cs','ds','ss','gdtrBase','gdtrLimit','idtrBase','idtrLimit'];
  fields(state,stateFields,`${where}.final.selectedState`);
  for(const field of stateFields)uint(state[field],`${where}.final.selectedState.${field}`);
  const expected={eax:0x11223334,ecx:0,edx:0,ebx:0,esp:0x7000,ebp:0x6ff0,
    esi:0,edi:0xa400,eip:0x7eeb,cr2:0x5000,cr3:0x9000,
    cs:8,ds:16,ss:16,gdtrBase:0x7f50,gdtrLimit:23,idtrBase:0,idtrLimit:0x3ff};
  for(const [field,value] of Object.entries(expected))
    if(state[field]!==value)fail(`${where}.final.selectedState`,`${field} differs from owned fixture`);
  if((state.eflags&0x00037fd7)!==0x46 ||
      ((state.cr0&0x8000001f)>>>0)!==0x80000011)
    fail(`${where}.final.selectedState`,'defined 386 flags/CR0 differ from native receipt');
  equal(final.ramWords,{pde0:'23a00000',pte5:'63500000',
    data5:'44332211',scratchCr2:'00500000'},`${where}.final.ramWords`);
  equal(final.frame,{errorCode:2,eip:0x7ebe,cs:8,eflags:0x10046},
    `${where}.final.frame`);
  let prior=counts(slices[0]?.before,`${where}.slices[0].before`);
  if(Object.values(prior).some(value=>value!==0))fail(where,'arm counters did not start at zero');
  let priorExit={cs:activation.cs,eip:activation.eip};
  let faultEvents=0,portEvents=0,portIndex=0,faultCutIndex=-1,faultRecord=null;
  const boundary=[];
  for(const [i,slice] of slices.entries()){
    const at=`${where}.slices[${i}]`;
    object(slice,at);
    fields(slice,['requestedTicks','chargedTicks','reason','entry','exit','before','after',
      'pendingFault','portCommitted','events'],at);
    if(slice.requestedTicks!==budget)fail(at,'requested tick budget differs');
    const charged=uint(slice.chargedTicks,`${at}.chargedTicks`);
    if(charged===0 || (budget!==null && charged>budget))fail(at,'zero progress or budget overrun');
    const entry=point(slice.entry,`${at}.entry`),exit=point(slice.exit,`${at}.exit`);
    equal(entry,priorExit,`${at}.entry continuity`);
    const before=counts(slice.before,`${at}.before`),after=counts(slice.after,`${at}.after`);
    sameCounts(before,prior,at);
    for(const name of counters)if(after[name]<before[name])fail(at,`${name} regressed`);
    if(after.ticks-before.ticks!==charged)fail(at,'charged tick delta mismatch');
    const pending=bool(slice.pendingFault,`${at}.pendingFault`);
    const committed=bool(slice.portCommitted,`${at}.portCommitted`);
    if(!['budget','fault-delivered','port'].includes(slice.reason))
      fail(at,'unsupported yield reason');
    if(slice.reason==='budget' && (budget===null || charged!==budget))
      fail(at,'budget yield did not consume requested ticks');
    const events=array(slice.events,`${at}.events`);
    let sliceFaults=0,slicePorts=0,lastOrdinal=-1,lastTick=-1;
    for(const [j,event] of events.entries()){
      const eventAt=`${at}.events[${j}]`;
      object(event,eventAt);fields(event,['kind','tick','ordinal'],eventAt);
      const tick=uint(event.tick,`${eventAt}.tick`);
      const ordinal=uint(event.ordinal,`${eventAt}.ordinal`);
      if(tick<before.ticks || tick>after.ticks || tick<lastTick || ordinal<=lastOrdinal)
        fail(eventAt,'event outside slice or out of order');
      lastTick=tick;lastOrdinal=ordinal;
      if(event.kind==='fault'){
        validateFault(event,eventAt);sliceFaults++;faultEvents++;
        faultRecord=event;
        if(event.tick!==after.ticks)fail(eventAt,'fault cut tick differs from catch');
        boundary.push({kind:'fault',tick:event.tick,vector:event.vector,
          errorCode:event.errorCode,cr2:event.cr2});
      }else if(event.kind==='port'){
        fields(event,['port','width','value'],eventAt);
        if(event.port!==0xe9 || event.width!==1 ||
            event.value!==ports[portIndex]?.value || event.tick!==ports[portIndex]?.tick ||
            event.ordinal!==ports[portIndex]?.ordinal)
          fail(eventAt,'port event/journal mismatch');
        portIndex++;slicePorts++;portEvents++;
        boundary.push({kind:'port',tick:event.tick,port:event.port,
          width:event.width,value:event.value});
      }else if(event.kind!=='tick')fail(eventAt,'unknown event kind');
    }
    if(after.faults-before.faults!==sliceFaults ||
        after.portCommits-before.portCommits!==slicePorts ||
        committed!==(slicePorts>0))
      fail(at,'fault/port count or commit flag differs from events');
    if(sliceFaults){
      if(sliceFaults!==1 || slice.reason!=='fault-delivered' || !pending ||
          !isDeepStrictEqual(exit,{cs:8,eip:0x7ef3}))
        fail(at,'fault cut must precede handler execution');
      faultCutIndex=i;
    }else if(pending)fail(at,'pending fault without fault cut');
    if(slice.reason==='fault-delivered' && !sliceFaults)
      fail(at,'fault-delivered without fault event');
    if(slice.reason==='port' && !committed)
      fail(at,'port yield before I/O commit');
    if(slice.reason==='port' && after.completed===before.completed)
      fail(at,'port yield before CPU instruction commit');
    prior=after;priorExit=exit;
  }
  sameCounts(prior,totals,`${where}.totals`);
  if(faultEvents!==1 || faultCutIndex<0 || faultCutIndex===slices.length-1 ||
      portEvents!==7 || portIndex!==ports.length)
    fail(where,'fault/retry or port event inventory incomplete');
  for(const [address,bytes] of [[0x6ffc,'46000100'],[0x6ff8,'08000000'],
    [0x6ff4,'be7e0000'],[0x6ff0,'02000000']]){
    const matching=writes.filter(write=>write.address===address && write.bytes===bytes &&
      write.tick===faultRecord.preTick && write.ordinal>faultRecord.ordinal);
    if(matching.length!==1)fail(where,'guest-written fault frame absent at native fault cut');
  }
  if(slices[faultCutIndex+1].entry.cs!==8 ||
      slices[faultCutIndex+1].entry.eip!==0x7ef3)
    fail(where,'fault handler was not the next resume entry');
  if(priorExit.cs!==final.selectedState.cs || priorExit.eip!==final.selectedState.eip)
    fail(where,'final CPU state differs from last resume exit');
  if(budget!==null && slices.length<2)fail(where,'bounded arm did not demonstrate re-entry');
  if(name==='continuous' && !slices.some(slice=>slice.chargedTicks>257))
    fail(where,'continuous arm has no uninterrupted long span');
  if(name==='budget2' && !slices.some(slice=>slice.chargedTicks===2))
    fail(where,'budget two never exercised its full boundary');
  if(name==='budget257' && !slices.some(slice=>slice.chargedTicks===257))
    fail(where,'budget 257 never exercised its full boundary');
  if(name==='budget1' && slices.length<1024)
    fail(where,'budget one did not cover the REP interval');
  if(name==='budget1' && totals.repPartial===0)
    fail(where,'budget one did not cut REP');
  return {final,writes,ports,busSequence,totals,boundary,sliceCount:slices.length};
}

/** Throws on malformed or materially divergent raw evidence. */
export function assertNativeSliceSelfParity(report){
  object(report,'report');
  fields(report,['schema','source','activation','armSeeds','apiProbes','arms','probes'],'report');
  if(report.schema!==schema)fail('report','schema mismatch');
  const source=object(report.source,'source');
  fields(source,['boardRevision','sourceHashes','bochsRevision','patchHashes',
    'configSha256','binarySha256','imageSha256','biosSha256','vgaBiosSha256'],'source');
  for(const field of ['boardRevision','bochsRevision'])
    hex(source[field],`source.${field}`,40);
  if(source.bochsRevision!=='0e45b736ef9792eb9b752b0a35db49eaf2faea47')
    fail('source.bochsRevision','unexpected pinned Bochs source revision');
  for(const field of ['configSha256','binarySha256','imageSha256','biosSha256','vgaBiosSha256'])
    hex(source[field],`source.${field}`,64);
  const hashes=object(source.sourceHashes,'source.sourceHashes');
  if(!Object.keys(hashes).length)fail('source.sourceHashes','no source inventory');
  for(const [path,hash] of Object.entries(hashes)){
    if(!path || path.startsWith('/') || path.split('/').includes('..'))
      fail('source.sourceHashes','unsafe source path');
    hex(hash,`source.sourceHashes.${path}`,64);
  }
  const patches=object(source.patchHashes,'source.patchHashes');
  if(!Object.keys(patches).length)fail('source.patchHashes','no patch inventory');
  for(const [path,hash] of Object.entries(patches)){
    if(!path || path.startsWith('/') || path.split('/').includes('..'))
      fail('source.patchHashes','unsafe patch path');
    hex(hash,`source.patchHashes.${path}`,64);
  }
  const activation=object(report.activation,'activation');
  fields(activation,['cs','eip','copiedBytes','tlbFlushed','prefetchInvalidated',
    'icacheFlushed','ramSha256','cpuSeedSha256'],'activation');
  if(activation.cs!==0 || activation.eip!==0x7e00 ||
      activation.copiedBytes!==1048576 || !bool(activation.tlbFlushed,'activation.tlbFlushed') ||
      !bool(activation.prefetchInvalidated,'activation.prefetchInvalidated') ||
      !bool(activation.icacheFlushed,'activation.icacheFlushed'))
    fail('activation','post-load owned bus activation incomplete');
  hex(activation.ramSha256,'activation.ramSha256',64);
  hex(activation.cpuSeedSha256,'activation.cpuSeedSha256',64);
  const seeds=object(report.armSeeds,'armSeeds');
  equal(Object.keys(seeds).sort(),Object.keys(armsSpec).sort(),'armSeeds keys');
  for(const [name,seed] of Object.entries(seeds)){
    object(seed,`armSeeds.${name}`);
    fields(seed,['ramSha256','cpuSeedSha256'],`armSeeds.${name}`);
    hex(seed.ramSha256,`armSeeds.${name}.ramSha256`,64);
    hex(seed.cpuSeedSha256,`armSeeds.${name}.cpuSeedSha256`,64);
    if(seed.ramSha256!==activation.ramSha256 ||
        seed.cpuSeedSha256!==activation.cpuSeedSha256)
      fail(`armSeeds.${name}`,'four native arms did not start from the same selected CPU/RAM seed');
  }
  const apiProbes=object(report.apiProbes,'apiProbes');
  equal(Object.keys(apiProbes).sort(),apiProbeFields.slice().sort(),'apiProbes keys');
  for(const name of apiProbeFields)
    if(apiProbes[name]!=='rejected')fail(`apiProbes.${name}`,'C ABI argument refusal absent');
  const probes=object(report.probes,'probes');
  fields(probes,probeFields,'probes');
  for(const name of probeFields){
    const probe=object(probes[name],`probes.${name}`);
    fields(probe,['rejected','kind','observedFailure'],`probes.${name}`);
    if(probe.rejected!==true || probe.kind!==probeGuards[name][0] ||
        probe.observedFailure!==probeGuards[name][1])
      fail(`probes.${name}`,'exact fail-closed guard was not observed');
  }
  const arms=object(report.arms,'arms');
  equal(Object.keys(arms).sort(),Object.keys(armsSpec).sort(),'arms keys');
  const parsed=Object.fromEntries(Object.keys(armsSpec).map(name=>
    [name,validateArm(name,arms[name],activation)]));
  const reference=parsed.continuous;
  for(const name of ['budget1','budget2','budget257']){
    const arm=parsed[name];
    equal(arm.final,reference.final,`${name}.final`);
    equal(arm.writes,reference.writes,`${name}.writes`);
    equal(arm.ports,reference.ports,`${name}.ports`);
    equal(arm.busSequence,reference.busSequence,`${name}.host bus sequence`);
    equal(arm.boundary,reference.boundary,`${name}.native fault/port tick sequence`);
    for(const count of ['ticks','completed','repIterations','faults','portCommits'])
      if(arm.totals[count]!==reference.totals[count])
        fail(`arms.${name}.totals`,`${count} differs from continuous`);
  }
  return {schema:'bw.bochs-cpu3-native-slice-self-parity.v1',status:'native-self-parity',
    sourceRevision:source.boardRevision,activation,
    comparedArms:Object.keys(armsSpec),
    nativeTicks:reference.totals.ticks,
    completed:reference.totals.completed,
    repIterations:reference.totals.repIterations,
    faultCount:reference.totals.faults,
    portBytes:Buffer.from(reference.ports.map(port=>port.value)).toString('ascii'),
    slices:Object.fromEntries(Object.entries(parsed).map(([name,arm])=>[name,arm.sliceCount])),
    limitations:['native continuous-versus-sliced owned self-parity only',
      'slice-dependent fetch/instruction hooks excluded',
      'no injected hardware event or JavaScript AT chip, IRQ, fault-charge or machine-cycle parity',
      'no WebAssembly build or speed measurement']};
}
