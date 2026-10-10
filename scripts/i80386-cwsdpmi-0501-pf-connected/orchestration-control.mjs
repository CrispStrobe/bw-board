import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createPfConnectedOrchestration,sourceBoundPfStepMonitor}
  from './orchestration.mjs';

function stepMonitorFixture(delta,{throwValue=null,throws=false}={}){
  let attempts=0;
  const cpu={owned0501FaultOutcomeStatus:()=>({phase:'armed',
    attemptedSteps:attempts})};
  const machine={cpu,step(){attempts+=delta;
    if(throws)throw throwValue;
    return 1;}};
  return sourceBoundPfStepMonitor(machine,cpu,Object.freeze({}));
}
const oneStep=stepMonitorFixture(1);
assert.equal(oneStep.machine.step(),1);
assert.deepEqual(oneStep.receipt,{boardCalls:1,cpuAttempts:1,
  oneToOne:true,firstFailure:null});
for(const delta of [0,2]){
  const denied=stepMonitorFixture(delta);
  assert.throws(()=>denied.machine.step(),/one PF CPU attempt/);
  assert.equal(denied.receipt.oneToOne,false);
  assert.equal(denied.receipt.boardCalls,1);
  assert.equal(denied.receipt.cpuAttempts,0);
}
const thrownNull=stepMonitorFixture(1,{throws:true,throwValue:null});
try{thrownNull.machine.step();assert.fail('null throw was lost');}
catch(value){assert.equal(value,null);}
assert.equal(thrownNull.receipt.boardCalls,1);
assert.equal(thrownNull.receipt.cpuAttempts,1);

function fixture(failure='task-switch-during-owned-frame',onProgress=null,
    machineThrows=false,hasTransition=true) {
  const frameToken=Object.freeze({}),taskToken=Object.freeze({});
  const faultToken=Object.freeze({});
  let frame='armed',task='observing',stepCalls=0,taskArmCalls=0;
  let transitionPresent=hasTransition;
  let pfArmCalls=0,pfPhase='armed';
  const updates=[];
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
      assert.equal(token,taskToken);
      if(task==='observing')return null;
      return {phase:task,frameReturnQualified:false,
        activeSteps:stepCalls-1,postOutgoingSteps:Math.max(0,stepCalls-2),
        modeChanges:stepCalls>2?[{step:stepCalls-1,operation:'mov-cr0'}]:[],
        transitions:transitionPresent?[{step:2,enclosingStepCommitted:true}]:[]};
    },
    armOwned0501FaultOutcome(options){
      assert.equal(options.maxActiveSteps,100_000);
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
  const machine={cpu,step(){stepCalls++;
    task=machineThrows===true?'invalid':machineThrows==='observing'?task:'candidate';
    if(machineThrows)throw new Error('synthetic ordinary step fault');}};
  const ports={bind(){return {ownedCodeAtEntry:'PASS'};},
    step(){stepCalls++;frame=stepCalls===1?'open':'invalid';}};
  const observer=createPfConnectedOrchestration(ports,{cpu,
    opportunity:()=>({cs:11,comparison:{address:100,bytes:80},
      receipt:{sourceEip:100}}),progress:value=>{
      updates.push(value);onProgress?.(value,observer);
    }});
  return {observer,machine,updates,get stepCalls(){return stepCalls;},
    get taskArmCalls(){return taskArmCalls;},
    get pfArmCalls(){return pfArmCalls;},
    setTransitionPresent(value){transitionPresent=value;},
    setPfPhase(value){pfPhase=value;}};
}

const continueArmed=(f,options)=>{
  f.observer.armFaultAtStrictTerminal();
  return f.observer.continue(f.machine,options);
};

const good=fixture();
good.observer.ports.bind();
good.observer.ports.step();
assert.equal(good.taskArmCalls,1);
assert.throws(()=>good.observer.ports.step(),/task-switch-during-owned-frame/);
assert.equal(good.observer.terminal().strict.returned,null);
const result=continueArmed(good);
assert.equal(result.status.phase,'candidate');
assert.equal(result.committedOutgoing,true);
assert.equal(result.observation.frameReturnQualified,false);
assert.equal(good.stepCalls,3);
assert.deepEqual(good.updates.map(item=>item.event),[
  'frame-armed','task-mode-armed','strict-terminal','task-mode-continuing','task-mode-terminal']);

