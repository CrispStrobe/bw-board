import assert from 'node:assert/strict';
import {createPostPfConnectedOrchestration,boundaryFingerprint} from './orchestration.mjs';
function fixture(failure='task-switch-during-owned-frame',onProgress=null,
    machineThrows=false,hasTransition=true) {
  const frameToken=Object.freeze({}),taskToken=Object.freeze({});
  const faultToken=Object.freeze({});
  let frame='armed',task='observing',stepCalls=0,taskArmCalls=0;
  let transitionPresent=hasTransition;
  let pfArmCalls=0,pfPhase='armed';
  const updates=[],order=[];
  let postMinted=false,postPhase='observing',postAttempts=0,postCommits=0,postDrained=false;
  let delta=1,postHook=null,statusThrows=false,drainThrows=false;
  const cpu={
    armOwned0501FrameJournal(options){
      assert.equal(options.profile,'gate14-code16-stack32-same-cpl3.v1');
      return frameToken;
    },
    owned0501FrameStatus(token){
      assert.equal(token,frameToken);
      return {phase:frame,failure:frame==='invalid'?failure:null};
    },
    armOwned0501TaskMode(token){
      assert.equal(token,frameToken);taskArmCalls++;return taskToken;
    },
    takeOwned0501FrameObservation(token){
      assert.equal(token,frameToken);
      return {phase:'invalid',failure,entry:{source:'decoded-software-int31',
        profile:'gate14-code16-stack32-same-cpl3.v1',vector:49,
        entryAx:1281,width:32,frameBytes:12},returned:null};
    },
    owned0501TaskModeStatus(token){
      assert.equal(token,taskToken);
      return {phase:task,activeSteps:stepCalls-1,postOutgoingSteps:Math.max(0,stepCalls-2),
        transitions:transitionPresent?1:0,modeChanges:stepCalls>2?1:0};
    },
    abortOwned0501TaskMode(token,reason){
      assert.equal(token,taskToken);assert.match(reason,/^observer-/);
      task='invalid';
      return {phase:task,activeSteps:stepCalls-1,postOutgoingSteps:Math.max(0,stepCalls-2),
        transitions:transitionPresent?1:0,
        firstFailure:reason};
    },
    takeOwned0501TaskModeObservation(token){
      assert.equal(token,taskToken);order.push('task-take');
      assert.equal(postMinted,true,'historical drain must follow private mint');
      if(task==='observing')return null;
      return {phase:task,frameReturnQualified:false,
        activeSteps:stepCalls-1,postOutgoingSteps:Math.max(0,stepCalls-2),
        modeChanges:stepCalls>2?[{step:stepCalls-1,operation:'mov-cr0'}]:[],
        transitions:transitionPresent?[{step:2,enclosingStepCommitted:true}]:[]};
    },
    armOwned0501FaultOutcome(options){
      assert.equal(options.maxActiveSteps,100_000);
      assert.equal(options.postPfHandoff,true);
      pfArmCalls++;return faultToken;
    },
    owned0501FaultOutcomeStatus(token){
      assert.equal(token,faultToken);
      return {phase:pfPhase,firstFailure:null,attemptedSteps:0};
    },
    takeOwned0501FaultOutcome(token){
      assert.equal(token,faultToken);
      return pfPhase==='armed'?null:{phase:pfPhase,
        attemptedSteps:1,fault:{vector:14},delivery:{outcome:'returned'},
        frameReturnQualified:false};
    },
  };
  cpu.armOwned0501PostPfContinuation=(pf,mode,options)=>{
    assert.equal(pf,faultToken);assert.equal(mode,taskToken);
    assert.equal(options.maxActiveSteps,100_000);assert.equal(order.includes('task-take'),false);
    order.push('mint');postMinted=true;return Object.freeze({post:true});
  };
  cpu.owned0501PostPfContinuationStatus=()=>{if(statusThrows)throw new Error('synthetic status refusal');return {phase:postPhase,firstFailure:postPhase==='invalid'?'synthetic-source-refusal':null,attemptedSteps:postAttempts,committedSteps:postCommits};};
  cpu.abortOwned0501PostPfContinuation=()=>{order.push('post-abort');postPhase='invalid';};
  cpu.takeOwned0501PostPfContinuationObservation=()=>{if(drainThrows)throw new Error('synthetic drain refusal');postDrained=true;order.push('post-take');return {phase:postPhase,attemptedSteps:postAttempts,committedSteps:postCommits,frameReturnQualified:false};};
  for(const key of ['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cs','ds','es','ss','fs','gs','cr0','cr2','cr3','cr4','cycles','_interruptShadow','_nmiShadow','_debugShadow'])cpu[key]=0;
  for(const key of ['halted','shutdown','_nmiActive','_retainedRealCs'])cpu[key]=false;
  cpu.segmentCaches=Object.fromEntries(Array.from({length:6},(_,i)=>[i,{base:0,limit:65535}]));
  for(const key of ['gdtr','idtr','ldtr','tr'])cpu[key]={base:0,limit:0};
  cpu._repeatContext=null;cpu._translations=new Array(512);cpu._translationTablePages=new Set();cpu._debugRegisters=new Uint32Array(8);cpu.step=()=>1;
  const machine={cpu,mem:new Uint8Array(16<<20),_page:new Uint8Array(4096),config:{},chips:{},vgaMemory:null,
    cycles:0,_chipDebt:0,_chipDeadline:0,displayRevision:0,_nmiPending:false,_nmiMasked:false,_cpuResetPending:false,
    step(){stepCalls++;
    if(postMinted){postAttempts+=delta;postCommits+=delta===1?1:0;postPhase=delta===1?'candidate':'observing';postHook?.();return 1;}
    pfPhase='complete';
    task=machineThrows==='observing'?task:'invalid';
    if(machineThrows)throw new Error('synthetic ordinary step fault');}};
  const ports={machine,bind(){return {ownedCodeAtEntry:'PASS'};},
    step(){stepCalls++;frame=stepCalls===1?'open':'invalid';}};
  const observer=createPostPfConnectedOrchestration(ports,{cpu,
    opportunity:()=>({cs:11,comparison:{address:100,bytes:80},
      receipt:{sourceEip:100}}),progress:value=>{
      updates.push(value);onProgress?.(value,observer);
    }});
  return {observer,machine,ports,updates,order,cpu,setDelta(value){delta=value;},setPostHook(value){postHook=value;},setStatusThrows(){statusThrows=true;},setDrainThrows(){drainThrows=true;},get postDrained(){return postDrained;},get stepCalls(){return stepCalls;},
    get taskArmCalls(){return taskArmCalls;},
    get pfArmCalls(){return pfArmCalls;},
    setTransitionPresent(value){transitionPresent=value;},
    setPfPhase(value){pfPhase=value;}};
}

