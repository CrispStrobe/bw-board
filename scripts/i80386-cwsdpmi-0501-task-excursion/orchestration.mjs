// CPU-free ordering policy. The actual adapter owns the machine and ports.
export function createTaskOrchestration(ports,{cpu,opportunity,progress}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      typeof cpu?.armOwned0501FrameJournal!=='function' ||
      typeof cpu?.armOwned0501TaskExcursion!=='function' ||
      typeof opportunity!=='function' || typeof progress!=='function')
    throw new Error('task excursion port contract');
  let busy=false,poisoned=false,bound=false,frameToken=null,taskToken=null;
  let wrapper=null,strict=null,firstFailure=null,diagnosticFailure=null,steps=0;
  const latch=reason=>{firstFailure??=reason;return firstFailure;};
  const diagnosticLatch=reason=>{diagnosticFailure??=reason;return diagnosticFailure;};
  const ensure=()=>{
    if(poisoned)throw new Error(latch('task port reentry'));
  };
  const exclusive=fn=>{
    if(busy){poisoned=true;throw new Error(latch('task port reentry'));}
    if(poisoned)throw new Error(latch('task port reentry'));
    busy=true;
    try{
      const value=fn();
      if(poisoned)throw new Error(latch('task port reentry'));
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
          taskToken=cpu.armOwned0501TaskExcursion(frameToken);
          if(!taskToken)throw new Error(latch('task excursion arm refused'));
          progress({event:'task-armed',steps,wrapper,frameStatus:state});
          ensure();
        }
      }
      if(frameToken){
        const state=cpu.owned0501FrameStatus(frameToken);
        if(state.phase==='invalid'||state.phase==='complete'){
          strict=cpu.takeOwned0501FrameObservation(frameToken);
          frameToken=null;
          progress({event:'strict-terminal',steps,wrapper,strict});
          ensure();
          throw new Error(latch(strict?.failure??'strict frame terminal'));
        }
      }
    });},
  };
  return Object.freeze({ports:Object.freeze(wrapped),
    terminal(){return {steps,wrapper,strict,firstFailure,taskArmed:!!taskToken};},
    continue(machine,{maxSteps=100_001,now=Date.now,wallMs=120_000}={}){
      return exclusive(()=>{
        if(!taskToken||!strict||strict.phase!=='invalid'||
           strict.failure!=='task-switch-during-owned-frame')
          throw new Error('task continuation requires strict refusal');
        let status=cpu.owned0501TaskExcursionStatus(taskToken);
        if(!['observing','candidate','invalid'].includes(status.phase)||
           !Number.isInteger(status.transitions)||status.transitions<1||
           !Number.isInteger(status.activeSteps)||status.activeSteps<1){
          diagnosticLatch('committed outgoing task transition absent');
          if(status.phase==='observing'||status.phase==='candidate')
            status=cpu.abortOwned0501TaskExcursion(taskToken,
              'observer-preflight-refused');
          const observation=status.phase==='invalid'?
            cpu.takeOwned0501TaskExcursionObservation(taskToken):null;
          return {status,observation,committedOutgoing:false,
            firstFailure:diagnosticFailure};
        }
        const abort=reason=>{
          diagnosticLatch(reason);
          if(status.phase==='observing'||status.phase==='candidate')
            status=cpu.abortOwned0501TaskExcursion(taskToken,reason);
        };
        let n=0;
        try{
          const start=now();ensure();
          for(;n<maxSteps&&status.phase==='observing';n++){
            const elapsed=now()-start;ensure();
            if(elapsed>wallMs){abort('observer-wall-bound');break;}
            if(machine.cpu!==cpu){abort('observer-owner-change');break;}
            ensure();
            try{machine.step();}
            catch(error){
              status=cpu.owned0501TaskExcursionStatus(taskToken);
              abort('observer-machine-step-exception');
              break;
            }
            ensure();
            status=cpu.owned0501TaskExcursionStatus(taskToken);
            ensure();
            if(n%5_000===0){
              progress({event:'task-continuing',steps:steps+n+1,
                strict,taskStatus:status});
              ensure();
            }
          }
          if(status.phase==='observing')abort('observer-step-bound');
        }catch(error){
          const reason=poisoned?'observer-port-reentry':'observer-progress-failure';
          abort(reason);
        }
        const observation=status.phase==='observing'?null:
          cpu.takeOwned0501TaskExcursionObservation(taskToken);
        const outgoing=observation?.transitions?.[0];
        const committedOutgoing=outgoing?.enclosingStepCommitted===true &&
          Number.isInteger(outgoing.step) && outgoing.step>=1;
        if(!committedOutgoing)
          diagnosticLatch('committed outgoing task transition absent');
        try {progress({event:'task-terminal',steps:steps+n,strict,taskStatus:status,
          taskObservation:observation});}
        catch {diagnosticLatch('observer-progress-failure');}
        return {status,observation,committedOutgoing,
          firstFailure:diagnosticFailure};
      });
    }});
}
