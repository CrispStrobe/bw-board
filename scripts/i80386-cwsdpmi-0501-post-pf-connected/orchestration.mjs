import {captureReferences,sameReferences} from '../i80386-cwsdpmi-0501-frame-at/references.mjs';
// Callback fences observe closed CPU/board scalars and descriptor roles.
// They grant no RAM/bus/device snapshot or frame authority.
const own=(object,key)=>{
  const d=Object.getOwnPropertyDescriptor(object,key);
  if(!d||!Object.hasOwn(d,'value'))throw new Error('post-PF own-data boundary');
  return d.value;
};
const callback=(object,key)=>{
  for(let current=object;current!==null;current=Object.getPrototypeOf(current)){
    const d=Object.getOwnPropertyDescriptor(current,key);
    if(!d)continue;
    if(!Object.hasOwn(d,'value'))throw new Error('post-PF accessor API boundary');
    return d.value;
  }
  return undefined;
};
const primitive=value=>{
  if(value===null||value===undefined||typeof value==='boolean'||typeof value==='string')return value??null;
  if(typeof value==='number'&&Number.isSafeInteger(value))return value;
  throw new Error('post-PF primitive boundary');
};
const plain=object=>{
  const descriptors=Object.getOwnPropertyDescriptors(object),keys=Reflect.ownKeys(descriptors);
  if(keys.length>64||keys.some(key=>typeof key!=='string'||!Object.hasOwn(descriptors[key],'value')))
    throw new Error('post-PF descriptor boundary');
  return Object.fromEntries(keys.sort().map(key=>[key,primitive(descriptors[key].value)]));
};
export function boundaryFingerprint(machine){
  const cpu=own(machine,'cpu');
  const fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags',
    'cs','ds','es','ss','fs','gs','cr0','cr2','cr3','cr4','cycles','halted','shutdown',
    '_interruptShadow','_nmiShadow','_debugShadow','_nmiActive','_retainedRealCs'];
  const values=Object.fromEntries(fields.map(key=>[key,primitive(own(cpu,key))]));
  const caches=own(cpu,'segmentCaches');
  const records=Array.from({length:6},(_,i)=>plain(own(caches,i)));
  for(const name of ['gdtr','idtr','ldtr','tr'])records.push(plain(own(cpu,name)));
  const board=Object.fromEntries(['cycles','_chipDebt','_chipDeadline','displayRevision',
    '_nmiPending','_nmiMasked','_cpuResetPending'].map(key=>[key,primitive(own(machine,key))]));
  const repeat=own(cpu,'_repeatContext');let repeatContext=null;
  if(repeat!==null){
    repeatContext=plain(repeat);
    if(Object.keys(repeatContext).sort().join()!=='cs,eip,flags'||
       !Number.isInteger(repeatContext.cs)||repeatContext.cs<0||repeatContext.cs>65535||
       !['eip','flags'].every(key=>Number.isInteger(repeatContext[key])&&repeatContext[key]>=0&&repeatContext[key]<=0xffffffff))
      throw new Error('post-PF repeat-context observer fence unavailable');
  }
  return {values,records,board,repeatContext};
}

// CPU-free ordering policy. The actual adapter owns the machine and ports.
export function sourceBoundPfStepMonitor(machine,cpu,token) {
  if(!machine||machine.cpu!==cpu||
     typeof machine.step!=='function'||
     typeof cpu?.owned0501FaultOutcomeStatus!=='function'||!token)
    throw new Error('PF step monitor source owner');
  const receipt={boardCalls:0,cpuAttempts:0,oneToOne:true,
    firstFailure:null};
  const fail=reason=>{receipt.oneToOne=false;
    receipt.firstFailure??=reason;return receipt.firstFailure;};
  const facade={cpu,step(){
    if(machine.cpu!==cpu)throw new Error(fail('PF step owner changed'));
    const before=cpu.owned0501FaultOutcomeStatus(token);
    if(before.phase!=='armed'||!Number.isInteger(before.attemptedSteps))
      throw new Error(fail('PF recorder not armed before board call'));
    receipt.boardCalls++;
    let result,original,threw=false;
    try{result=machine.step();}catch(error){original=error;threw=true;}
    let after=null;
    try{after=cpu.owned0501FaultOutcomeStatus(token);}
    catch{fail('PF status unavailable after board call');}
    const delta=after?.attemptedSteps-before.attemptedSteps;
    if(delta===1)receipt.cpuAttempts++;
    else fail('board call lacked one PF CPU attempt');
    if(threw)throw original;
    if(!receipt.oneToOne)throw new Error(receipt.firstFailure);
    return result;
  }};
  return Object.freeze({machine:Object.freeze(facade),receipt});
}

