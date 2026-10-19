// Observation only. Ordinary machine.step() remains the sole executor.
import {classifyI80386BroadForm} from './i80386-broad-block-census.js';

const MODES=['real','protected16','vm86','protected32'];
const PREFIXES=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,
  0xf0,0xf2,0xf3]);
const MODRM=new Set([0x01,0x03,0x09,0x0b,0x21,0x23,0x29,0x2b,
  0x31,0x33,0x39,0x3b,0x80,0x81,0x83,0x85,0x88,0x89,0x8a,0x8b,
  0x8d,0xc0,0xc1,0xd0,0xd1,0xd2,0xd3]);
const SIMPLE=new Set([0x05,0x24,0x25,0x3c,0x3d,0xa8]);
const bump=(map,key)=>{map[key]=(map[key]??0)+1;};
const modeOf=cpu=>!(cpu.cr0&1)?'real':(cpu.eflags&0x20000)?'vm86':
  cpu.segmentCaches[1].default32?'protected32':'protected16';
const identityOf=machine=>{
  const cpu=machine.cpu;
  const identity=[cpu.cr0>>>0,cpu.cr3>>>0,cpu.cr4>>>0,
    cpu._translationGeneration??0,cpu.cs,cpu.currentPrivilegeLevel,
    !!machine._a20Configured,!!machine._a20Enabled];
  for(let index=0;index<6;index++){
    const cache=cpu.segmentCaches?.[index];
    identity.push(cache?.base,cache?.limit,!!cache?.null,!!cache?.present,
      !!cache?.code,!!cache?.readable,!!cache?.writable,
      !!cache?.expandDown,!!cache?.default32);
  }
  return identity;
};
const sameIdentity=(a,b)=>a.length===b.length&&
  a.every((value,index)=>value===b[index]);
const signed=(value,bits)=>bits===8?(value<<24)>>24:
  bits===16?(value<<16)>>16:value|0;
const branchOf=(bytes,start,postEip)=>{
  let at=0;
  while(at<bytes.length&&PREFIXES.has(bytes[at]))at++;
  if(at)return null; // Prefix-bearing control is left to the ordinary CPU.
  const op=bytes[0],shortJcc=op>=0x70&&op<=0x7f;
  const nearJcc=op===0x0f&&bytes[1]>=0x80&&bytes[1]<=0x8f;
  const shortJmp=op===0xeb,nearJmp=op===0xe9;
  if(!shortJcc&&!nearJcc&&!shortJmp&&!nearJmp)return null;
  const width=shortJcc||shortJmp?1:2;
  const head=nearJcc?2:1;
  if(bytes.length!==head+width)return null;
  let displacement=0;
  for(let i=0;i<width;i++)displacement|=bytes[head+i]<<(8*i);
  displacement=signed(displacement,width*8);
  const fallthrough=(start+bytes.length)>>>0;
  const target=(fallthrough+displacement)&0xffff;
  if((shortJcc||nearJcc)&&postEip!==target&&postEip!==fallthrough)
    return null;
  if((shortJmp||nearJmp)&&postEip!==target)return null;
  return {target,fallthrough,taken:postEip===target};
};
const formOf=bytes=>{
  let at=0;
  while(at<bytes.length&&PREFIXES.has(bytes[at]))at++;
  const op=bytes[at],modrm=bytes[at+1];
  if(op===undefined)return {reason:'missing-opcode'};
  // A prefix changes width, segment selection, or interruptibility. This
  // deliberately narrow grammar has no proof for those variants yet.
  if(at)return {reason:'prefixed-form'};
  if(SIMPLE.has(op)&&at===0)return {kind:'linear',needsData:false};
  const broad=classifyI80386BroadForm(bytes);
  if(broad.reason)return {reason:broad.reason};
  if(broad.kind==='control-flow')return {kind:'control-flow'};
  if(broad.kind!=='linear')return {reason:broad.kind??'unsupported-form'};
  if(MODRM.has(op)&&modrm===undefined)return {reason:'missing-modrm'};
  const needsData=(MODRM.has(op)&&((modrm>>>6)!==3))||
    (op>=0x50&&op<=0x5f);
  return {kind:'linear',needsData};
};

