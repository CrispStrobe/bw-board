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

export function createPfConnectedOrchestration(ports,{cpu,opportunity,progress}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      typeof cpu?.armOwned0501FrameJournal!=='function' ||
      typeof cpu?.armOwned0501TaskMode!=='function' ||
      typeof opportunity!=='function' || typeof progress!=='function')
    throw new Error('task mode port contract');
  let busy=false,poisoned=false,bound=false,frameToken=null,taskToken=null;
  let wrapper=null,strict=null,strictEntryRef=null,strictEntryCopy=null,
    firstFailure=null,diagnosticFailure=null,steps=0;
  let continued=false,terminalResult=null,faultToken=null,faultArm=null;
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
    if(poisoned){latch('task mode port reentry');
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
        faultToken=cpu.armOwned0501FaultOutcome({maxActiveSteps});
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
          try{status=cpu.owned0501TaskModeStatus(taskToken);
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
          try{progress({event:'task-mode-terminal',steps:steps+n,strict,
            modeStatus:status,lastPolledModeStatus:lastPolledStatus,
            modeObservation:observation});}
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
          const start=now();ensure();
          if(!Number.isSafeInteger(start)||start<0){
            abort('observer-wall-bound');
            return finish();
          }
          for(;n<maxSteps&&status?.phase==='observing';){
            const elapsed=now()-start;ensure();
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
            if(n===1||n%5_000===0){
              progress({event:'task-mode-continuing',steps:steps+n,
                strict,modeStatus:status});
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
    }});
}