function armed(onProgress=null){
  const f=fixture('task-switch-during-owned-frame',onProgress);
  f.observer.ports.bind();f.observer.ports.step();
  assert.throws(()=>f.observer.ports.step(),/task-switch-during-owned-frame/);
  f.observer.armFaultAtStrictTerminal();
  f.observer.continue(f.machine,{now:()=>1});
  return f;
}
const good=armed();
assert.deepEqual(good.order.slice(0,2),['mint','task-take']);
assert.equal(good.observer.postTerminal().arm.admitted,true);
const result=good.observer.continuePost({now:()=>2});
assert.equal(result.receipt.boardCalls,1);assert.equal(result.receipt.cpuAttempts,1);
assert.equal(result.receipt.committedSteps,1);assert.equal(result.firstFailure,null);
assert.equal(result.frameReturnQualified,false);assert.equal(good.postDrained,true);
assert.throws(()=>good.observer.continuePost({now:()=>2}),/already consumed/);
for(const delta of [0,2]){
  const f=armed();f.setDelta(delta);const r=f.observer.continuePost({now:()=>3});
  assert.notEqual(r.firstFailure,null);assert.equal(r.receipt.boardCalls,1);
  if(delta===0)assert.equal(r.receipt.zeroAttemptCalls,1);
  assert.equal(f.postDrained,true);
}
const repeat=armed();repeat.cpu._repeatContext={cs:0,eip:0,flags:2};
assert.deepEqual(boundaryFingerprint(repeat.machine).repeatContext,{cs:0,eip:0,flags:2});
Object.defineProperty(repeat.cpu._repeatContext,'flags',{get(){throw new Error('accessor should not run');}});
assert.throws(()=>boundaryFingerprint(repeat.machine),/descriptor boundary/);
for(const change of [f=>{f.cpu.eip++;},f=>{f.ports.machine={cpu:f.cpu};},
    f=>{f.cpu.owned0501PostPfContinuationStatus=()=>({phase:'candidate'});},
    f=>{try{f.observer.continuePost({now:()=>3});}catch{}}]){
  const f=armed();let called=false;
  const r=f.observer.continuePost({now:()=>{if(!called){called=true;change(f);}return 3;}});
  assert.notEqual(r.firstFailure,null);assert.equal(r.receipt.boardCalls,0);
}
const backwards=armed();let clocks=0;
const back=backwards.observer.continuePost({now:()=>clocks++===0?3:2});
assert.notEqual(back.firstFailure,null);assert.equal(back.receipt.boardCalls,0);
const timeout=armed();let t=0;
const timed=timeout.observer.continuePost({now:()=>t++===0?1:120002});
assert.equal(timed.firstFailure,'observer-wall-bound');assert.equal(timed.receipt.boardCalls,0);
const late=armed((event,observer)=>{if(event.event==='task-mode-terminal'){
  try{observer.continuePost({now:()=>1});}catch{}
}});
const poisoned=late.observer.continuePost({now:()=>4});
assert.notEqual(poisoned.firstFailure,null);assert.equal(poisoned.receipt.boardCalls,0);
assert.equal(late.postDrained,true);
const counterFence=armed();counterFence.setPostHook(()=>{
 counterFence.cpu._repeatContext={cs:0,eip:0,flags:2};
 Object.defineProperty(counterFence.cpu._repeatContext,'flags',{get(){throw new Error('must not invoke');}});
});
const retained=counterFence.observer.continuePost({now:()=>5});
assert.notEqual(retained.firstFailure,null);assert.equal(retained.receipt.cpuAttempts,1);
assert.equal(retained.receipt.committedSteps,1);assert.equal(retained.receipt.pendingStep,null);
assert.equal(retained.receipt.boardCalls,1);assert.equal(counterFence.postDrained,true);
const missingStatus=armed();missingStatus.setPostHook(()=>missingStatus.setStatusThrows());
const partial=missingStatus.observer.continuePost({now:()=>6});
assert.notEqual(partial.firstFailure,null);assert.equal(partial.receipt.boardCalls,1);
assert.deepEqual(partial.receipt.pendingStep,{boardCall:1,beforeAttempts:0,beforeCommitted:0});
assert.equal(partial.receipt.cpuAttempts,0);assert.equal(partial.observation,null);
const failedDrain=armed();failedDrain.setDrainThrows();
const drained=failedDrain.observer.continuePost({now:()=>7});
assert.notEqual(drained.firstFailure,null);assert.equal(drained.receipt.cpuAttempts,1);
assert.equal(drained.status.phase,'candidate');assert.equal(drained.observation,null);
console.log('PASS post-PF connected orchestration synthetic controls only');
