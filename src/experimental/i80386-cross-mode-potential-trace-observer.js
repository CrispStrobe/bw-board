// Observation only. Successful ordinary decode/execute is the grammar oracle;
// this observer never decodes ahead or executes a guest instruction.
import {classifyI80386BroadForm} from './i80386-broad-block-census.js';
import {classifyI80386FormResolvedAdmission} from './i80386-form-resolved-admission.js';
import {classifyI80386ExpandedGroupedAdmission} from './i80386-expanded-grouped-admission.js';
import {classifyI80386RegisterStackAdmission} from './i80386-register-stack-admission.js';
import {classifyI80386FirstRefusalShape,
  createI80386FirstRefusalContextTracker} from './i80386-first-refusal-shape.js';

const MODES=['real','protected16','vm86','protected32'];
const PREFIXES=new Set([0x26,0x2e,0x36,0x3e,0x64,0x65,0x66,0x67,
  0xf0,0xf2,0xf3]);
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
const opcodeOf=bytes=>{
  let at=0,repeat=false;
  while(at<bytes.length&&PREFIXES.has(bytes[at])){
    repeat ||= bytes[at]===0xf2||bytes[at]===0xf3;
    at++;
  }
  return {opcode:bytes[at],at,repeat};
};
const isRepeat=bytes=>{
  const {opcode,repeat}=opcodeOf(bytes);
  return repeat&&(opcode>=0x6c&&opcode<=0x6f||
    opcode>=0xa4&&opcode<=0xaf&&opcode!==0xa8&&opcode!==0xa9);
};
const opcodeKey=bytes=>{
  const {opcode,at}=opcodeOf(bytes);
  const first=opcode===undefined?'??':opcode.toString(16).padStart(2,'0');
  return opcode===0x0f?`0f${(bytes[at+1]??0).toString(16).padStart(2,'0')}`:first;
};
const isControlTransfer=bytes=>{
  const {opcode,at}=opcodeOf(bytes);
  if(opcode>=0x70&&opcode<=0x7f||opcode>=0xe0&&opcode<=0xe3||
      opcode===0x9a||opcode===0xc2||opcode===0xc3||
      opcode===0xca||opcode===0xcb||opcode===0xcc||opcode===0xcd||
      opcode===0xce||opcode===0xcf||opcode===0xe8||opcode===0xe9||
      opcode===0xea||opcode===0xeb)return true;
  if(opcode===0x0f&&bytes[at+1]>=0x80&&bytes[at+1]<=0x8f)return true;
  return opcode===0xff&&[2,3,4,5].includes(((bytes[at+1]??0)>>>3)&7);
};