const pfArmed=fixture();
assert.throws(()=>pfArmed.observer.armFaultAtStrictTerminal(),/strict/);
assert.equal(pfArmed.pfArmCalls,0);
pfArmed.observer.ports.bind();pfArmed.observer.ports.step();
assert.throws(()=>pfArmed.observer.armFaultAtStrictTerminal(),/strict/);
assert.throws(()=>pfArmed.observer.ports.step(),/task-switch-during-owned-frame/);
assert.throws(()=>pfArmed.observer.continue(pfArmed.machine),/requires PF arm/);
assert.equal(pfArmed.stepCalls,2);
const lease=pfArmed.observer.armFaultAtStrictTerminal();
assert.equal(lease.modeAtArm.activeSteps,1);
assert.equal(lease.modeAtArm.postOutgoingSteps,0);
assert.equal(lease.preContinuationMachineSteps,2);
assert.equal(pfArmed.pfArmCalls,1);
assert.throws(()=>pfArmed.observer.armFaultAtStrictTerminal(),/already attempted/);
assert.equal(pfArmed.stepCalls,2);

const changedEntry=fixture();
changedEntry.observer.ports.bind();changedEntry.observer.ports.step();
assert.throws(()=>changedEntry.observer.ports.step(),
  /task-switch-during-owned-frame/);
changedEntry.observer.terminal().strict.entry.entryAx=1282;
assert.throws(()=>changedEntry.observer.armFaultAtStrictTerminal(),
  /strict|AX=0501/);
assert.equal(changedEntry.pfArmCalls,0);
assert.equal(changedEntry.stepCalls,2);

const snapshotRefused=fixture();
snapshotRefused.observer.ports.bind();snapshotRefused.observer.ports.step();
const originalTake=snapshotRefused.machine.cpu.takeOwned0501FrameObservation;
snapshotRefused.machine.cpu.takeOwned0501FrameObservation=token=>{
  const value=originalTake(token);
  return {...value,entry:new Proxy(value.entry,{
    getPrototypeOf(){throw new Error('observer reflection trap');}})};
};
assert.throws(()=>snapshotRefused.observer.ports.step(),
  /task-switch-during-owned-frame/);
assert.equal(snapshotRefused.observer.terminal().firstFailure,
  'task-switch-during-owned-frame');
assert.equal(snapshotRefused.observer.terminal().diagnosticFailure,
  'strict entry snapshot unavailable');
assert.equal(snapshotRefused.observer.terminal().strict.returned,null);
assert.throws(()=>snapshotRefused.observer.armFaultAtStrictTerminal(),
  /strict|AX=0501/);
assert.equal(snapshotRefused.stepCalls,2);
assert.equal(snapshotRefused.pfArmCalls,0);

const accessorRefused=fixture();
accessorRefused.observer.ports.bind();accessorRefused.observer.ports.step();
let accessorReads=0;
const accessorTake=accessorRefused.machine.cpu.takeOwned0501FrameObservation;
accessorRefused.machine.cpu.takeOwned0501FrameObservation=token=>{
  const value=accessorTake(token);
  Object.defineProperty(value.entry,'entryAx',{configurable:true,
    get(){accessorReads++;throw new Error('untrusted entry getter');}});
  return value;
};
assert.throws(()=>accessorRefused.observer.ports.step(),
  /task-switch-during-owned-frame/);
assert.equal(accessorRefused.observer.terminal().firstFailure,
  'task-switch-during-owned-frame');
assert.equal(accessorRefused.observer.terminal().diagnosticFailure,
  'strict entry snapshot unavailable');
assert.throws(()=>accessorRefused.observer.armFaultAtStrictTerminal(),
  /snapshot unavailable/);
assert.equal(accessorReads,0);
assert.equal(accessorRefused.stepCalls,2);
assert.equal(accessorRefused.pfArmCalls,0);

const poisonedAfterArm=fixture();
poisonedAfterArm.observer.ports.bind();poisonedAfterArm.observer.ports.step();
assert.throws(()=>poisonedAfterArm.observer.ports.step(),
  /task-switch-during-owned-frame/);
const actualArm=poisonedAfterArm.machine.cpu.armOwned0501FaultOutcome;
poisonedAfterArm.machine.cpu.armOwned0501FaultOutcome=options=>{
  const token=actualArm(options);
  assert.throws(()=>poisonedAfterArm.observer.ports.step(),/reentry/);
  return token;
};
assert.throws(()=>poisonedAfterArm.observer.armFaultAtStrictTerminal(),/reentry/);
assert.equal(poisonedAfterArm.pfArmCalls,1);
assert.ok(poisonedAfterArm.observer.faultTerminal().token);
assert.throws(()=>poisonedAfterArm.observer.continue(poisonedAfterArm.machine),
  /reentry/);
