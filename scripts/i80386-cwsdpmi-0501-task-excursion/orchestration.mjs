// CPU-free ordering policy. The actual adapter owns the machine and ports.
export function createTaskOrchestration(ports,{cpu,opportunity,progress}) {
  if (!ports || typeof ports.bind!=='function' || typeof ports.step!=='function' ||
      typeof cpu?.armOwned0501FrameJournal!=='function' ||
      typeof cpu?.armOwned0501TaskExcursion!=='function' ||
      typeof opportunity!=='function' || typeof progress!=='function')
    throw new Error('task excursion port contract');
  let busy=false,poisoned=false,bound=false,frameToken=null,taskToken=null;
  let wrapper=null,strict=null,firstFailure=null,steps=0;
  const latch=reason=>{firstFailure??=reason;return firstFailure;};
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
        if(candidate!==null){
          wrapper=candidate.receipt;
          frameToken=cpu.armOwned0501FrameJournal({
            cs:candidate.cs,startEip:candidate.comparison.address,
            endEip:candidate.comparison.address+candidate.comparison.bytes,
            maxActiveSteps:1_000_000,
            profile:'gate14-code16-stack32-same-cpl3.v1'});
          if(!frameToken)throw new Error(latch('frame arm refused'));
          progress({event:'frame-armed',steps,wrapper});
        }
      }
      ports.step();steps++;
      if(frameToken&&!taskToken){
        const state=cpu.owned0501FrameStatus(frameToken);
        if(state.phase==='open'){
          taskToken=cpu.armOwned0501TaskExcursion(frameToken);
          if(!taskToken)throw new Error(latch('task excursion arm refused'));
          progress({event:'task-armed',steps,wrapper,frameStatus:state});
        }
      }
      if(frameToken){
        const state=cpu.owned0501FrameStatus(frameToken);
        if(state.phase==='invalid'||state.phase==='complete'){
          strict=cpu.takeOwned0501FrameObservation(frameToken);
          frameToken=null;
          progress({event:'strict-terminal',steps,wrapper,strict});
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
        const start=now();let status=cpu.owned0501TaskExcursionStatus(taskToken);
        for(let n=0;n<maxSteps&&status.phase==='observing';n++){
          if(now()-start>wallMs){latch('task continuation wall bound');break;}
          if(machine.cpu!==cpu){latch('task CPU owner changed');break;}
          try{machine.step();}catch(error){latch('task continuation machine step exception');break;}
          status=cpu.owned0501TaskExcursionStatus(taskToken);
          if(n%5_000===0)progress({event:'task-continuing',steps:steps+n+1,
            strict,taskStatus:status});
        }
        if(status.phase==='observing')latch('task continuation step bound');
        const observation=status.phase==='observing'?null:
          cpu.takeOwned0501TaskExcursionObservation(taskToken);
        const outgoing=observation?.transitions?.[0];
        const committedOutgoing=outgoing?.enclosingStepCommitted===true &&
          Number.isInteger(outgoing.step) && outgoing.step>=1;
        if(!committedOutgoing)latch('committed outgoing task transition absent');
        progress({event:'task-terminal',steps,strict,taskStatus:status,
          taskObservation:observation});
        return {status,observation,committedOutgoing,firstFailure};
      });
    }});
}
