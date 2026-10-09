import assert from 'node:assert/strict';
import {gradePfOutcome} from './grade.mjs';

function fixture(){
  const entry={source:'decoded-software-int31',entryAx:1281,vector:49,
    gateType:14,width:32,frameBytes:12,oldCpl:3,newCpl:3,
    profile:'gate14-code16-stack32-same-cpl3.v1'};
  const ctx={cs:24,eip:100,ss:32,esp:4096,cr0:1,cr2:0x4a0080,
    cr3:229376,flags:2,cpl:0,retainedRealCs:false,shutdown:false,
    protectedMode:true,vm86:false};
  return {finiteClient:{passed:false,guestFiles:{returned:null}},
    strict:{firstFailure:'task-switch-during-owned-frame',
      strict:{phase:'invalid',failure:'task-switch-during-owned-frame',
        returned:null,entry,taskSwitchAttempt:{kind:'jmp',selector:112,
          sourceCs:43,attemptEip:15928},
        taskSwitchOutcome:{postCs:24,postEip:16105}}},
    taskMode:{steps:2,committedOutgoing:true,firstFailure:null,
      status:{activeSteps:20,postOutgoingSteps:10},
      observation:{phase:'invalid',firstFailure:'step-failure',
      frameReturnQualified:false,truncated:false,
      cookie:{entry,trSelector:96,trType:11,
        trBase:188810,trLimit:241,cr3:229376},activeSteps:20,
      postOutgoingSteps:10,
      transitions:[{step:19,kind:'jmp',selector:112,
        enclosingStepCommitted:true,
        source:{cs:43,eip:15928,trSelector:96,trType:11,
          trBase:188810,trLimit:241,cr3:229376},
        post:{cs:24,eip:16105}}],
      deliveries:[{kind:'cpu-fault',step:21,
        enclosingStepCommitted:false,fault:{available:true,vector:14,
          errorCodePresent:true}}]}},
    pfOutcome:{arm:{modeAtArm:{activeSteps:19,postOutgoingSteps:9,
        transitions:1},preContinuationMachineSteps:123,
        maxActiveSteps:100_000},continuationCalls:1,
      continuationAttemptedMachineSteps:2,
      stepMonitor:{boardCalls:2,cpuAttempts:2,oneToOne:true,
        firstFailure:null},
      status:{phase:'complete',firstFailure:null,attemptedSteps:2},
      observation:{schema:'bw.i80386-owned-0501.pf-delivery-outcome.v1',
        phase:'complete',firstFailure:null,frameReturnQualified:false,
        attemptedSteps:2,fault:{step:2,instructionStart:100,vector:14,
          errorCodePresent:true,errorCode:2,taskCommitted:false,source:ctx},
        delivery:{attempted:true,outcome:'returned',restored:true,
          returnEip:100,pre:ctx,post:ctx,stepResult:0}},
      firstFailure:null}};
}
const good=fixture();
assert.equal(gradePfOutcome(good).pfCallConsistent,true);
assert.equal(gradePfOutcome(good).frameReturnQualified,false);
const negative=(name,mutate)=>{
  const report=fixture();mutate(report);
  assert.equal(gradePfOutcome(report).pfCallConsistent,false,name);
};
negative('cloned entry session',r=>{
  r.taskMode.observation.cookie.entry={...r.strict.strict.entry};
});
negative('malformed CPU context',r=>{r.pfOutcome.observation.fault.source.cr3=1.5;});
negative('missing strict refusal',r=>{r.strict.strict.failure='other';});
negative('false full client',r=>{r.finiteClient.passed=true;});
negative('step without continuation',r=>{r.pfOutcome.continuationCalls=0;});
negative('PF status missing',r=>{r.pfOutcome.status=null;});
negative('reset invalid',r=>{r.pfOutcome.observation.phase='invalid';});
negative('malformed PF numeric',r=>{r.pfOutcome.observation.fault.errorCode=2.5;});
negative('not PF',r=>{r.pfOutcome.observation.fault.vector=13;});
negative('missing delivery',r=>{r.pfOutcome.observation.delivery=null;});
negative('no call credit',r=>{r.pfOutcome.observation.delivery.attempted=false;});
negative('returned shutdown context drift',r=>{r.pfOutcome.observation.delivery.post.shutdown=1;});
negative('mode fault absent',r=>{r.taskMode.observation.deliveries=[];});
negative('unwitnessed board step',r=>{r.pfOutcome.stepMonitor.oneToOne=false;});
negative('board/PF attempt mismatch',r=>{r.pfOutcome.stepMonitor.cpuAttempts=1;});
negative('mode committed delta mismatch',r=>{r.taskMode.observation.activeSteps=21;});
negative('mode outgoing delta mismatch',r=>{r.taskMode.observation.postOutgoingSteps=11;});
negative('terminal PF row not adjacent',r=>{
  r.taskMode.observation.deliveries[0].step=22;});
negative('duplicate uncommitted PF',r=>{
  r.taskMode.observation.deliveries.push({...r.taskMode.observation.deliveries[0]});});
negative('outgoing session cookie changed',r=>{
  r.taskMode.observation.transitions[0].source.trSelector=104;});
negative('outgoing source context changed',r=>{
  r.taskMode.observation.transitions[0].source.eip=15930;});
negative('outgoing post context changed',r=>{
  r.taskMode.observation.transitions[0].post.cs=25;});
negative('counter fractional',r=>{r.pfOutcome.status.attemptedSteps=2.5;
  r.pfOutcome.observation.attemptedSteps=2.5;});
process.stdout.write('PF connected grade synthetic controls PASS\n');