assert.equal(poisonedAfterArm.stepCalls,2);

const noOutgoing=fixture('task-switch-during-owned-frame',null,false,false);
noOutgoing.observer.ports.bind();noOutgoing.observer.ports.step();
assert.throws(()=>noOutgoing.observer.ports.step(),/task-switch-during-owned-frame/);
assert.throws(()=>noOutgoing.observer.armFaultAtStrictTerminal(),/committed outgoing/);
assert.equal(noOutgoing.pfArmCalls,0);
assert.equal(noOutgoing.stepCalls,2);

const pfRejected=fixture();
pfRejected.observer.ports.bind();pfRejected.observer.ports.step();
assert.throws(()=>pfRejected.observer.ports.step(),/task-switch-during-owned-frame/);
pfRejected.machine.cpu.armOwned0501FaultOutcome=()=>null;
assert.throws(()=>pfRejected.observer.armFaultAtStrictTerminal(),/PF arm refused/);
assert.throws(()=>pfRejected.observer.armFaultAtStrictTerminal(),/already attempted/);
assert.equal(pfRejected.stepCalls,2);

const swallowed=fixture();
swallowed.observer.ports.bind();swallowed.observer.ports.step();
assert.throws(()=>swallowed.observer.ports.step(),/task-switch-during-owned-frame/);
swallowed.machine.cpu.owned0501TaskModeStatus=()=>{
  assert.throws(()=>swallowed.observer.armFaultAtStrictTerminal(),/reentry/);
  return {phase:'observing',activeSteps:1,postOutgoingSteps:0,transitions:1};
};
assert.throws(()=>swallowed.observer.armFaultAtStrictTerminal(),/reentry/);
assert.equal(swallowed.pfArmCalls,0);
assert.equal(swallowed.stepCalls,2);

const other=fixture('different-strict-failure');
other.observer.ports.bind();other.observer.ports.step();
assert.throws(()=>other.observer.ports.step(),/different-strict-failure/);
assert.throws(()=>other.observer.continue(other.machine),/strict refusal/);
assert.equal(other.stepCalls,2);

const missing=fixture();
assert.throws(()=>missing.observer.continue(missing.machine),/strict refusal/);
assert.equal(missing.stepCalls,0);

const bounded=fixture();
bounded.observer.ports.bind();bounded.observer.ports.step();
assert.throws(()=>bounded.observer.ports.step(),/task-switch-during-owned-frame/);
const expired=continueArmed(bounded,
  {now:()=>1,wallMs:1,maxSteps:0});
assert.equal(expired.status.phase,'invalid');
assert.equal(expired.firstFailure,'observer-step-bound');
assert.equal(expired.observation.transitions[0].enclosingStepCommitted,true);
assert.equal(expired.lastPolledStatus.activeSteps,1);
assert.equal(expired.lastPolledStatus.postOutgoingSteps,0);
assert.equal(bounded.stepCalls,2);

const reentered=fixture('task-switch-during-owned-frame',(value,observer)=>{
  if(value.event==='task-mode-continuing')
    assert.throws(()=>observer.ports.step(),/task mode port reentry/);
});
reentered.observer.ports.bind();reentered.observer.ports.step();
assert.throws(()=>reentered.observer.ports.step(),/task-switch-during-owned-frame/);
const poisoned=continueArmed(reentered);
assert.equal(poisoned.firstFailure,'observer-port-reentry');
assert.equal(poisoned.status.phase,'invalid');
assert.equal(poisoned.observation.frameReturnQualified,false);
assert.equal(reentered.stepCalls,3);

const clockReentry=fixture();
clockReentry.observer.ports.bind();clockReentry.observer.ports.step();
assert.throws(()=>clockReentry.observer.ports.step(),/task-switch-during-owned-frame/);
const clockReceipt=continueArmed(clockReentry,
  {now:()=>{
    assert.throws(()=>clockReentry.observer.ports.step(),/task mode port reentry/);
    return 0;
  }});
assert.equal(clockReceipt.firstFailure,'observer-port-reentry');
assert.equal(clockReentry.stepCalls,2);

