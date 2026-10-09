// CPU-free ordering policy. The actual adapter owns the machine and ports.
export function createTaskModeOrchestration(ports,{cpu,opportunity,progress}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      typeof cpu?.armOwned0501FrameJournal!=='function' ||
      typeof cpu?.armOwned0501TaskMode!=='function' ||
      typeof opportunity!=='function' || typeof progress!=='function')
    throw new Error('task mode port contract');
  let busy=false,poisoned=false,bound=false,frameToken=null,taskToken=null;
  let wrapper=null,strict=null,firstFailure=null,diagnosticFailure=null,steps=0;
  let continued=false,terminalResult=null;
  const latch=reason=>{firstFailure??=reason;return firstFailure;};
  const diagnosticLatch=reason=>{diagnosticFailure??=reason;return diagnosticFailure;};
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
          progress({event:'strict-terminal',steps,wrapper,strict});
          ensure();
          throw new Error(reason);
        }
      }
    });},
  };
  return Object.freeze({ports:Object.freeze(wrapped),
    terminal(){return {steps,wrapper,strict,firstFailure,
      modeArmed:!!taskToken,modeResult:terminalResult};},
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