export function createI80386Code16EventRunObserver({maxRun=64,onObservedStep=null}={}) {
  if(!Number.isInteger(maxRun)||maxRun<1||maxRun>64)
    throw new RangeError('code16 observed run budget must be 1..64');
  if(onObservedStep!==null&&typeof onObservedStep!=='function')
    throw new TypeError('onObservedStep must be a function');
  const modes=Object.fromEntries(MODES.map(mode=>[mode,{
    entryAttempts:0,retiredSteps:0,noRetirement:0,abortedCalls:0,
    admittedOrdinals:0,refusedOrdinals:0,runs:0,
    stepsInRunsAtLeast4:0,runLengthHistogram:{},runEndReasons:{},
    refusals:{}}]));
  let machine=null,pending=null,run=null,externalEpoch=0,deviceReads=0,
    deviceWrites=0,restores=[];
  const endRun=reason=>{
    if(!run)return;
    const bucket=modes[run.mode];
    bucket.runs++;
    bump(bucket.runLengthHistogram,run.length);
    bump(bucket.runEndReasons,reason);
    if(run.length>=4)bucket.stepsInRunsAtLeast4+=run.length;
    run=null;
  };
  const restoreOwn=(object,key,wrapped)=>{
    const own=Object.getOwnPropertyDescriptor(object,key),old=object[key];
    object[key]=wrapped(old);
    restores.push(()=>{
      if(own)Object.defineProperty(object,key,own);
      else delete object[key];
    });
  };
  const recordCode=(address,width=1)=>{
    if(!pending)return;
    const firstAddress=machine._decode386(address>>>0);
    const lastAddress=machine._decode386((address+width-1)>>>0);
    const first=firstAddress>>>12,last=lastAddress>>>12;
    if(pending.codePage===null)pending.codePage=first;
    if(first!==pending.codePage||last!==pending.codePage)
      pending.codePageCrossing=true;
    // Executable ROM and mapped devices can carry read side effects or
    // aliasing beyond the proposed RAM-only code-window proof.
    if(firstAddress>=machine.memoryBytes||lastAddress>=machine.memoryBytes||
        machine._page?.[first]!==1||machine._page?.[last]!==1||
        firstAddress>=0x9fc00&&firstAddress<0xc0000||
        lastAddress>=0x9fc00&&lastAddress<0xc0000)
      pending.unsafeCode=true;
  };
  const recordAccess=(address,width,write)=>{
    if(!pending)return;
    pending.dataAccesses++;
    for(let i=0;i<width;i++){
      const raw=(address+i)>>>0,decoded=machine._decode386(raw);
      const page=decoded>>>12,kind=machine._page?.[page];
      const overlay=(decoded>=0xa0000&&decoded<0xc0000)||
        (decoded>=0x9fc00&&decoded<0x9fd50)||
        (decoded>=0xfee00000&&decoded<0xfee01000)||
        (decoded>=0xfec00000&&decoded<0xfec00020);
      if(raw>=0xffff0000||decoded>=machine.memoryBytes||overlay||
         (write?kind!==1:kind!==1&&kind!==2))pending.unsafeData=true;
      if(write&&(page===pending.codePage||
          machine.cpu._translationTablePages?.has(page)))
        pending.codeOrTableWrite=true;
    }
  };
  const recordByte=(cpu,eip,value)=>{
    if(!pending||pending.bytes.length>=15)return;
    if(pending.bytes.length===0){
      pending.fetchCs=cpu.cs;pending.fetchEip=eip>>>0;
    }
    pending.bytes.push(value&255);
  };
  const refuse=(mode,reason)=>{
    const bucket=modes[mode];bucket.refusedOrdinals++;bump(bucket.refusals,reason);
    endRun(reason);
  };
  return {
    attach(target){
      if(machine||!target?.cpu||typeof target.cpu._fetch8!=='function'||
          typeof target.cpu._fetchN!=='function')
        throw new TypeError('event-run observer needs an unattached 386 board');
      machine=target;
      const cpu=target.cpu;
      restoreOwn(cpu,'_fetch8',original=>function(...args){
        const eip=this.eip,value=original.apply(this,args);
        recordByte(this,eip,value);return value;
      });
      restoreOwn(cpu,'_fetchN',original=>function(size,...args){
        const eip=this.eip,before=pending?.bytes.length??0;
        const value=original.call(this,size,...args);
        if(pending&&pending.bytes.length===before)
          for(let i=0;i<size;i++)
            recordByte(this,eip+i,value/(2**(8*i))&255);
        return value;
      });
      restoreOwn(cpu,'fetch',original=>function(address,...args){
        const value=original.call(this,address,...args);
        recordCode(address);return value;
      });
      if(typeof cpu.fetchRam32==='function')
        restoreOwn(cpu,'fetchRam32',original=>function(address,...args){
          const value=original.call(this,address,...args);
          if(value!==undefined)recordCode(address,4);
          return value;
        });
      restoreOwn(cpu,'read',original=>function(address,...args){
        const value=original.call(this,address,...args);
        recordAccess(address,1,false);return value;
      });
      if(typeof cpu.read32==='function')
        restoreOwn(cpu,'read32',original=>function(address,...args){
          const value=original.call(this,address,...args);
          recordAccess(address,4,false);return value;
        });
      restoreOwn(target,'_write386',original=>function(address,value,...args){
        if(pending&&this.cpu._pagingBitWrite)pending.pageWalkWrite=true;
        recordAccess(address,1,true);
        return original.call(this,address,value,...args);
      });
      restoreOwn(target,'_write',original=>function(address,value,...args){
        // CPU writes already pass _write386. This also sees host/DMA writes
        // through the board's ordinary RAM path between observed steps.
        if(pending){
          const page=(address>>>0)>>>12;
          if(page===pending.codePage||
              this.cpu._translationTablePages?.has(page))
            pending.codeOrTableWrite=true;
        }else{externalEpoch++;endRun('host-or-dma-write');}
        return original.call(this,address,value,...args);
      });
      restoreOwn(cpu,'inPort',original=>function(...args){
        if(pending){pending.io=true;deviceReads++;}
        return original.apply(this,args);
      });
      restoreOwn(cpu,'outPort',original=>function(...args){
        if(pending){pending.io=true;deviceWrites++;}
        return original.apply(this,args);
      });
      restoreOwn(target,'_flushChips',original=>function(...args){
        if(pending)pending.chipEvent=true;
        return original.apply(this,args);
      });
      restoreOwn(target,'_serviceInterrupts',original=>function(...args){
        const delivered=original.apply(this,args);
        if(pending&&delivered)pending.interrupt=true;
        return delivered;
      });
      return ()=>{
        endRun('end-of-observation');
        for(const restore of restores.reverse())restore();
        restores=[];machine=null;pending=null;
      };
    },
    observe(target){
      if(target!==machine||pending)throw new TypeError('observer step mismatch');
      const cpu=target.cpu,mode=modeOf(cpu),eip=cpu.eip>>>0;
      pending={mode,cs:cpu.cs,eip,linear:((cpu.segmentCaches[1].base??0)+eip)>>>0,
        cycles:cpu.cycles,identity:identityOf(target),
        boardCycles:target.cycles,chipDebt:target._chipDebt,
        chipDeadline:target._chipDeadline,externalEpoch,
        eventDue:target._chipDebt>=target._chipDeadline||
          (target._lapicTimerInterval&&target.cycles>=target._lapicTimerNext),
        bytes:[],fetchCs:null,fetchEip:null,codePage:null,
        codePageCrossing:false,unsafeCode:false,dataAccesses:0,unsafeData:false,
        codeOrTableWrite:false,pageWalkWrite:false,io:false,
        chipEvent:false,interrupt:false};
      modes[mode].entryAttempts++;
    },
    retired(target){
      if(target!==machine||!pending)throw new TypeError('observer has no pending step');
      const before=pending,cpu=target.cpu,bucket=modes[before.mode];
      pending=null;
      if(cpu.cycles===before.cycles){
        bucket.noRetirement++;endRun('no-retirement');return;
      }
      bucket.retiredSteps++;
      onObservedStep?.({mode:before.mode,cs:before.cs,eip:before.eip,
        bytes:before.bytes.slice(),codePage:before.codePage,
        codeOrTableWrite:before.codeOrTableWrite,
        pageWalkWrite:before.pageWalkWrite,io:before.io});
      if(run){
        const reason=run.mode!==before.mode?'mode-change':
          run.cs!==before.cs?'cs-change':
          run.codePage!==before.codePage?'code-page-change':
          run.expectedEip!==before.eip?'nonsequential-entry':
          run.externalEpoch!==before.externalEpoch?'external-event':
          run.boardCycles!==before.boardCycles||
          run.chipDebt!==before.chipDebt||
          run.chipDeadline!==before.chipDeadline?'board-state-change':
          !sameIdentity(run.identity,before.identity)?'identity-change':null;
        if(reason)endRun(reason);
      }
      const form=formOf(before.bytes),postIdentity=identityOf(target);
      const postEip=cpu.eip>>>0;
      const branch=form.kind==='control-flow'?
        branchOf(before.bytes,before.eip,postEip):null;
      const linearNext=(before.eip+before.bytes.length)>>>0;
      const reason=before.mode==='protected32'?'mode32':
        before.fetchCs!==before.cs||before.fetchEip!==before.eip?
          'entry-redirect':
        before.codePage===null?'missing-code-page-proof':
        before.eventDue||before.chipEvent||before.interrupt?
          'chip-or-interrupt-event':
        before.io?'device-io':
        before.codePageCrossing?'code-page-crossing':
        before.unsafeCode?'unsafe-code':
        before.unsafeData?'unsafe-data':
        before.pageWalkWrite?'page-walk-write':
        before.codeOrTableWrite?'code-or-table-write':
        !sameIdentity(before.identity,postIdentity)?'identity-change':
        form.reason??
        (form.kind==='control-flow'&&!branch?'unsupported-control':null)??
        (form.kind==='linear'&&form.needsData&&!before.dataAccesses?
          'unproved-data-address':null)??
        (form.kind==='linear'&&postEip!==linearNext?
          'unexpected-successor':null)??
        (!before.bytes.length?'missing-fetch':null);
      if(reason){refuse(before.mode,reason);return;}
      if(!run)run={mode:before.mode,cs:before.cs,
        codePage:before.codePage,length:0};
      run.length++;bucket.admittedOrdinals++;
      run.expectedEip=postEip;run.identity=postIdentity;
      run.boardCycles=target.cycles;run.chipDebt=target._chipDebt;
      run.chipDeadline=target._chipDeadline;run.externalEpoch=externalEpoch;
      if(target._chipDebt>=target._chipDeadline||
         (target._lapicTimerInterval&&target.cycles>=target._lapicTimerNext))
        endRun('post-step-event-horizon');
      else if(run?.length===maxRun)endRun('run-budget');
    },
    aborted(target){
      if(target!==machine||!pending)throw new TypeError('observer has no pending step');
      modes[pending.mode].abortedCalls++;
      pending=null;endRun('aborted-call');
    },
    externalEvent(){externalEpoch++;endRun('external-event');},
    report(){
      endRun('report-boundary');
      for(const [mode,bucket] of Object.entries(modes)){
        const runSteps=Object.entries(bucket.runLengthHistogram).reduce(
          (sum,[length,count])=>sum+Number(length)*count,0);
        if(bucket.entryAttempts!==bucket.retiredSteps+bucket.noRetirement+
            bucket.abortedCalls||bucket.retiredSteps!==bucket.admittedOrdinals+
            bucket.refusedOrdinals||runSteps!==bucket.admittedOrdinals)
          throw new Error(`code16 observer partition mismatch in ${mode}`);
      }
      const denominator=MODES.filter(mode=>mode!=='protected32')
        .reduce((sum,mode)=>sum+modes[mode].retiredSteps,0);
      const admitted=MODES.filter(mode=>mode!=='protected32')
        .reduce((sum,mode)=>sum+modes[mode].admittedOrdinals,0);
      const runs=MODES.filter(mode=>mode!=='protected32')
        .reduce((sum,mode)=>sum+modes[mode].runs,0);
      const stepsInLongRuns=MODES.filter(mode=>mode!=='protected32')
        .reduce((sum,mode)=>sum+modes[mode].stepsInRunsAtLeast4,0);
      return {schema:'bw.i80386-code16-event-run-observer.v1',maxRun,modes,
        deviceReads,deviceWrites,
        denominator16BitRetiredOrdinals:denominator,
        admitted16BitOrdinals:admitted,
        disjointRuns16Bit:runs,
        meanAllAdmittedRunLength:runs?admitted/runs:0,
        uniqueOrdinalsInRunsAtLeast4:stepsInLongRuns,
        longRunCoverageOf16BitRetirements:denominator?
          stepsInLongRuns/denominator:0,
        feasibilityPassed:runs>0&&admitted/runs>=4&&
          stepsInLongRuns/denominator>=0.25};
    },
  };
}