const thrown=fixture('task-switch-during-owned-frame',null,true);
thrown.observer.ports.bind();thrown.observer.ports.step();
assert.throws(()=>thrown.observer.ports.step(),/task-switch-during-owned-frame/);
const retained=continueArmed(thrown);
assert.equal(retained.firstFailure,'observer-machine-step-exception');
assert.equal(retained.status.phase,'invalid');
assert.equal(retained.observation.transitions[0].enclosingStepCommitted,true);
assert.equal(thrown.stepCalls,3);

const thrownOpen=fixture('task-switch-during-owned-frame',null,'observing');
thrownOpen.observer.ports.bind();thrownOpen.observer.ports.step();
assert.throws(()=>thrownOpen.observer.ports.step(),/task-switch-during-owned-frame/);
const aborted=continueArmed(thrownOpen);
assert.equal(aborted.firstFailure,'observer-machine-step-exception');
assert.equal(aborted.observation.phase,'invalid');
assert.equal(thrownOpen.stepCalls,3);

const missingTransition=fixture();
missingTransition.observer.ports.bind();missingTransition.observer.ports.step();
assert.throws(()=>missingTransition.observer.ports.step(),
  /task-switch-during-owned-frame/);
missingTransition.observer.armFaultAtStrictTerminal();
missingTransition.setTransitionPresent(false);
const refused=missingTransition.observer.continue(missingTransition.machine);
assert.equal(refused.committedOutgoing,false);
assert.equal(refused.firstFailure,'committed outgoing task transition absent');
assert.equal(missingTransition.stepCalls,2);

const missingAbortFault=fixture();
missingAbortFault.observer.ports.bind();missingAbortFault.observer.ports.step();
assert.throws(()=>missingAbortFault.observer.ports.step(),
  /task-switch-during-owned-frame/);
missingAbortFault.observer.armFaultAtStrictTerminal();
missingAbortFault.setTransitionPresent(false);
missingAbortFault.machine.cpu.abortOwned0501TaskMode=()=>{
  throw new Error('synthetic abort refusal');
};
const missingAbortReceipt=missingAbortFault.observer.continue(missingAbortFault.machine);
assert.equal(missingAbortReceipt.firstFailure,
  'committed outgoing task transition absent');
assert.equal(missingAbortReceipt.status.phase,'observing');
assert.equal(missingAbortReceipt.observation,null);
assert.equal(missingAbortReceipt.committedOutgoing,false);
assert.equal(missingAbortFault.observer.terminal().modeResult,missingAbortReceipt);
assert.equal(missingAbortFault.stepCalls,2);

const contradictory=fixture();
contradictory.observer.ports.bind();contradictory.observer.ports.step();
assert.throws(()=>contradictory.observer.ports.step(),
  /task-switch-during-owned-frame/);
contradictory.observer.armFaultAtStrictTerminal();
contradictory.setTransitionPresent(false);
contradictory.machine.cpu.takeOwned0501TaskModeObservation=()=>({
  phase:'invalid',transitions:[{step:2,enclosingStepCommitted:true}]});
const contradictoryReceipt=contradictory.observer.continue(contradictory.machine);
assert.equal(contradictoryReceipt.committedOutgoing,false);
assert.equal(contradictory.stepCalls,2);

const badStart=fixture();
badStart.observer.ports.bind();badStart.observer.ports.step();
assert.throws(()=>badStart.observer.ports.step(),/task-switch-during-owned-frame/);
badStart.machine.cpu.abortOwned0501TaskMode=()=>{
  throw new Error('synthetic abort refusal');
};
const badStartReceipt=continueArmed(badStart,{now:()=>-1});
assert.equal(badStartReceipt.firstFailure,'observer-wall-bound');
assert.equal(badStartReceipt.status.phase,'observing');
assert.equal(badStart.stepCalls,2);

const badStartNoop=fixture();
badStartNoop.observer.ports.bind();badStartNoop.observer.ports.step();
assert.throws(()=>badStartNoop.observer.ports.step(),
  /task-switch-during-owned-frame/);
badStartNoop.machine.cpu.abortOwned0501TaskMode=()=>({phase:'observing'});
const badStartNoopReceipt=continueArmed(badStartNoop,
  {now:()=>Number.NaN});
assert.equal(badStartNoopReceipt.firstFailure,'observer-wall-bound');
assert.equal(badStartNoopReceipt.status.phase,'observing');
assert.equal(badStartNoop.stepCalls,2);

