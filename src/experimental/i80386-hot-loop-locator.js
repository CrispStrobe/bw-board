// Observes ordinary completed steps only. No code read-ahead or guest execution.
const MODES=['real','protected16','vm86','protected32'];
const PREFIXES=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,0xf0,0xf2,0xf3]);
const bump=(object,key)=>{object[key]=(object[key]??0)+1;};
const modeOf=cpu=>!(cpu.cr0&1)?'real':cpu.eflags&0x20000?'vm86':
  cpu.segmentCaches[1].default32?'protected32':'protected16';
const identityOf=machine=>{
  const cpu=machine.cpu,cs=cpu.segmentCaches[1];
  return [cpu.cr0>>>0,cpu.cr3>>>0,cpu.cr4>>>0,cpu._translationGeneration??0,
    !!machine._a20Configured,!!machine._a20Enabled,cs,
    cs.base>>>0,cs.limit>>>0,!!cs.default32,!!cs.present,!!cs.code,
    !!cs.readable,!!cs.writable,!!cs.null,!!cs.expandDown,
    cs.type??null,cs.dpl??null,cs.rpl??null,cs.conforming??null,
    cs.access??null,cs.address??null];
};
const sameIdentity=(a,b)=>a.every((value,index)=>value===b[index]);
const byteKey=bytes=>bytes.map(byte=>byte.toString(16).padStart(2,'0')).join('');

export function decodeObservedBackwardJcc(bytes,eip,default32,postEip){
  if(!bytes.length||PREFIXES.has(bytes[0]))return null;
  const short=bytes[0]>=0x70&&bytes[0]<=0x7f;
  const near=bytes[0]===0x0f&&bytes[1]>=0x80&&bytes[1]<=0x8f;
  if(!short&&!near)return null;
  const size=short?1:default32?4:2,start=short?1:2;
  if(bytes.length!==start+size)return null;
  let disp=0;
  for(let i=0;i<size;i++)disp|=bytes[start+i]<<(8*i);
  disp=short?(disp<<24)>>24:size===2?(disp<<16)>>16:disp|0;
  if(disp>=0)return null;
  const fallthrough=(eip+bytes.length)>>>0;
  const target=default32?(fallthrough+disp)>>>0:(fallthrough+disp)&0xffff;
  if(postEip!==target&&postEip!==fallthrough)return null;
  return {target,fallthrough,outcome:postEip===target?'taken':'fallthrough',
    displacement:disp};
}