export function createPostPfConnectedOrchestration(ports,{cpu,opportunity,progress}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      typeof cpu?.armOwned0501FrameJournal!=='function' ||
      typeof cpu?.armOwned0501TaskMode!=='function' ||
      typeof opportunity!=='function' || typeof progress!=='function')
    throw new Error('task mode port contract');
  let busy=false,poisoned=false,bound=false,frameToken=null,taskToken=null;
  let wrapper=null,strict=null,strictEntryRef=null,strictEntryCopy=null,
    firstFailure=null,diagnosticFailure=null,steps=0;
  let continued=false,terminalResult=null,faultToken=null,faultArm=null;
  let postToken=null,postArm=null,postResult=null,postArmAttempted=false,postConsumed=false;
  let sourceMachine=own(ports,'machine');
  const sourceCpuStep=callback(cpu,'step'),sourceBoardStep=callback(sourceMachine,'step');
  const bounded=error=>String(error?.message??error).replace(/(?:\/[A-Za-z0-9._-]+)+/g,'[path]').slice(0,160);
  const methodNames=['read','read32','fetch','fetchRam32','_rawWrite','write','inPort','outPort','armOwned0501PostPfContinuation','owned0501PostPfContinuationStatus',
    'abortOwned0501PostPfContinuation','takeOwned0501PostPfContinuationObservation',
    'owned0501TaskModeStatus','takeOwned0501TaskModeObservation',
    'owned0501FaultOutcomeStatus','takeOwned0501FaultOutcome'];
  const methods=Object.fromEntries(methodNames.map(name=>[name,callback(cpu,name)]));
  const identities=()=>methodNames.every(name=>callback(cpu,name)===methods[name]);
  const stable=(fn)=>{
    if(!sourceMachine||own(sourceMachine,'cpu')!==cpu||own(ports,'machine')!==sourceMachine||callback(cpu,'step')!==sourceCpuStep||callback(sourceMachine,'step')!==sourceBoardStep||!identities())
      throw new Error('post-PF source owner changed');
    const before=boundaryFingerprint(sourceMachine);ensure();
    const refs=captureReferences(sourceMachine);ensure();
    const descriptorRefs=['gdtr','idtr','ldtr','tr','_repeatContext'].map(key=>own(cpu,key));ensure();
    let value,error,threw=false;
    try{value=fn();}catch(e){error=e;threw=true;}
    ensure();
    const after=boundaryFingerprint(sourceMachine);ensure();
    const afterRefs=captureReferences(sourceMachine);ensure();
    const afterDescriptors=['gdtr','idtr','ldtr','tr','_repeatContext'].map(key=>own(cpu,key));ensure();
    const ownerSame=own(sourceMachine,'cpu')===cpu&&own(ports,'machine')===sourceMachine&&
      callback(cpu,'step')===sourceCpuStep&&callback(sourceMachine,'step')===sourceBoardStep&&identities();ensure();
    if(!ownerSame||JSON.stringify(before)!==JSON.stringify(after)||
       !sameReferences(refs,afterRefs)||!afterDescriptors.every((ref,i)=>ref===descriptorRefs[i]))
      throw new Error('post-PF callback changed source');
    if(threw)throw error;return value;
  };
  const latch=reason=>{firstFailure??=reason;return firstFailure;};
  const diagnosticLatch=reason=>{diagnosticFailure??=reason;return diagnosticFailure;};
  const copyEntry=entry=>{
    if(!entry||Object.getPrototypeOf(entry)!==Object.prototype)
      throw new Error('strict entry source shape');
    const descriptors=Object.getOwnPropertyDescriptors(entry),copy={};
    for(const [key,descriptor] of Object.entries(descriptors)){
      if(!Object.hasOwn(descriptor,'value')||
         !['number','string','boolean'].includes(typeof descriptor.value)||
         (typeof descriptor.value==='number'&&!Number.isFinite(descriptor.value)))
        throw new Error('strict entry source field');
      copy[key]=descriptor.value;
    }
    return Object.freeze(copy);
  };
  const sameEntry=(entry,copy)=>{
    const current=copyEntry(entry),keys=Object.keys(copy);
    return Object.keys(current).length===keys.length&&
      keys.every(key=>current[key]===copy[key]);
  };
  const ensure=()=>{
    if(poisoned){latch('task mode port reentry');throw new Error('task mode port reentry');}
  };
  const exclusive=(fn,{allowPoisonedResult=false}={})=>{
    if(busy){poisoned=true;latch('task mode port reentry');
      throw new Error('task mode port reentry');}
    if(poisoned&&!allowPoisonedResult){latch('task mode port reentry');
      throw new Error('task mode port reentry');}
    busy=true;
    try{
      const value=fn();
      if(poisoned&&!allowPoisonedResult){latch('task mode port reentry');
        throw new Error('task mode port reentry');}
      return value;
    }finally{busy=false;}
  };
  const wrapped={...ports,
    bind(){return exclusive(()=>{
      if(bound)throw new Error(latch('duplicate owned-main cut'));
      const result=ports.bind();
      if(result?.ownedCodeAtEntry!=='PASS')
        throw new Error(latch('owned-main cut refused'));
      bound=true;
      return result;
    });},
    step(){return exclusive(()=>{
      if(firstFailure)throw new Error(firstFailure);
      if(bound&&!frameToken){
        const candidate=opportunity();
        ensure();
        if(candidate!==null){
          wrapper=candidate.receipt;
          frameToken=cpu.armOwned0501FrameJournal({
            cs:candidate.cs,startEip:candidate.comparison.address,
            endEip:candidate.comparison.address+candidate.comparison.bytes,
            maxActiveSteps:1_000_000,
            profile:'gate14-code16-stack32-same-cpl3.v1'});
          if(!frameToken)throw new Error(latch('frame arm refused'));
          progress({event:'frame-armed',steps,wrapper});
          ensure();
        }
      }
      ensure();
      ports.step();steps++;
      ensure();
      if(frameToken&&!taskToken){
        const state=cpu.owned0501FrameStatus(frameToken);
        if(state.phase==='open'){
          taskToken=cpu.armOwned0501TaskMode(frameToken);
          if(!taskToken)throw new Error(latch('task mode arm refused'));
          progress({event:'task-mode-armed',steps,wrapper,frameStatus:state});
          ensure();
        }
      }
      if(frameToken){
        const state=cpu.owned0501FrameStatus(frameToken);
        if(state.phase==='invalid'||state.phase==='complete'){
          strict=cpu.takeOwned0501FrameObservation(frameToken);
          frameToken=null;
          const reason=latch(strict?.failure??'strict frame terminal');
          try {
            strictEntryRef=strict?.entry??null;
            strictEntryCopy=strictEntryRef?copyEntry(strictEntryRef):null;
          } catch {
            strictEntryRef=null;strictEntryCopy=null;
            diagnosticLatch('strict entry snapshot unavailable');
          }
          progress({event:'strict-terminal',steps,wrapper,strict});
          ensure();
          throw new Error(reason);
        }
      }
    });},
  };
  return Object.freeze({ports:Object.freeze(wrapped),
    terminal(){return {steps,wrapper,strict,firstFailure,
      diagnosticFailure,modeArmed:!!taskToken,modeResult:terminalResult};},
    faultTerminal(){return {token:faultToken,arm:faultArm};},
    armFaultAtStrictTerminal({maxActiveSteps=100_000}={}){
      return exclusive(()=>{
        if(faultToken||faultArm||continued)
          throw new Error('PF arm already attempted or continuation begun');
        if(!strictEntryCopy||!strictEntryRef)
          throw new Error('PF arm strict entry snapshot unavailable');
        if(!taskToken||frameToken||!strict||strict.phase!=='invalid'||
           strict.failure!=='task-switch-during-owned-frame'||
           strict.returned!==null||!strict.entry||
           strict.entry.source!=='decoded-software-int31'||
           strict.entry.profile!=='gate14-code16-stack32-same-cpl3.v1'||
           strict.entry.vector!==49||strict.entry.entryAx!==1281||
           strict.entry.width!==32||strict.entry.frameBytes!==12||
           strict.entry!==strictEntryRef||
           !wrapper||!Number.isInteger(maxActiveSteps)||
           maxActiveSteps<1||maxActiveSteps>100_000)
          throw new Error('PF arm requires admitted strict AX=0501 refusal');
        if(!sameEntry(strict.entry,strictEntryCopy))
          throw new Error('PF arm strict entry changed');
        ensure();
        // This is the source-owned task token created from the committed
        // entry. The public terminal snapshot alone is not its authority.
        const modeAtArm=cpu.owned0501TaskModeStatus(taskToken);
        ensure();
        if(modeAtArm.phase!=='observing'||
           !Number.isInteger(modeAtArm.activeSteps)||modeAtArm.activeSteps<1||
           !Number.isInteger(modeAtArm.postOutgoingSteps)||
           modeAtArm.postOutgoingSteps<0||
           modeAtArm.postOutgoingSteps>modeAtArm.activeSteps||
           !Number.isInteger(modeAtArm.transitions)||modeAtArm.transitions<1)
          throw new Error('PF arm lacks committed outgoing mode session');
        faultArm={modeAtArm,preContinuationMachineSteps:steps,
          maxActiveSteps};
        faultToken=cpu.armOwned0501FaultOutcome({maxActiveSteps,postPfHandoff:true});
        if(!faultToken)throw new Error('PF arm refused');
        return Object.freeze({token:faultToken,...faultArm});
      });
    },
    continue(machine,{maxSteps=100_000,now=Date.now,wallMs=120_000}={}){
      return exclusive(()=>{
        if(continued)throw new Error('task mode continuation already consumed');
        if(!Number.isInteger(maxSteps)||maxSteps<0||maxSteps>100_000||
           !Number.isInteger(wallMs)||wallMs<1||wallMs>120_000||
           typeof now!=='function')
          throw new Error('task mode continuation bound');
        if(!taskToken||!strict||strict.phase!=='invalid'||
           strict.failure!=='task-switch-during-owned-frame')
          throw new Error('task mode continuation requires strict refusal');
        if(!faultToken||!faultArm)
          throw new Error('task mode continuation requires PF arm');
        continued=true;
        let status=null,lastPolledStatus=null,observation=null,n=0;
        let preflightPassed=false;
        const poll=()=>{
          try{status=stable(()=>cpu.owned0501TaskModeStatus(taskToken));
            lastPolledStatus=status;return true;}
          catch{diagnosticLatch('observer-status-failure');return false;}
        };
        const abort=reason=>{
          diagnosticLatch(reason);
          if(status?.phase==='observing'||status?.phase==='candidate')
            try{status=cpu.abortOwned0501TaskMode(taskToken,reason);}
            catch{diagnosticLatch('observer-abort-failure');}
        };
        const drain=()=>{
          try{observation=cpu.takeOwned0501TaskModeObservation(taskToken);}
          catch{diagnosticLatch('observer-take-failure');}
        };
        const finish=()=>{
          // Mint inside the owner pause, before either historical take and before
          // terminal progress. No public report or caller snapshot supplies tokens.
          if(!postArmAttempted){
            postArmAttempted=true;
            try{
              ensure();
              if(own(sourceMachine,'cpu')!==cpu||own(ports,'machine')!==sourceMachine||callback(cpu,'step')!==sourceCpuStep||callback(sourceMachine,'step')!==sourceBoardStep||!identities())
                throw new Error('post-PF handoff owner changed');
              ensure();
              postToken=methods.armOwned0501PostPfContinuation.call(cpu,faultToken,taskToken,{maxActiveSteps:100_000});
              if(!postToken)throw new Error('post-PF handoff refused');
              ensure();
              const initial=stable(()=>cpu.owned0501PostPfContinuationStatus(postToken));
              postArm={attempted:true,admitted:true,initial,prePostBoardCalls:n,
                preContinuationMachineSteps:steps,frameReturnQualified:false};
            }catch(error){
              postArm={attempted:true,admitted:!!postToken,initial:null,
                firstFailure:bounded(error),
                prePostBoardCalls:n,preContinuationMachineSteps:steps,frameReturnQualified:false};
            }
          }
          drain();
          const outgoing=observation?.transitions?.[0];
          const committedOutgoing=preflightPassed &&
            outgoing?.enclosingStepCommitted===true &&
            Number.isInteger(outgoing.step)&&outgoing.step>=1;
          if(!committedOutgoing)
            diagnosticLatch('committed outgoing task transition absent');
          terminalResult={status,observation,committedOutgoing,steps:n,
            lastPolledStatus,firstFailure:diagnosticFailure,
            frameReturnQualified:false};
          try{stable(()=>progress({event:'task-mode-terminal',steps:steps+n,strict,
            modeStatus:status,lastPolledModeStatus:lastPolledStatus,
            modeObservation:observation}));}
          catch{diagnosticLatch('observer-progress-failure');}
          if(poisoned)diagnosticLatch('observer-port-reentry');
          terminalResult.firstFailure=diagnosticFailure;
          return terminalResult;
        };
        if(!poll()){
          try{status=cpu.abortOwned0501TaskMode(taskToken,
            'observer-preflight-refused');}
          catch{diagnosticLatch('observer-abort-failure');}
          return finish();
        }
        if(!['observing','candidate','invalid'].includes(status?.phase)||
           !Number.isInteger(status.transitions)||status.transitions<1||
           !Number.isInteger(status.activeSteps)||status.activeSteps<1||
           !Number.isInteger(status.postOutgoingSteps)||
           status.postOutgoingSteps<0){
          diagnosticLatch('committed outgoing task transition absent');
          abort('observer-preflight-refused');
          return finish();
        }
        preflightPassed=true;
        try{
          const start=stable(now);ensure();
          if(!Number.isSafeInteger(start)||start<0){
            abort('observer-wall-bound');
            return finish();
          }
          for(;n<maxSteps&&status?.phase==='observing';){
            const elapsed=stable(now)-start;ensure();
            if(!Number.isSafeInteger(elapsed)||elapsed<0||elapsed>wallMs){
              abort('observer-wall-bound');break;
            }
            if(machine.cpu!==cpu){abort('observer-owner-change');break;}
            ensure();
            n++;
            try{machine.step();}
            catch{
              diagnosticLatch('observer-machine-step-exception');
              poll();
              abort('observer-machine-step-exception');
              break;
            }
            ensure();
            if(!poll())break;
            ensure();
            if(status?.phase==='observing'&&(n===1||n%5_000===0)){
              stable(()=>progress({event:'task-mode-continuing',steps:steps+n,
                strict,modeStatus:status}));
              ensure();
            }
          }
          if(status?.phase==='observing')abort('observer-step-bound');
        }catch{
          const reason=poisoned?'observer-port-reentry':'observer-progress-failure';
          abort(reason);
        }
        if(poisoned)abort('observer-port-reentry');
        return finish();
      },{allowPoisonedResult:true});
    },
    postTerminal(){return {arm:postArm,result:postResult};},
    continuePost({now=Date.now,maxBoardCalls=100_000,wallMs=120_000,historicalPfComplete=true}={}){
      return exclusive(()=>{
        if(postConsumed)throw new Error('post-PF continuation already consumed');
        postConsumed=true;
        const receipt={boardCalls:0,cpuAttempts:0,committedSteps:0,zeroAttemptCalls:0,
          maxBoardCalls,wallMs,elapsedMs:0,pendingStep:null,firstFailure:null};
        let status=null,observation=null,lastStatus=null,statusReads=0;
        const exceptions=[];
        const fail=reason=>{receipt.firstFailure??=reason;};
        const poll=()=>{
          if(own(sourceMachine,'cpu')!==cpu||own(ports,'machine')!==sourceMachine||callback(cpu,'step')!==sourceCpuStep||callback(sourceMachine,'step')!==sourceBoardStep||!identities())
            throw new Error('post-PF status owner changed');
          // Retain source counters even if the observer fence subsequently refuses.
          status=methods.owned0501PostPfContinuationStatus.call(cpu,postToken);lastStatus=status;statusReads++;
          const checked=stable(()=>methods.owned0501PostPfContinuationStatus.call(cpu,postToken));
          if(JSON.stringify(checked)!==JSON.stringify(status))throw new Error('post-PF status changed across fence');
          status=checked;lastStatus=status;
        };
        const abort=reason=>{
          if(own(sourceMachine,'cpu')!==cpu||own(ports,'machine')!==sourceMachine||callback(cpu,'step')!==sourceCpuStep||callback(sourceMachine,'step')!==sourceBoardStep||!identities()){fail('post-PF abort owner changed');return;}
          try{cpu.abortOwned0501PostPfContinuation(postToken,reason);}
          catch{fail('post-PF abort refused');}
          try{status=cpu.owned0501PostPfContinuationStatus(postToken);lastStatus=status;}
          catch{fail('post-PF terminal status refused');}
        };
        try{
          if(!Number.isInteger(maxBoardCalls)||maxBoardCalls<1||maxBoardCalls>100_000||
             !Number.isInteger(wallMs)||wallMs<1||wallMs>120_000||typeof now!=='function')
            throw new Error('post-PF continuation bounds');
          if(!postToken||!postArm?.admitted||postArm.firstFailure||diagnosticFailure||historicalPfComplete!==true)
            throw new Error('post-PF private handoff absent or refused');
          poll();
          const start=stable(now);let previous=start;
          if(!Number.isSafeInteger(start)||start<0)throw new Error('post-PF clock refused');
          while(status?.phase==='observing'&&receipt.boardCalls<maxBoardCalls){
            const stamp=stable(now);
            if(!Number.isSafeInteger(stamp)||stamp<previous)throw new Error('post-PF nonmonotonic clock');
            previous=stamp;receipt.elapsedMs=stamp-start;
            if(receipt.elapsedMs>wallMs){fail('observer-wall-bound');abort('observer-wall-bound');break;}
            poll();if(status.phase!=='observing')break;
            const before=status;let error,threw=false;
            ensure();
            if(own(sourceMachine,'cpu')!==cpu||own(ports,'machine')!==sourceMachine||callback(cpu,'step')!==sourceCpuStep||callback(sourceMachine,'step')!==sourceBoardStep||!identities())
              throw new Error('post-PF pre-step owner changed');
            receipt.boardCalls++;
            try{sourceMachine.step();}catch(e){error=e;threw=true;exceptions.push(bounded(e));fail('observer-machine-step-exception');}
            // The raw read precedes the observer fence. Preserve a valid source
            // delta even when that fence refuses; an absent read stays pending.
            const readBefore=statusReads;
            receipt.pendingStep={boardCall:receipt.boardCalls,beforeAttempts:before.attemptedSteps,
              beforeCommitted:before.committedSteps};
            try{poll();}finally{
              if(statusReads>readBefore){
                const attempted=status.attemptedSteps-before.attemptedSteps;
                const committed=status.committedSteps-before.committedSteps;
                if(!Number.isInteger(attempted)||attempted<0||attempted>1||
                   !Number.isInteger(committed)||committed<0||committed>attempted){
                  fail('post-PF board/CPU counter delta refused');
                }else{
                  receipt.cpuAttempts+=attempted;receipt.committedSteps+=committed;
                  if(attempted===0)receipt.zeroAttemptCalls++;
                  receipt.pendingStep=null;
                }
              }
            }
            if(receipt.pendingStep)throw new Error('post-PF board/CPU counter delta refused');
            if(status.attemptedSteps===before.attemptedSteps&&status.phase==='observing'){
              // No IRQ ticket exists in status. A zero delta is never IRQ proof.
              fail('post-PF zero-attempt cause unqualified');abort('observer-machine-step-exception');break;
            }
            if(threw){if(status.phase==='observing')abort('observer-machine-step-exception');break;}
            const endStamp=stable(now);
            if(!Number.isSafeInteger(endStamp)||endStamp<previous)throw new Error('post-PF nonmonotonic clock');
            previous=endStamp;receipt.elapsedMs=endStamp-start;
            if(receipt.elapsedMs>wallMs){fail('observer-wall-bound');abort('observer-wall-bound');break;}
            poll();
            if(status.phase==='observing'&&(receipt.boardCalls===1||receipt.boardCalls%5_000===0))
              stable(()=>progress({event:'post-pf-continuing',receipt:{...receipt},status}));
          }
          if(status?.phase==='observing'){fail('observer-step-bound');abort('observer-step-bound');}
        }catch(error){
          fail(bounded(error));
          if(postToken)abort(poisoned?'observer-port-reentry':'observer-progress-failure');
        }
        if(postToken){
          try{
            // Never drain through a changed machine/CPU owner.
            if(own(sourceMachine,'cpu')!==cpu||own(ports,'machine')!==sourceMachine||callback(cpu,'step')!==sourceCpuStep||callback(sourceMachine,'step')!==sourceBoardStep||!identities())
              throw new Error('post-PF drain owner changed');
            status=cpu.owned0501PostPfContinuationStatus(postToken);lastStatus=status;
            if(status.phase==='observing')abort('observer-preflight-refused');
            observation=cpu.takeOwned0501PostPfContinuationObservation(postToken);
            if(!observation)fail('post-PF drain absent');
          }catch{fail('post-PF final status or drain refused');}
        }
        postResult={arm:postArm,receipt,status,lastStatus,observation,exceptions,
          firstFailure:receipt.firstFailure,frameReturnQualified:false};
        try{stable(()=>progress({event:'post-pf-terminal',postPf:postResult}));}
        catch{fail('post-PF terminal progress refused');postResult.firstFailure=receipt.firstFailure;}
        return postResult;
      },{allowPoisonedResult:true});
    }});
}