const timed=fixture();
timed.observer.ports.bind();timed.observer.ports.step();
assert.throws(()=>timed.observer.ports.step(),/task-switch-during-owned-frame/);
let tick=0;
const wall=continueArmed(timed,
  {now:()=>tick++*2,wallMs:1});
assert.equal(wall.firstFailure,'observer-wall-bound');
assert.equal(wall.observation.phase,'invalid');
assert.equal(timed.stepCalls,2);

const owner=fixture();
owner.observer.ports.bind();owner.observer.ports.step();
assert.throws(()=>owner.observer.ports.step(),/task-switch-during-owned-frame/);
owner.machine.cpu={};
const ownerReceipt=continueArmed(owner);
assert.equal(ownerReceipt.firstFailure,'observer-owner-change');
assert.equal(ownerReceipt.observation.phase,'invalid');
assert.equal(owner.stepCalls,2);

const invalidBound=fixture();
invalidBound.observer.ports.bind();invalidBound.observer.ports.step();
assert.throws(()=>invalidBound.observer.ports.step(),
  /task-switch-during-owned-frame/);
assert.throws(()=>continueArmed(invalidBound,
  {maxSteps:100_001}),/continuation bound/);
assert.equal(invalidBound.stepCalls,2);

const backward=fixture();
backward.observer.ports.bind();backward.observer.ports.step();
assert.throws(()=>backward.observer.ports.step(),
  /task-switch-during-owned-frame/);
let clock=2;
const backwardReceipt=continueArmed(backward,
  {now:()=>clock--});
assert.equal(backwardReceipt.firstFailure,'observer-wall-bound');
assert.equal(backward.stepCalls,2);

const finalReentry=fixture('task-switch-during-owned-frame',(value,observer)=>{
  if(value.event==='task-mode-terminal')
    assert.throws(()=>observer.ports.step(),/task mode port reentry/);
});
finalReentry.observer.ports.bind();finalReentry.observer.ports.step();
assert.throws(()=>finalReentry.observer.ports.step(),
  /task-switch-during-owned-frame/);
const terminalReceipt=continueArmed(finalReentry);
assert.equal(terminalReceipt.firstFailure,'observer-port-reentry');
assert.equal(terminalReceipt.observation.phase,'candidate');
assert.equal(terminalReceipt.observation.frameReturnQualified,false);
assert.equal(finalReentry.stepCalls,3);

const oldApi=fixture();
oldApi.machine.cpu.armOwned0501TaskExcursion=()=>{
  throw new Error('old task API must not be used');
};
oldApi.observer.ports.bind();oldApi.observer.ports.step();
assert.throws(()=>oldApi.observer.ports.step(),/task-switch-during-owned-frame/);
assert.equal(continueArmed(oldApi).observation.modeChanges.length,1);

const statusFault=fixture();
statusFault.observer.ports.bind();statusFault.observer.ports.step();
assert.throws(()=>statusFault.observer.ports.step(),/task-switch-during-owned-frame/);
statusFault.observer.armFaultAtStrictTerminal();
statusFault.machine.cpu.owned0501TaskModeStatus=()=>{throw new Error('status failure');};
const statusReceipt=statusFault.observer.continue(statusFault.machine);
assert.equal(statusReceipt.firstFailure,'observer-status-failure');
assert.equal(statusReceipt.observation.phase,'invalid');
assert.equal(statusFault.stepCalls,2);

const abortFault=fixture();
abortFault.observer.ports.bind();abortFault.observer.ports.step();
assert.throws(()=>abortFault.observer.ports.step(),/task-switch-during-owned-frame/);
abortFault.machine.cpu.abortOwned0501TaskMode=()=>{throw new Error('abort failure');};
const abortReceipt=continueArmed(abortFault,{maxSteps:0});
assert.equal(abortReceipt.firstFailure,'observer-step-bound');
assert.equal(abortReceipt.observation,null);
assert.equal(abortFault.stepCalls,2);

const takeFault=fixture();
takeFault.observer.ports.bind();takeFault.observer.ports.step();
assert.throws(()=>takeFault.observer.ports.step(),/task-switch-during-owned-frame/);
takeFault.machine.cpu.takeOwned0501TaskModeObservation=()=>{throw new Error('take failure');};
const takeReceipt=continueArmed(takeFault);
assert.equal(takeReceipt.firstFailure,'observer-take-failure');
assert.equal(takeReceipt.observation,null);
assert.equal(takeFault.stepCalls,3);

