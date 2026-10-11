import assert from 'node:assert/strict';
import {gradePfOutcome} from '../i80386-cwsdpmi-0501-pf-connected/grade.mjs';
import {gradePostPfConnected} from './grade.mjs';
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
function sourceContext(extra={}){
 return {cs:24,eip:100,ss:32,esp:4096,cr3:229376,trSelector:112,trType:11,
  trBase:190000,trLimit:103,trPresent:true,vm86:false,cpl:0,nt:false,protectedMode:true,...extra};
}
function sourceMode(){
 const cache={base:0,limit:65535,default32:false,present:true,code:true,readable:true,
  writable:false,dpl:0,conforming:false,access:154,address:0,expandDown:null,null:null};
 return {...sourceContext(),rawCr0:1,rawFlags:2,retainedRealCs:false,
  codeCache:cache,stackCache:{...cache,code:false,writable:true,conforming:null,expandDown:false},mode:'protected'};
}
function iretEvent(){const before=sourceMode();return {kind:'decoded-iret-intent',step:1,
 source:before,instructionStart:100,width:32,before,after:sourceMode(),enclosingStepCommitted:false};}
function report(){
 const r=fixture();r.pfGrade=gradePfOutcome(r);
 const status={phase:'invalid',firstFailure:'uncommitted-step',attemptedSteps:1,committedSteps:0};
 r.postPf={arm:{attempted:true,admitted:true,initial:{phase:'observing',firstFailure:null,attemptedSteps:0,committedSteps:0},prePostBoardCalls:2,preContinuationMachineSteps:123,frameReturnQualified:false},
 receipt:{boardCalls:1,cpuAttempts:1,committedSteps:0,zeroAttemptCalls:0,maxBoardCalls:100000,wallMs:120000,elapsedMs:1,pendingStep:null,firstFailure:null},
 status,lastStatus:status,observation:{schema:'bw.i80386-owned-0501.post-pf-continuation.v1',...status,cookie:r.taskMode.observation.cookie,originalOutgoing:r.taskMode.observation.transitions[0],initialFault:r.pfOutcome.observation.fault,transitions:[],uncommittedTransitions:[],deliveries:[],events:[iretEvent()],modeChanges:[],uncommittedModes:[],modeRefusal:null,resumeCandidate:null,truncated:false,frameReturnQualified:false},exceptions:[],firstFailure:null,frameReturnQualified:false};
 return r;
}
const good=report();assert.equal(gradePostPfConnected(good).observationConsistent,true);
assert.equal(gradePostPfConnected(good).frameReturnQualified,false);
for(const mutate of [r=>{r.pfOutcome.observation.delivery.outcome='threw';},r=>{r.strict.strict.returned={};},r=>{r.pfGrade.postShutdown=true;},r=>{r.postPf.arm.admitted=1;},r=>{r.postPf.receipt.cpuAttempts=2;},r=>{r.postPf.receipt.zeroAttemptCalls=1;},r=>{r.postPf.receipt.wallMs=120001;},r=>{r.postPf.receipt.elapsedMs=120001;},r=>{r.postPf.observation.cookie={};},r=>{r.postPf.observation.initialFault={};},r=>{r.postPf.observation.originalOutgoing={};},r=>{r.postPf.observation.frameReturnQualified=true;},r=>{r.postPf.observation.truncated=true;},r=>{r.postPf.observation.events=Array.from({length:65},()=>({}));},r=>{r.postPf.observation.phase='candidate';r.postPf.observation.firstFailure=null;r.postPf.observation.resumeCandidate={};r.postPf.status={...r.postPf.status,phase:'candidate',firstFailure:null};r.postPf.lastStatus=r.postPf.status;},r=>{r.postPf.firstFailure='adapter failure';},r=>{r.postPf.exceptions=['source error'];}]){
 const r=report();mutate(r);assert.equal(gradePostPfConnected(r).observationConsistent,false);
}
function candidateReport(){
 const r=report(),o=r.postPf.observation;
 Object.assign(r.strict.strict.entry,{handlerCs:43,handlerSs:51});
 Object.assign(r.taskMode.observation.transitions[0].source,{savedEip:16000,ss:51,esp:4096});
 r.pfGrade=gradePfOutcome(r);
 Object.assign(o,{phase:'candidate',firstFailure:null,attemptedSteps:2,committedSteps:1,
  resumeCandidate:{step:1,transition:1,originalTr:true,savedContinuation:true,handlerContext:true,taskContext:true},
  transitions:[{step:1,kind:'iret',selector:96,source:sourceContext({savedEip:101}),enclosingStepCommitted:true,outcome:'core-return',post:sourceContext({cs:43,eip:16000,ss:51,trSelector:96,trBase:188810,trLimit:241,cpl:3})}]});
 Object.assign(r.postPf.receipt,{boardCalls:2,cpuAttempts:2,committedSteps:1});
 r.postPf.status={phase:'candidate',firstFailure:null,attemptedSteps:2,committedSteps:1};r.postPf.lastStatus=r.postPf.status;
 return r;
}
assert.equal(gradePostPfConnected(candidateReport()).observationConsistent,true,'Q1/N2 candidate is permitted');
for(const mutate of [r=>{r.postPf.observation.resumeCandidate.step=2;},r=>{r.postPf.observation.resumeCandidate.originalTr=1;},r=>{r.postPf.observation.transitions[0].post.trSelector=97;},r=>{r.postPf.observation.transitions[0].post.eip=16001;},r=>{r.postPf.observation.transitions[0].post.ss=52;},r=>{r.postPf.observation.transitions[0].post.cpl=0;}]){
 const r=candidateReport();mutate(r);assert.equal(gradePostPfConnected(r).observationConsistent,false);
}
for(const mutate of [
 r=>{r.postPf.observation.events[0]={kind:'decoded-iret-intent',step:1};},
 r=>{r.postPf.observation.events[0].kind='invented';},
 r=>{r.postPf.observation.events[0].step=-1;},
 r=>{r.postPf.observation.events[0].step=2;},
 r=>{r.postPf.observation.events[0].enclosingStepCommitted=0;},
 r=>{r.postPf.observation.events[0].extra=true;},
 r=>{r.postPf.observation.events[0].before.codeCache.present=1;},
 r=>{r.postPf.observation.deliveries=[{step:1,kind:'cpu-fault',enclosingStepCommitted:false,fault:{available:1}}];},
 r=>{r.postPf.observation.modeRefusal={step:0,before:sourceMode(),after:sourceMode(),operation:{kind:'invented'},enclosingStepCommitted:false};},
 r=>{r.postPf.receipt.pendingStep={boardCall:1,beforeAttempts:0,beforeCommitted:0};}]){
 const r=report();mutate(r);assert.equal(gradePostPfConnected(r).observationConsistent,false);
}
const irq=report();irq.postPf.observation.events=[{kind:'source-interrupt',step:0,vector:32,nmi:false,
 before:sourceMode(),after:sourceMode(),sourceOperationReturned:true,enclosingStepCommitted:false}];