export function createI80386HotLoopLocator({maxCandidates=4096,maxActive=32,
  maxTraversalSteps=256,reportTop=64}={}){
  for(const [name,value,limit] of [['maxCandidates',maxCandidates,16384],
    ['maxActive',maxActive,256],['maxTraversalSteps',maxTraversalSteps,4096],
    ['reportTop',reportTop,256]])
    if(!Number.isInteger(value)||value<1||value>limit)
      throw new RangeError(`hot-loop ${name} must be 1..${limit}`);
  const modes=Object.fromEntries(MODES.map(mode=>[mode,{
    entryAttempts:0,completedSteps:0,noRetirement:0,abortedCalls:0,
    redirectedSteps:0,backwardJccTaken:0,backwardJccFallthrough:0,
    backwardJccPageCrossing:0,backwardJccTargetCrossing:0,
    completedTraversals:0,stepsInTraversals:0,
    traversalsAtLeast8:0,stepsInTraversalsAtLeast8:0,
    traversalsAtLeast16:0,stepsInTraversalsAtLeast16:0,
    traversalLengthHistogram:{},breaks:{},
  }]));
  let machine=null,pending=null,bytes=[],fetch8,fetchN,own8,ownN,ownInterrupt;
  let externalEpoch=0,interruptEpoch=0,sequence=0,evictions=0,activeOverflows=0;
  const active=new Map(),candidates=new Map();
  const csIds=new WeakMap();let nextCsId=1;
  const csId=cs=>{if(!csIds.has(cs))csIds.set(cs,nextCsId++);return csIds.get(cs);};
  const breakActive=reason=>{for(const item of active.values())
    bump(modes[item.mode].breaks,reason);active.clear();};
  const recordByte=(cpu,eip,value)=>{
    if(!pending||bytes.length>=15)return;
    if(!bytes.length){pending.fetchCs=cpu.cs;pending.fetchEip=eip>>>0;}
    bytes.push(value&255);
  };
  const keyOf=(before,branch)=>JSON.stringify({
    mode:before.mode,cs:before.cs,csBase:before.identity[7],
    csLimit:before.identity[8],csCacheId:csId(before.identity[6]),
    csDefault32:before.identity[9],csPresent:before.identity[10],
    csCode:before.identity[11],csReadable:before.identity[12],
    csWritable:before.identity[13],csNull:before.identity[14],
    csExpandDown:before.identity[15],csType:before.identity[16],
    csDpl:before.identity[17],csRpl:before.identity[18],
    csConforming:before.identity[19],
    csAccess:before.identity[20],csDescriptorAddress:before.identity[21],
    startEip:branch.target,endEip:before.eip,linearPage:before.linearPage,
    cr0:before.identity[0],cr3:before.identity[1],cr4:before.identity[2],
    translationGeneration:before.identity[3],
    a20Configured:before.identity[4],a20Enabled:before.identity[5],
    branchBytes:byteKey(bytes)});
  const complete=(item,outcome,length)=>{
    const bucket=modes[item.mode];
    bucket.completedTraversals++;bucket.stepsInTraversals+=length;
    bump(bucket.traversalLengthHistogram,Math.min(length,maxTraversalSteps));
    if(length>=8){bucket.traversalsAtLeast8++;bucket.stepsInTraversalsAtLeast8+=length;}
    if(length>=16){bucket.traversalsAtLeast16++;bucket.stepsInTraversalsAtLeast16+=length;}
    let record=candidates.get(item.key);
    if(!record){
      if(candidates.size>=maxCandidates){
        let leastKey=null,least=Infinity;
        for(const [key,value] of candidates)
          if(value.traversals<least){least=value.traversals;leastKey=key;}
        candidates.delete(leastKey);evictions++;
      }
      record={identity:JSON.parse(item.key),traversals:0,steps:0,
        outcomes:{},lengthHistogram:{},maxSteps:0};
      candidates.set(item.key,record);
    }
    record.traversals++;record.steps+=length;
    record.maxSteps=Math.max(record.maxSteps,length);
    bump(record.outcomes,outcome);bump(record.lengthHistogram,Math.min(length,64));
  };
  return {
    attach(target){
      if(machine||!target?.cpu||typeof target.cpu._fetch8!=='function'||
          typeof target.cpu._fetchN!=='function'||!target.hooks)
        throw new TypeError('hot-loop locator needs an unattached 386 machine');
      machine=target;const cpu=target.cpu;
      fetch8=cpu._fetch8;fetchN=cpu._fetchN;
      own8=Object.getOwnPropertyDescriptor(cpu,'_fetch8');
      ownN=Object.getOwnPropertyDescriptor(cpu,'_fetchN');
      ownInterrupt=Object.getOwnPropertyDescriptor(target.hooks,'onInterrupt');
      const oldInterrupt=target.hooks.onInterrupt;
      const wrapped8=function(...args){const eip=this.eip,value=fetch8.apply(this,args);
        recordByte(this,eip,value);return value;};
      const wrappedN=function(size,...args){
        const eip=this.eip,before=bytes.length,value=fetchN.call(this,size,...args);
        if(pending&&bytes.length===before)
          for(let i=0;i<size;i++)recordByte(this,eip+i,value/(2**(8*i))&255);
        return value;
      };
      const wrappedInterrupt=function(...args){interruptEpoch++;breakActive('interrupt');
        return oldInterrupt?.apply(this,args);};
      cpu._fetch8=wrapped8;cpu._fetchN=wrappedN;
      target.hooks.onInterrupt=wrappedInterrupt;
      return ()=>{
        if(cpu._fetch8===wrapped8){if(own8)Object.defineProperty(cpu,'_fetch8',own8);
          else delete cpu._fetch8;}
        if(cpu._fetchN===wrappedN){if(ownN)Object.defineProperty(cpu,'_fetchN',ownN);
          else delete cpu._fetchN;}
        if(target.hooks.onInterrupt===wrappedInterrupt){
          if(ownInterrupt)Object.defineProperty(target.hooks,'onInterrupt',ownInterrupt);
          else delete target.hooks.onInterrupt;
        }
        breakActive('end-of-observation');machine=null;pending=null;
      };
    },
    observe(target){
      if(target!==machine||pending)throw new TypeError('hot-loop locator observe mismatch');
      const cpu=target.cpu,eip=cpu.eip>>>0;
      pending={mode:modeOf(cpu),cs:cpu.cs,eip,
        linear:(cpu.segmentCaches[1].base+eip)>>>0,
        linearPage:((cpu.segmentCaches[1].base+eip)>>>0)>>>12,
        default32:!!cpu.segmentCaches[1].default32,identity:identityOf(target),
        cycles:cpu.cycles,fetchCs:null,fetchEip:null,
        externalEpoch,interruptEpoch,
        chipEventDue:target._chipDebt>=target._chipDeadline};
      bytes=[];modes[pending.mode].entryAttempts++;
    },
    retired(target){
      if(target!==machine||!pending)throw new TypeError('hot-loop locator has no pending step');
      const before=pending,cpu=target.cpu,bucket=modes[before.mode];pending=null;
      if(cpu.cycles===before.cycles){bucket.noRetirement++;breakActive('no-retirement');return;}
      bucket.completedSteps++;sequence++;
      if(before.fetchCs!==before.cs||before.fetchEip!==before.eip){
        bucket.redirectedSteps++;breakActive('entry-redirect');return;}
      if(before.externalEpoch!==externalEpoch){breakActive('external-event');return;}
      if(before.interruptEpoch!==interruptEpoch){breakActive('interrupt');return;}
      if(before.chipEventDue){breakActive('chip-event-due');return;}
      const afterIdentity=identityOf(target);
      if(!sameIdentity(before.identity,afterIdentity)){
        breakActive('post-step-identity-change');return;}
      for(const [key,item] of active){
        const reason=!sameIdentity(item.identity,before.identity)?'identity-change':
          item.mode!==before.mode?'mode-change':item.cs!==before.cs?'cs-change':
          item.linearPage!==before.linearPage?'linear-page-change':
          (before.linear&0xfff)+bytes.length>4096?
            'instruction-page-crossing':
          sequence-item.seedSequence>maxTraversalSteps?'traversal-budget':
          sequence===item.seedSequence+1&&before.eip!==item.startEip?
            'successor-mismatch':null;
        if(reason){bump(modes[item.mode].breaks,reason);active.delete(key);continue;}
        const observed=byteKey(bytes),prior=item.bytesByEip.get(before.eip);
        if(prior!==undefined&&prior!==observed){
          bump(modes[item.mode].breaks,'observed-code-mutation');
          active.delete(key);continue;
        }
        if(prior===undefined&&item.bytesByEip.size<maxTraversalSteps)
          item.bytesByEip.set(before.eip,observed);
        if(before.eip!==item.endEip)continue;
        const branch=decodeObservedBackwardJcc(bytes,before.eip,before.default32,cpu.eip>>>0);
        if(!branch||branch.target!==item.startEip||observed!==item.branchBytes){
          bump(modes[item.mode].breaks,'branch-changed');active.delete(key);continue;}
        const length=sequence-item.seedSequence;
        complete(item,branch.outcome,length);
        if(branch.outcome==='taken')item.seedSequence=sequence;
        else active.delete(key);
      }
      const branch=decodeObservedBackwardJcc(bytes,before.eip,before.default32,cpu.eip>>>0);
      if(!branch)return;
      bump(bucket,branch.outcome==='taken'?'backwardJccTaken':'backwardJccFallthrough');
      if(branch.outcome!=='taken')return;
      if((before.linear&0xfff)+bytes.length>4096){
        bucket.backwardJccPageCrossing++;return;
      }
      if((((before.identity[7]+branch.target)>>>0)>>>12)!==before.linearPage){
        bucket.backwardJccTargetCrossing++;return;
      }
      const key=keyOf(before,branch);
      if(active.has(key))return;
      if(active.size>=maxActive){activeOverflows++;return;}
      active.set(key,{key,mode:before.mode,cs:before.cs,identity:before.identity,
        linearPage:before.linearPage,startEip:branch.target,endEip:before.eip,
        branchBytes:byteKey(bytes),seedSequence:sequence,
        bytesByEip:new Map([[before.eip,byteKey(bytes)]])});
    },
    aborted(target){
      if(target!==machine||!pending)throw new TypeError('hot-loop locator has no pending step');
      modes[pending.mode].abortedCalls++;pending=null;breakActive('aborted-call');
    },
    externalEvent(){externalEpoch++;breakActive('external-event');},
    report(){return {schema:'bw.i80386-hot-loop-locator.v1',
      maxCandidates,maxActive,maxTraversalSteps,reportTop,
      candidateEvictions:evictions,activeOverflows,modes,
      topCandidatesByMode:Object.fromEntries(MODES.map(mode=>[mode,
        [...candidates.values()].filter(item=>item.identity.mode===mode)
          .sort((a,b)=>b.traversals-a.traversals).slice(0,reportTop)]))};},
  };
}