const progressFault=fixture('task-switch-during-owned-frame',value=>{
  if(value.event==='task-mode-continuing')throw new Error('progress failure');
});
progressFault.observer.ports.bind();progressFault.observer.ports.step();
assert.throws(()=>progressFault.observer.ports.step(),/task-switch-during-owned-frame/);
const progressReceipt=continueArmed(progressFault);
assert.equal(progressReceipt.firstFailure,'observer-progress-failure');
assert.equal(progressReceipt.observation.phase,'invalid');
assert.equal(progressFault.stepCalls,3);

const terminalProgressFault=fixture('task-switch-during-owned-frame',value=>{
  if(value.event==='task-mode-terminal')throw new Error('terminal progress failure');
});
terminalProgressFault.observer.ports.bind();terminalProgressFault.observer.ports.step();
assert.throws(()=>terminalProgressFault.observer.ports.step(),/task-switch-during-owned-frame/);
const terminalProgressReceipt=continueArmed(terminalProgressFault);
assert.equal(terminalProgressReceipt.firstFailure,'observer-progress-failure');
assert.equal(terminalProgressFault.observer.terminal().modeResult,
  terminalProgressReceipt);
assert.equal(terminalProgressReceipt.observation.phase,'candidate');

const noRetry=fixture();
noRetry.observer.ports.bind();noRetry.observer.ports.step();
assert.throws(()=>noRetry.observer.ports.step(),/task-switch-during-owned-frame/);
continueArmed(noRetry,{maxSteps:0});
assert.throws(()=>noRetry.observer.continue(noRetry.machine),/already consumed/);
assert.equal(noRetry.stepCalls,2);

// Extract this pure admission function from the actual adapter source. Do not
// import the adapter: its static imports load the emulator and guest helpers.
const adapterSource=fs.readFileSync(new URL('./adapter.mjs',import.meta.url),'utf8');
const exactStart=adapterSource.indexOf('function exact(');
const exactEnd=adapterSource.indexOf('\nconst json=',exactStart);
assert.ok(exactStart>=0&&exactEnd>exactStart);
const exactBody=adapterSource.slice(exactStart,exactEnd);
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const exactWith=io=>new Function('fs','sha',`${exactBody}\nreturn exact;`)(io,sha);
const temp=fs.mkdtempSync(path.join(process.env.TMPDIR??os.tmpdir(),
  'owned-task-mode-input-'));
try{
  const file=path.join(temp,'input'),replacement=path.join(temp,'replacement');
  const bytes=Buffer.from('owned input');
  fs.writeFileSync(file,bytes);
  assert.deepEqual(exactWith(fs)(file,100,
    {bytes:bytes.length,sha256:sha(bytes)}),bytes);
  const link=path.join(temp,'link');fs.symlinkSync(file,link);
  assert.throws(()=>exactWith(fs)(link,100),/private input shape/);
  const fifo=path.join(temp,'fifo');
  execFileSync('mkfifo',[fifo],{timeout:1000});
  assert.throws(()=>exactWith(fs)(fifo,100),/private input shape/);
  fs.writeFileSync(replacement,bytes);
  const beforeOpen=new Proxy(fs,{get(target,key){
    if(key==='openSync')return (name,flags)=>{
      fs.renameSync(replacement,name);return fs.openSync(name,flags);
    };
    return target[key];
  }});
  assert.throws(()=>exactWith(beforeOpen)(file,100),/private input shape/);
  fs.writeFileSync(replacement,bytes);
  let changed=false;
  const afterRead=new Proxy(fs,{get(target,key){
    if(key==='readSync')return (...args)=>{
      const count=fs.readSync(...args);
      if(!changed){changed=true;fs.renameSync(replacement,file);}
      return count;
    };
    return target[key];
  }});
  assert.throws(()=>exactWith(afterRead)(file,100),
    /private input changed during read/);
  changed=false;
  const growAfterRead=new Proxy(fs,{get(target,key){
    if(key==='readSync')return (...args)=>{
      const count=fs.readSync(...args);
      if(!changed){changed=true;fs.appendFileSync(file,'x');}
      return count;
    };
    return target[key];
  }});
  assert.throws(()=>exactWith(growAfterRead)(file,100),
    /private input changed during read/);
}finally{fs.rmSync(temp,{recursive:true,force:true});}

process.stdout.write('task mode orchestration controls PASS\n');
