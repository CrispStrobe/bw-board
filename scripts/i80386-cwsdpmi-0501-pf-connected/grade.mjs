// CPU-free source-consistency predicate. The adapter authenticates the fresh
// machine/client/source. This cannot prove PF service or frame return.
const int=(v,lo,hi)=>Number.isInteger(v)&&v>=lo&&v<=hi;
const fail=reason=>Object.freeze({schema:'bw.cwsdpmi-0501-pf-connected.grade.v1',
  pfCallConsistent:false,firstFailure:reason,frameReturnQualified:false});
function ctx(c){
  if(!c||typeof c!=='object'||!int(c.cs,0,65535)||!int(c.ss,0,65535)||
     !int(c.eip,0,0xffffffff)||!int(c.esp,0,0xffffffff)||
     !int(c.cr0,0,0xffffffff)||!int(c.cr2,0,0xffffffff)||
     !int(c.cr3,0,0xffffffff)||!int(c.flags,0,0xffffffff)||
     !int(c.cpl,0,3)||typeof c.retainedRealCs!=='boolean'||
     typeof c.shutdown!=='boolean'||typeof c.protectedMode!=='boolean'||
     typeof c.vm86!=='boolean')return false;
  const pe=!!(c.cr0&1),vm=pe&&!!(c.flags&0x20000);
  return c.protectedMode===pe&&c.vm86===vm&&
    c.cpl===(vm?3:(!pe||c.retainedRealCs?0:c.cs&3));
}
export function gradePfOutcome({finiteClient,strict,taskMode,pfOutcome}){
  try{
    const frame=strict?.strict,entry=frame?.entry,
      mode=taskMode?.observation,arm=pfOutcome?.arm,
      state=pfOutcome?.status,observation=pfOutcome?.observation;
    if(finiteClient?.passed!==false||finiteClient?.guestFiles?.returned!==null||
       frame?.phase!=='invalid'||frame.failure!=='task-switch-during-owned-frame'||
       frame.returned!==null||strict?.firstFailure!==frame.failure||
       !entry||entry.source!=='decoded-software-int31'||entry.entryAx!==1281||
       entry.vector!==49||entry.gateType!==14||entry.width!==32||
       entry.frameBytes!==12||entry.oldCpl!==3||entry.newCpl!==3||
       entry.profile!=='gate14-code16-stack32-same-cpl3.v1')
      return fail('strict source entry/client boundary');
    if(pfOutcome?.firstFailure||pfOutcome?.continuationCalls!==1||
       !arm||!int(arm.preContinuationMachineSteps,1,100_000_000)||
       !int(arm.maxActiveSteps,1,100_000)||
       !int(arm.modeAtArm?.activeSteps,1,200_000)||
       !int(arm.modeAtArm?.postOutgoingSteps,0,100_000)||
       arm.modeAtArm.postOutgoingSteps>arm.modeAtArm.activeSteps||
       arm.modeAtArm?.transitions!==1||
       !int(pfOutcome.continuationAttemptedMachineSteps,1,100_000)||
       pfOutcome.stepMonitor?.oneToOne!==true||
       pfOutcome.stepMonitor.firstFailure!==null||
       pfOutcome.stepMonitor.boardCalls!==
         pfOutcome.continuationAttemptedMachineSteps||
       taskMode?.steps!==pfOutcome.stepMonitor.boardCalls||
       pfOutcome.stepMonitor.cpuAttempts!==
         pfOutcome.stepMonitor.boardCalls)
      return fail('unbound PF arm or continuation');
    const calls=pfOutcome.stepMonitor.boardCalls,
      outgoing=mode?.transitions?.[0],attempt=frame.taskSwitchAttempt,
      taskOutcome=frame.taskSwitchOutcome;
    if(taskMode.committedOutgoing!==true||taskMode.firstFailure!==null||
       mode?.phase!=='invalid'||mode.firstFailure!=='step-failure'||
       mode.truncated!==false||
       mode.frameReturnQualified!==false||mode.cookie?.entry!==entry||
       !int(mode.activeSteps,arm.modeAtArm.activeSteps,200_000)||
       !int(mode.postOutgoingSteps,arm.modeAtArm.postOutgoingSteps,100_000)||
       mode.activeSteps!==arm.modeAtArm.activeSteps+calls-1||
       mode.postOutgoingSteps!==arm.modeAtArm.postOutgoingSteps+calls-1||
       taskMode.status?.activeSteps!==mode.activeSteps||
       taskMode.status?.postOutgoingSteps!==mode.postOutgoingSteps||
       !Array.isArray(mode.transitions)||!outgoing||
       outgoing.enclosingStepCommitted!==true||
       !int(outgoing.step,1,100_000)||
       outgoing.step!==arm.modeAtArm.activeSteps||
       outgoing.kind!=='jmp'||attempt?.kind!=='jmp'||
       !int(outgoing.selector,0,65535)||
       outgoing.selector!==attempt.selector||
       outgoing.source?.cs!==attempt?.sourceCs||
       outgoing.source?.eip!==attempt?.attemptEip||
       outgoing.source?.trSelector!==mode.cookie.trSelector||
       outgoing.source?.trType!==mode.cookie.trType||
       outgoing.source?.trBase!==mode.cookie.trBase||
       outgoing.source?.trLimit!==mode.cookie.trLimit||
       outgoing.source?.cr3!==mode.cookie.cr3||
       outgoing.post?.cs!==taskOutcome?.postCs||
       outgoing.post?.eip!==taskOutcome?.postEip||
       !Array.isArray(mode.deliveries))
      return fail('same task session terminal PF facts');
    const uncommitted=mode.deliveries.filter(v=>
      v?.enclosingStepCommitted===false);
    if(uncommitted.length!==1||
       uncommitted[0]!==mode.deliveries.at(-1)||
       uncommitted[0].step!==mode.activeSteps+1||
       uncommitted[0].step!==arm.modeAtArm.activeSteps+calls||
       uncommitted[0].kind!=='cpu-fault'||
       uncommitted[0].fault?.available!==true||
       uncommitted[0].fault.vector!==14||
       uncommitted[0].fault.errorCodePresent!==true)
      return fail('terminal mode PF row not unique or joined');
    if(state?.phase!=='complete'||state.firstFailure!==null||
       observation?.schema!=='bw.i80386-owned-0501.pf-delivery-outcome.v1'||
       observation.phase!=='complete'||observation.firstFailure!==null||
       observation.frameReturnQualified!==false||
       !int(observation.attemptedSteps,1,arm.maxActiveSteps)||
       state.attemptedSteps!==observation.attemptedSteps||
       observation.attemptedSteps!==calls)
      return fail('PF recorder incomplete or refused');
    const fault=observation.fault,delivery=observation.delivery;
    if(!fault||!int(fault.step,1,arm.maxActiveSteps)||
       fault.step!==observation.attemptedSteps||fault.vector!==14||
       fault.errorCodePresent!==true||!int(fault.errorCode,0,0xffffffff)||
       !int(fault.instructionStart,0,0xffffffff)||
       typeof fault.taskCommitted!=='boolean'||!ctx(fault.source)||
       !delivery||typeof delivery.restored!=='boolean'||
       delivery.restored===fault.taskCommitted||
       !ctx(delivery.pre)||!ctx(delivery.post)||
       fault.source.cr0!==delivery.pre.cr0||
       fault.source.cr2!==delivery.pre.cr2||
       fault.source.cr3!==delivery.pre.cr3)
      return fail('source PF/context/restore fact');
    if(delivery.attempted===true){
      if(!['returned','threw'].includes(delivery.outcome)||
         !int(delivery.returnEip,0,0xffffffff)||
         delivery.returnEip!==delivery.pre.eip&&fault.taskCommitted||
         !fault.taskCommitted&&delivery.returnEip!==fault.instructionStart||
         (delivery.outcome==='returned'&&delivery.stepResult!==0)||
         (delivery.outcome==='threw'&&delivery.stepResult!==null))
        return fail('delivery call source continuity');
    } else if(delivery.attempted!==false||delivery.outcome!=='disabled'||
              delivery.returnEip!==null||delivery.stepResult!==null)
      return fail('disabled delivery source continuity');
    return Object.freeze({schema:'bw.cwsdpmi-0501-pf-connected.grade.v1',
      pfCallConsistent:true,firstFailure:null,
      outcome:delivery.outcome,attemptedSteps:observation.attemptedSteps,
      faultVector:14,errorCode:fault.errorCode,
      faultTimeCr2:fault.source.cr2,faultTimeCr3:fault.source.cr3,
      postShutdown:delivery.post.shutdown,
      frameReturnQualified:false});
  }catch{return fail('PF grade source shape unavailable');}
}