assert.equal(gradePostPfConnected(irq).irqBoundaryEvents,1);
const partialIntent=report();
partialIntent.postPf.observation.firstFailure='step-failure';
partialIntent.postPf.status.firstFailure='step-failure';
delete partialIntent.postPf.observation.events[0].before;
delete partialIntent.postPf.observation.events[0].after;
assert.equal(gradePostPfConnected(partialIntent).decodedIretIntents,1,'pending source intent retains no settled context');
const halfSettled=structuredClone(partialIntent);halfSettled.postPf.observation.events[0].after=sourceMode();
assert.equal(gradePostPfConnected(halfSettled).observationConsistent,false);
const falselyCommitted=structuredClone(partialIntent);falselyCommitted.postPf.observation.events[0].enclosingStepCommitted=true;
assert.equal(gradePostPfConnected(falselyCommitted).observationConsistent,false);
partialIntent.postPf.exceptions=['synthetic original step exception'];
partialIntent.postPf.firstFailure=partialIntent.postPf.receipt.firstFailure='observer-machine-step-exception';
assert.equal(gradePostPfConnected(partialIntent).observationConsistent,false,'source partials do not launder adapter throw');
for(const mutate of [
 r=>{r.postPf.observation.deliveries=[{step:1,vector:32,returnEip:100,software:false,external:true,errorCodePresent:false,enclosingStepCommitted:true}];},
 r=>{r.postPf.observation.modeChanges=[{step:1,before:sourceMode(),after:sourceMode(),operation:{kind:'task-core-return'},enclosingStepCommitted:true}];},
 r=>{r.postPf.observation.modeRefusal={step:2,before:sourceMode(),after:sourceMode(),operation:null,enclosingStepCommitted:false};}]){
 const r=report();mutate(r);assert.equal(gradePostPfConnected(r).observationConsistent,false,'source Q/N bound');
}
const uncommitted=report();uncommitted.postPf.observation.deliveries=[{step:1,vector:32,returnEip:100,software:false,external:true,errorCodePresent:false,enclosingStepCommitted:false}];
assert.equal(gradePostPfConnected(uncommitted).observationConsistent,true,'uncommitted Q+1 retained');
console.log('PASS post-PF grade synthetic controls only; no frame return');