export function createI80386CrossModePotentialTraceObserver({maxRun=64,onObservedStep=null,
  formResolvedAdmission=false,firstRefusalContext=false,
  groupedShadowAdmission=false,groupedFirstRefusalContext=false,
  expandedGroupedAdmission=false,registerStackAdmission=false}={}) {
  if(!Number.isInteger(maxRun)||maxRun<1||maxRun>64)
    throw new RangeError('cross-mode potential trace run budget must be 1..64');
  if(onObservedStep!==null&&typeof onObservedStep!=='function')
    throw new TypeError('onObservedStep must be a function');
  if(typeof formResolvedAdmission!=='boolean')
    throw new TypeError('formResolvedAdmission must be boolean');
  if(typeof firstRefusalContext!=='boolean'||
      firstRefusalContext&&!formResolvedAdmission)
    throw new TypeError('firstRefusalContext requires formResolvedAdmission');
  if(typeof groupedShadowAdmission!=='boolean'||
      groupedShadowAdmission&&(formResolvedAdmission||firstRefusalContext))
    throw new TypeError('grouped shadow admission must be a separate observer variant');
  if(typeof groupedFirstRefusalContext!=='boolean'||
      groupedFirstRefusalContext&&!groupedShadowAdmission)
    throw new TypeError('grouped first refusal requires grouped shadow admission');
  if(typeof expandedGroupedAdmission!=='boolean'||expandedGroupedAdmission&&
      (formResolvedAdmission||firstRefusalContext||groupedShadowAdmission||
       groupedFirstRefusalContext))
    throw new TypeError('expanded grouped admission is a separate observer variant');
  if(typeof registerStackAdmission!=='boolean'||registerStackAdmission&&
      (formResolvedAdmission||firstRefusalContext||groupedShadowAdmission||
       groupedFirstRefusalContext||expandedGroupedAdmission))
    throw new TypeError('register stack admission is a separate observer variant');
  const expandedVariant=expandedGroupedAdmission||registerStackAdmission;
  const modes=Object.fromEntries(MODES.map(mode=>[mode,{
    entryAttempts:0,completedStepCalls:0,eligibleRetiredOrdinals:0,
    repeatIterationCalls:0,noRetirement:0,abortedCalls:0,
    admittedOrdinals:0,refusedOrdinals:0,runs:0,
    ordinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
    runLengthHistogram:{},runEndReasons:{},
    observedIoOrdinals:0,admittedOptimisticIoOrdinals:0,
    admittedControlTransferOrdinals:0,
    controlTransferOrdinalsInRunsAtLeast8:0,
    admittedOutsideBroadGrammarOrdinals:0,
    outsideBroadGrammarOrdinalsInRunsAtLeast8:0,
    admittedOpcodeCounts:{},longRunOpcodeCounts:{},
    codePageRevocations:0,translationRevocations:0,
    chipExits:0,interruptExits:0,faultExits:0,abortedExits:0,
    refusals:{}}]));
  const formModes=formResolvedAdmission||groupedShadowAdmission||
    expandedVariant?
    Object.fromEntries(MODES.map(mode=>[mode,{
    eligibleRetiredOrdinals:0,admittedOrdinals:0,refusedOrdinals:0,
    runs:0,ordinalsInRunsAtLeast8:0,runLengthHistogram:{},runEndReasons:{},
    refusals:{},observedPrefixSignatures:{},observedOpcodeCounts:{},
    admittedFormCounts:{},longRunFormCounts:{},
    admittedAccessClasses:{},longRunAccessClasses:{},
    admittedEaClasses:{},admittedModrmShapes:{},
    optimisticIoOrdinalsInRunsAtLeast8:0,
    ...(expandedVariant?{typedCandidatesCutByGlobal:{},
      typedCandidatesCutByGlobalOpcode:{}}:{}),
  }])):null;
  const contextTracker=firstRefusalContext||groupedFirstRefusalContext?
    createI80386FirstRefusalContextTracker({maxRun,
      groupedTargetsOnly:groupedFirstRefusalContext}):null;
  let machine=null,pending=null,run=null,externalEpoch=0,deviceReads=0,
    deviceWrites=0,restores=[],formRun=null,pendingRefusal=null;
  const cutPendingRefusal=reason=>{
    if(!pendingRefusal)return;
    contextTracker.resolve(pendingRefusal.token,0,reason);
    pendingRefusal=null;
  };
  const endRun=reason=>{
    if(!run)return;
    const bucket=modes[run.mode];
    bucket.runs++;
    bump(bucket.runLengthHistogram,run.length);
    bump(bucket.runEndReasons,reason);
    if(run.length>=8){
      bucket.ordinalsInRunsAtLeast8+=run.length;
      bucket.optimisticIoOrdinalsInRunsAtLeast8+=run.ioOrdinals;
      bucket.controlTransferOrdinalsInRunsAtLeast8+=run.controlTransfers;
      bucket.outsideBroadGrammarOrdinalsInRunsAtLeast8+=run.outsideBroad;
      for(const [opcode,count] of Object.entries(run.opcodeCounts))
        bucket.longRunOpcodeCounts[opcode]=
          (bucket.longRunOpcodeCounts[opcode]??0)+count;
    }
    run=null;
  };
  const endFormRun=reason=>{
    if(!formRun)return;
    const bucket=formModes[formRun.mode];
    bucket.runs++;bump(bucket.runLengthHistogram,formRun.length);
    bump(bucket.runEndReasons,reason);
    if(formRun.length>=8){
      bucket.ordinalsInRunsAtLeast8+=formRun.length;
      bucket.optimisticIoOrdinalsInRunsAtLeast8+=formRun.ioOrdinals;
      for(const [key,count] of Object.entries(formRun.forms))
        bucket.longRunFormCounts[key]=(bucket.longRunFormCounts[key]??0)+count;
      for(const [key,count] of Object.entries(formRun.accessClasses))
        bucket.longRunAccessClasses[key]=
          (bucket.longRunAccessClasses[key]??0)+count;
    }
    if(formRun.linkedRefusal)
      contextTracker.resolve(formRun.linkedRefusal,formRun.length,reason);
    formRun=null;
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
  const recordAccess=(address,width,write,value=0)=>{
    if(!pending)return;
    pending.dataAccesses++;
    if(formModes)pending[write?'dataWrites':'dataReads']++;
    if(expandedVariant)
      for(let i=0;i<width;i++){
        if(pending.dataTrace.length<32)
          pending.dataTrace.push({kind:write?'write':'read',
            address:(address+i)>>>0,value:(value>>>8*i)&255});
        else pending.dataTraceOverflow=true;
      }
    for(let i=0;i<width;i++){
      const raw=(address+i)>>>0,decoded=machine._decode386(raw);
      const page=decoded>>>12,kind=machine._page?.[page];
      if(formModes){
        if(pending.dataPage===null)pending.dataPage=page;
        else if(pending.dataPage!==page)pending.dataPageCrossing=true;
      }
      const overlay=(decoded>=0xa0000&&decoded<0xc0000)||
        (decoded>=0x9fc00&&decoded<0x9fd50)||
        (decoded>=0xfee00000&&decoded<0xfee01000)||
        (decoded>=0xfec00000&&decoded<0xfec00020);
      if(raw>=0xffff0000||decoded>=machine.memoryBytes||overlay||
         kind!==1)pending.unsafeData=true;
      if(write&&page===pending.codePage){
        pending.codeOrTableWrite=true;pending.codeWrite=true;
      }
      if(write&&machine.cpu._translationTablePages?.has(page))
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
        throw new TypeError('cross-mode observer needs an unattached 386 board');
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
        recordAccess(address,1,false,value);return value;
      });
      if(typeof cpu.read32==='function')
        restoreOwn(cpu,'read32',original=>function(address,...args){
          const value=original.call(this,address,...args);
          recordAccess(address,4,false,value);return value;
        });
      restoreOwn(target,'_write386',original=>function(address,value,...args){
        if(pending&&this.cpu._pagingBitWrite)pending.pageWalkWrite=true;
        recordAccess(address,1,true,value);
        if(pending&&this.cpu._translationTablePages?.has(
            this._decode386(address>>>0)>>>12))pending.translationWrite=true;
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
          if(page===pending.codePage)pending.codeWrite=true;
          if(this.cpu._translationTablePages?.has(page))pending.translationWrite=true;
        }else{
          const page=this._decode386(address>>>0)>>>12;
          if(run&&page===run.codePage)modes[run.mode].codePageRevocations++;
          if(run&&this.cpu._translationTablePages?.has(page))
            modes[run.mode].translationRevocations++;
          externalEpoch++;endRun('host-or-dma-write');
          if(formModes)endFormRun('host-or-dma-write');
          cutPendingRefusal('host-or-dma-write');
        }
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
      restoreOwn(cpu,'_deliverFault',original=>function(...args){
        if(pending)pending.fault=true;
        return original.apply(this,args);
      });
      return ()=>{
        endRun('end-of-observation');
        if(formModes)endFormRun('end-of-observation');
        cutPendingRefusal('end-of-observation');
        for(const restore of restores.reverse())restore();
        restores=[];machine=null;pending=null;
      };
    },
    observe(target){
      if(target!==machine||pending)throw new TypeError('observer step mismatch');
      const cpu=target.cpu,mode=modeOf(cpu),eip=cpu.eip>>>0;
      pending={mode,cs:cpu.cs,eip,linear:((cpu.segmentCaches[1].base??0)+eip)>>>0,
        cycles:cpu.cycles,identity:identityOf(target),
        ...(expandedVariant?{esBefore:cpu.es,
          espBefore:cpu.esp>>>0,stack32:!!cpu.segmentCaches[2].default32,
          stackBase:cpu.segmentCaches[2].base>>>0,paging:!!(cpu.cr0&0x80000000),
          registers16:[cpu.eax,cpu.ecx,cpu.edx,cpu.ebx,
            cpu.esp,cpu.ebp,cpu.esi,cpu.edi].map(value=>value&0xffff),
          ...(registerStackAdmission?{registersBefore:[cpu.eax,cpu.ecx,
            cpu.edx,cpu.ebx,cpu.esp,cpu.ebp,cpu.esi,cpu.edi].map(v=>v>>>0),
            flagsBefore:cpu.eflags>>>0}:{})}:{}),
        ...(formModes?{default32:!!cpu.segmentCaches[1].default32}:{}),
        boardCycles:target.cycles,chipDebt:target._chipDebt,
        chipDeadline:target._chipDeadline,externalEpoch,
        eventDue:target._chipDebt>=target._chipDeadline||
          (target._lapicTimerInterval&&target.cycles>=target._lapicTimerNext),
        bytes:[],fetchCs:null,fetchEip:null,codePage:null,
        codePageCrossing:false,unsafeCode:false,dataAccesses:0,unsafeData:false,
        ...(formModes?{dataPage:null,dataPageCrossing:false,
          dataReads:0,dataWrites:0}:{}),
        ...(expandedVariant?{dataTrace:[],dataTraceOverflow:false}:{}),
        codeOrTableWrite:false,codeWrite:false,translationWrite:false,
        pageWalkWrite:false,io:false,
        chipEvent:false,interrupt:false,fault:false};
      modes[mode].entryAttempts++;
    },
    retired(target){
      if(target!==machine||!pending)throw new TypeError('observer has no pending step');
      const before=pending,cpu=target.cpu,bucket=modes[before.mode];
      pending=null;
      if(cpu.cycles===before.cycles){
        if(before.fault)bucket.faultExits++;
        bucket.noRetirement++;endRun('no-retirement');
        if(formModes)endFormRun('no-retirement');
        cutPendingRefusal('no-retirement');return;
      }
      bucket.completedStepCalls++;
      onObservedStep?.({mode:before.mode,cs:before.cs,eip:before.eip,
        bytes:before.bytes.slice(),codePage:before.codePage,
        codeOrTableWrite:before.codeOrTableWrite,
        pageWalkWrite:before.pageWalkWrite,io:before.io});
      // REP is implemented as one interruptible iteration per board step.
      // Without a precise architectural completion marker, exclude every
      // such call from the instruction-retirement denominator and trace.
      if(isRepeat(before.bytes)){
        bucket.repeatIterationCalls++;endRun('repeat-iteration');
        if(formModes)endFormRun('repeat-iteration');
        cutPendingRefusal('repeat-iteration');return;
      }
      bucket.eligibleRetiredOrdinals++;
      if(before.io)bucket.observedIoOrdinals++;
      if(before.codeWrite)bucket.codePageRevocations++;
      if(before.translationWrite||before.pageWalkWrite)
        bucket.translationRevocations++;
      if(before.interrupt)bucket.interruptExits++;
      if(before.chipEvent||before.eventDue)bucket.chipExits++;
      if(before.fault)bucket.faultExits++;
      const continuationBreak=prior=>prior.mode!==before.mode?'mode-change':
        prior.cs!==before.cs?'cs-change':
        prior.codePage!==before.codePage?'code-page-change':
        prior.expectedEip!==before.eip?'nonsequential-entry':
        prior.externalEpoch!==before.externalEpoch?'external-event':
        prior.boardCycles!==before.boardCycles||
        prior.chipDebt!==before.chipDebt||
        prior.chipDeadline!==before.chipDeadline?'board-state-change':
        !sameIdentity(prior.identity,before.identity)?'identity-change':null;
      if(run){const breakReason=continuationBreak(run);if(breakReason)endRun(breakReason);}
      if(formRun){const breakReason=continuationBreak(formRun);
        if(breakReason)endFormRun(breakReason);}
      if(pendingRefusal){const breakReason=continuationBreak(pendingRefusal);
        if(breakReason)cutPendingRefusal(breakReason);}
      const postIdentity=identityOf(target);
      const postEip=cpu.eip>>>0;
      const reason=before.fetchCs!==before.cs||before.fetchEip!==before.eip?
          'entry-redirect':
        before.codePage===null?'missing-code-page-proof':
        before.fault?'fault-delivery':
        before.interrupt?'interrupt-delivery':
        before.eventDue?'pre-step-event-horizon':
        before.chipEvent&&!before.io?'chip-event':
        before.codePageCrossing?'code-page-crossing':
        before.unsafeCode?'unsafe-code':
        before.unsafeData?'unsafe-data':
        before.pageWalkWrite?'page-walk-write':
        before.codeOrTableWrite?'code-or-table-write':
        !sameIdentity(before.identity,postIdentity)?'identity-change':
        (!before.bytes.length?'missing-fetch':null);
      if(formModes){
        const formBucket=formModes[before.mode];
        formBucket.eligibleRetiredOrdinals++;
        const formOptions={
          default32:before.default32,startEip:before.eip,postEip,
          dataAccesses:before.dataAccesses,dataReads:before.dataReads,
          dataWrites:before.dataWrites,io:before.io,
          dataPageCrossing:before.dataPageCrossing,
          groupedShadowAdmission,
          ...(expandedVariant?{mode:before.mode,
            dataTrace:before.dataTrace,
            dataTraceOverflow:before.dataTraceOverflow,
            registers16:before.registers16,esAfter:cpu.es,
            espBefore:before.espBefore,espAfter:cpu.esp>>>0,
            stack32:before.stack32,stackBase:before.stackBase,
            paging:before.paging,
            ...(registerStackAdmission?{registersBefore:before.registersBefore,
              registersAfter:[cpu.eax,cpu.ecx,cpu.edx,cpu.ebx,
                cpu.esp,cpu.ebp,cpu.esi,cpu.edi].map(v=>v>>>0),
              flagsBefore:before.flagsBefore,flagsAfter:cpu.eflags>>>0}:{}),
          }:{})};
        const classified=registerStackAdmission?
          classifyI80386RegisterStackAdmission(before.bytes,formOptions):
          expandedGroupedAdmission?
          classifyI80386ExpandedGroupedAdmission(before.bytes,formOptions):
          classifyI80386FormResolvedAdmission(before.bytes,formOptions);
        // The existing cache identity intentionally omits non-CS visible
        // selectors. A same-cache reload with a new ES selector still cuts.
        const form=expandedVariant&&classified.special&&
          classified.opcode==='8e'&&!reason&&before.esBefore!==cpu.es?
          {...classified,reason:'segment-selector-change',formKey:null}:
          classified;
        bump(formBucket.observedPrefixSignatures,form.prefixSignature);
        bump(formBucket.observedOpcodeCounts,form.opcode);
        if(expandedVariant&&reason&&form.special&&!form.reason){
          bump(formBucket.typedCandidatesCutByGlobal,reason);
          bump(formBucket.typedCandidatesCutByGlobalOpcode,form.opcode);
        }
        const formReason=reason??form.reason;
        if(formReason){
          formBucket.refusedOrdinals++;bump(formBucket.refusals,formReason);
          const precedingLength=formRun?.length??0;
          cutPendingRefusal('next-refusal');
          endFormRun(formReason);
          if(contextTracker){
            const shape=classifyI80386FirstRefusalShape(before.bytes,{
              default32:before.default32,dataReads:before.dataReads,
              dataWrites:before.dataWrites,io:before.io});
            const token=contextTracker.record(before.mode,formReason,shape,
              precedingLength);
            if(token&&(reason||before.io||before.chipEvent||
                target._chipDebt>=target._chipDeadline||
                target._lapicTimerInterval&&target.cycles>=target._lapicTimerNext))
              contextTracker.resolve(token,0,'refusal-side-exit');
            else if(token)pendingRefusal={token,mode:before.mode,cs:before.cs,
              codePage:before.codePage,expectedEip:postEip,
              identity:postIdentity,boardCycles:target.cycles,
              chipDebt:target._chipDebt,chipDeadline:target._chipDeadline,
              externalEpoch};
          }
        }else{
          if(!formRun)formRun={mode:before.mode,cs:before.cs,
            codePage:before.codePage,length:0,ioOrdinals:0,
            forms:{},accessClasses:{},
            linkedRefusal:pendingRefusal?.token??null};
          pendingRefusal=null;
          formRun.length++;formBucket.admittedOrdinals++;
          bump(formBucket.admittedFormCounts,form.formKey);
          bump(formBucket.admittedAccessClasses,form.accessClass);
          bump(formBucket.admittedEaClasses,form.eaClass);
          if(form.modrm){
            const m=form.modrm;
            bump(formBucket.admittedModrmShapes,
              `m${m.mod}r${m.reg}b${m.rm}`+
              (m.sib?`s${m.sib.scale}${m.sib.index}${m.sib.base}`:'')+
              `d${m.displacementBytes}`);
          }
          bump(formRun.forms,form.formKey);
          bump(formRun.accessClasses,form.accessClass);
          if(form.accessClass.startsWith('port-'))formRun.ioOrdinals++;
          formRun.expectedEip=postEip;formRun.identity=postIdentity;
          formRun.boardCycles=target.cycles;formRun.chipDebt=target._chipDebt;
          formRun.chipDeadline=target._chipDeadline;
          formRun.externalEpoch=externalEpoch;
          if(target._chipDebt>=target._chipDeadline||
             (target._lapicTimerInterval&&target.cycles>=target._lapicTimerNext))
            endFormRun('post-step-event-horizon');
          else if(before.chipEvent)endFormRun('io-helper-chip-flush');
          else if(formRun.length===maxRun)endFormRun('run-budget');
        }
      }
      if(reason){refuse(before.mode,reason);return;}
      if(!run)run={mode:before.mode,cs:before.cs,
        codePage:before.codePage,length:0,ioOrdinals:0,
        outsideBroad:0,controlTransfers:0,opcodeCounts:{}};
      run.length++;bucket.admittedOrdinals++;
      if(before.io){run.ioOrdinals++;bucket.admittedOptimisticIoOrdinals++;}
      if(isControlTransfer(before.bytes)){
        run.controlTransfers++;bucket.admittedControlTransferOrdinals++;
      }
      const opcode=opcodeKey(before.bytes),broad=classifyI80386BroadForm(before.bytes);
      bump(run.opcodeCounts,opcode);bump(bucket.admittedOpcodeCounts,opcode);
      if(broad.reason){run.outsideBroad++;bucket.admittedOutsideBroadGrammarOrdinals++;}
      run.expectedEip=postEip;run.identity=postIdentity;
      run.boardCycles=target.cycles;run.chipDebt=target._chipDebt;
      run.chipDeadline=target._chipDeadline;
      run.externalEpoch=externalEpoch;
      if(target._chipDebt>=target._chipDeadline||
         (target._lapicTimerInterval&&target.cycles>=target._lapicTimerNext))
        endRun('post-step-event-horizon');
      else if(before.chipEvent)endRun('io-helper-chip-flush');
      else if(run?.length===maxRun)endRun('run-budget');
    },
    aborted(target){
      if(target!==machine||!pending)throw new TypeError('observer has no pending step');
      modes[pending.mode].abortedCalls++;
      modes[pending.mode].abortedExits++;
      if(pending.fault)modes[pending.mode].faultExits++;
      pending=null;endRun('aborted-call');
      if(formModes)endFormRun('aborted-call');
      cutPendingRefusal('aborted-call');
    },
    externalEvent(){externalEpoch++;endRun('external-event');
      if(formModes)endFormRun('external-event');
      cutPendingRefusal('external-event');},
    report(){
      endRun('report-boundary');
      if(formModes)endFormRun('report-boundary');
      cutPendingRefusal('report-boundary');
      for(const [mode,bucket] of Object.entries(modes)){
        const runSteps=Object.entries(bucket.runLengthHistogram).reduce(
          (sum,[length,count])=>sum+Number(length)*count,0);
        const longSteps=Object.entries(bucket.runLengthHistogram).reduce(
          (sum,[length,count])=>sum+(Number(length)>=8?Number(length)*count:0),0);
        if(bucket.entryAttempts!==bucket.completedStepCalls+bucket.noRetirement+
            bucket.abortedCalls||bucket.completedStepCalls!==
            bucket.repeatIterationCalls+bucket.eligibleRetiredOrdinals||
            bucket.eligibleRetiredOrdinals!==bucket.admittedOrdinals+
            bucket.refusedOrdinals||runSteps!==bucket.admittedOrdinals||
            longSteps!==bucket.ordinalsInRunsAtLeast8||
            bucket.optimisticIoOrdinalsInRunsAtLeast8>longSteps||
            bucket.controlTransferOrdinalsInRunsAtLeast8>longSteps||
            Object.values(bucket.longRunOpcodeCounts).reduce((a,b)=>a+b,0)!==longSteps||
            Object.values(bucket.admittedOpcodeCounts).reduce((a,b)=>a+b,0)!==
              bucket.admittedOrdinals)
          throw new Error(`cross-mode observer partition mismatch in ${mode}`);
      }
      const sum=field=>MODES.reduce((total,mode)=>total+modes[mode][field],0);
      const completedStepCalls=sum('completedStepCalls');
      const eligibleRetiredOrdinals=sum('eligibleRetiredOrdinals');
      const uniqueOrdinalsInRunsAtLeast8=sum('ordinalsInRunsAtLeast8');
      const protected16OrVm86OrdinalsInRunsAtLeast8=
        modes.protected16.ordinalsInRunsAtLeast8+
        modes.vm86.ordinalsInRunsAtLeast8;
      let formResolvedPotential=null;
      if(formModes){
        for(const mode of MODES){
          const typed=formModes[mode],ordinary=modes[mode];
          const all=Object.entries(typed.runLengthHistogram).reduce(
            (n,[length,count])=>n+Number(length)*count,0);
          const long=Object.entries(typed.runLengthHistogram).reduce(
            (n,[length,count])=>n+(Number(length)>=8?Number(length)*count:0),0);
          if(typed.eligibleRetiredOrdinals!==ordinary.eligibleRetiredOrdinals||
              typed.eligibleRetiredOrdinals!==typed.admittedOrdinals+
                typed.refusedOrdinals||all!==typed.admittedOrdinals||
              long!==typed.ordinalsInRunsAtLeast8||
              Object.values(typed.admittedFormCounts).reduce((a,b)=>a+b,0)!==all||
              Object.values(typed.longRunFormCounts).reduce((a,b)=>a+b,0)!==long||
              Object.values(typed.longRunAccessClasses).reduce((a,b)=>a+b,0)!==long)
            throw new Error(`form-resolved partition mismatch in ${mode}`);
        }
        const formSum=field=>MODES.reduce((n,mode)=>n+formModes[mode][field],0);
        const long=formSum('ordinalsInRunsAtLeast8');
        const long16=formModes.protected16.ordinalsInRunsAtLeast8+
          formModes.vm86.ordinalsInRunsAtLeast8;
        formResolvedPotential={schema:registerStackAdmission?
            'bw.i80386-register-stack-admission.v1':expandedGroupedAdmission?
            'bw.i80386-expanded-grouped-admission.v1':groupedShadowAdmission?
            'bw.i80386-grouped-shadow-admission.v1':
            'bw.i80386-form-resolved-admission.v1',
          grammar:registerStackAdmission?
            'typed-grouped-plus-owned-es-call-return-register-stack.v1':
            expandedGroupedAdmission?
            'typed-grouped-plus-owned-es-call-return.v1':groupedShadowAdmission?
            'typed-mov-cmp-test-group7-short-control-byte-io-plus-a8-8d-0b-31-ff0.v1':
            'typed-mov-cmp-test-group7-short-control-byte-io.v1',
          maxRun,modes:formModes,
          eligibleRetiredOrdinals:formSum('eligibleRetiredOrdinals'),
          admittedOrdinals:formSum('admittedOrdinals'),
          refusedOrdinals:formSum('refusedOrdinals'),
          disjointRuns:formSum('runs'),
          uniqueOrdinalsInRunsAtLeast8:long,
          protected16OrVm86OrdinalsInRunsAtLeast8:long16,
          optimisticIoOrdinalsInRunsAtLeast8:
            formSum('optimisticIoOrdinalsInRunsAtLeast8'),
          ...(expandedVariant?{
            typedCandidatesCutByGlobal:MODES.reduce((n,mode)=>n+
              Object.values(formModes[mode].typedCandidatesCutByGlobal)
                .reduce((a,b)=>a+b,0),0)}:{}),
          predeclaredSubsetOpportunityPassed:long>=15_000_000&&long16>=5_000_000,
          ...(contextTracker?{firstRefusalContext:contextTracker.report(
            Object.fromEntries(MODES.map(mode=>
              [mode,formModes[mode].refusedOrdinals])))}:{})};
      }
      return {schema:'bw.i80386-cross-mode-potential-trace-observer.v1',maxRun,
        model:'observed-successful-opcode; actual successor; optimistic synchronous IO helper',
        modes,deviceReads,deviceWrites,completedStepCalls,
        repeatIterationCalls:sum('repeatIterationCalls'),
        noRetirementCalls:sum('noRetirement'),abortedCalls:sum('abortedCalls'),
        eligibleRetiredOrdinals,admittedOrdinals:sum('admittedOrdinals'),
        disjointRuns:sum('runs'),uniqueOrdinalsInRunsAtLeast8,
        optimisticIoOrdinalsInRunsAtLeast8:
          sum('optimisticIoOrdinalsInRunsAtLeast8'),
        controlTransferOrdinalsInRunsAtLeast8:
          sum('controlTransferOrdinalsInRunsAtLeast8'),
        outsideBroadGrammarOrdinalsInRunsAtLeast8:
          sum('outsideBroadGrammarOrdinalsInRunsAtLeast8'),
        protected16OrVm86OrdinalsInRunsAtLeast8,
        longRunShareOfEligibleRetirements:eligibleRetiredOrdinals?
          uniqueOrdinalsInRunsAtLeast8/eligibleRetiredOrdinals:0,
        predeclaredOpportunityGatePassed:uniqueOrdinalsInRunsAtLeast8>=30_000_000&&
          protected16OrVm86OrdinalsInRunsAtLeast8>=5_000_000,
        ...(formResolvedPotential?
          (registerStackAdmission?
            {registerStackPotential:formResolvedPotential}:
            expandedGroupedAdmission?
            {expandedGroupedPotential:formResolvedPotential}:
            groupedShadowAdmission?{groupedShadowPotential:formResolvedPotential}:
              {formResolvedPotential}):{})};
    },
  };
}
