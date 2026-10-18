import assert from 'node:assert/strict';
import {createTaskOrchestration} from './orchestration.mjs';

function fixture(failure='task-switch-during-owned-frame',onProgress=null,
    machineThrows=false,hasTransition=true) {
  const frameToken=Object.freeze({}),taskToken=Object.freeze({});
  let frame='armed',task='observing',stepCalls=0,taskArmCalls=0;
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
    armOwned0501TaskExcursion(token){
      assert.equal(token,frameToken);taskArmCalls++;return taskToken;
    },
    takeOwned0501FrameObservation(token){
      assert.equal(token,frameToken);
      return {phase:'invalid',failure,entry:{vector:49},returned:null};
    },
    owned0501TaskExcursionStatus(token){
      assert.equal(token,taskToken);
      return {phase:task,activeSteps:stepCalls-1,
        transitions:hasTransition?1:0};
    },
    abortOwned0501TaskExcursion(token,reason){
      assert.equal(token,taskToken);assert.match(reason,/^observer-/);
      task='invalid';
      return {phase:task,activeSteps:stepCalls-1,
        transitions:hasTransition?1:0,
        firstFailure:reason};
    },
    takeOwned0501TaskExcursionObservation(token){
      assert.equal(token,taskToken);
      return {phase:task,frameReturnQualified:false,
        transitions:hasTransition?[{step:2,enclosingStepCommitted:true}]:[]};
    },
  };
  const machine={cpu,step(){stepCalls++;
    task=machineThrows===true?'invalid':machineThrows==='observing'?task:'candidate';
    if(machineThrows)throw new Error('synthetic ordinary step fault');}};
  const ports={bind(){return {ownedCodeAtEntry:'PASS'};},
    step(){stepCalls++;frame=stepCalls===1?'open':'invalid';}};
  const observer=createTaskOrchestration(ports,{cpu,
    opportunity:()=>({cs:11,comparison:{address:100,bytes:80},
      receipt:{sourceEip:100}}),progress:value=>{
      updates.push(value);onProgress?.(value,observer);
    }});
  return {observer,machine,updates,get stepCalls(){return stepCalls;},
    get taskArmCalls(){return taskArmCalls;}};
}

const good=fixture();
good.observer.ports.bind();
good.observer.ports.step();
assert.equal(good.taskArmCalls,1);
assert.throws(()=>good.observer.ports.step(),/task-switch-during-owned-frame/);
assert.equal(good.observer.terminal().strict.returned,null);
const result=good.observer.continue(good.machine);
assert.equal(result.status.phase,'candidate');
assert.equal(result.committedOutgoing,true);
assert.equal(result.observation.frameReturnQualified,false);
assert.equal(good.stepCalls,3);
assert.deepEqual(good.updates.map(item=>item.event),[
  'frame-armed','task-armed','strict-terminal','task-continuing','task-terminal']);

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
const expired=bounded.observer.continue(bounded.machine,
  {now:()=>1,wallMs:1,maxSteps:0});
assert.equal(expired.status.phase,'invalid');
assert.equal(expired.firstFailure,'observer-step-bound');
assert.equal(expired.observation.transitions[0].enclosingStepCommitted,true);
assert.equal(bounded.stepCalls,2);

const reentered=fixture('task-switch-during-owned-frame',(value,observer)=>{
  if(value.event==='task-continuing')
    assert.throws(()=>observer.ports.step(),/task port reentry/);
});
reentered.observer.ports.bind();reentered.observer.ports.step();
assert.throws(()=>reentered.observer.ports.step(),/task-switch-during-owned-frame/);
const poisoned=reentered.observer.continue(reentered.machine);
assert.equal(poisoned.firstFailure,'observer-port-reentry');
assert.equal(poisoned.status.phase,'invalid');
assert.equal(poisoned.observation.frameReturnQualified,false);
assert.equal(reentered.stepCalls,3);

const clockReentry=fixture();
clockReentry.observer.ports.bind();clockReentry.observer.ports.step();
assert.throws(()=>clockReentry.observer.ports.step(),/task-switch-during-owned-frame/);
const clockReceipt=clockReentry.observer.continue(clockReentry.machine,
  {now:()=>{
    assert.throws(()=>clockReentry.observer.ports.step(),/task port reentry/);
    return 0;
  }});
assert.equal(clockReceipt.firstFailure,'observer-port-reentry');
assert.equal(clockReentry.stepCalls,2);

const thrown=fixture('task-switch-during-owned-frame',null,true);
thrown.observer.ports.bind();thrown.observer.ports.step();
assert.throws(()=>thrown.observer.ports.step(),/task-switch-during-owned-frame/);
const retained=thrown.observer.continue(thrown.machine);
assert.equal(retained.firstFailure,'observer-machine-step-exception');
assert.equal(retained.status.phase,'invalid');
assert.equal(retained.observation.transitions[0].enclosingStepCommitted,true);
assert.equal(thrown.stepCalls,3);

const thrownOpen=fixture('task-switch-during-owned-frame',null,'observing');
thrownOpen.observer.ports.bind();thrownOpen.observer.ports.step();
assert.throws(()=>thrownOpen.observer.ports.step(),/task-switch-during-owned-frame/);
const aborted=thrownOpen.observer.continue(thrownOpen.machine);
assert.equal(aborted.firstFailure,'observer-machine-step-exception');
assert.equal(aborted.observation.phase,'invalid');
assert.equal(thrownOpen.stepCalls,3);

const missingTransition=fixture('task-switch-during-owned-frame',null,false,false);
missingTransition.observer.ports.bind();missingTransition.observer.ports.step();
assert.throws(()=>missingTransition.observer.ports.step(),
  /task-switch-during-owned-frame/);
const refused=missingTransition.observer.continue(missingTransition.machine);
assert.equal(refused.committedOutgoing,false);
assert.equal(refused.firstFailure,'committed outgoing task transition absent');
assert.equal(missingTransition.stepCalls,2);

const timed=fixture();
timed.observer.ports.bind();timed.observer.ports.step();
assert.throws(()=>timed.observer.ports.step(),/task-switch-during-owned-frame/);
let tick=0;
const wall=timed.observer.continue(timed.machine,
  {now:()=>tick++*2,wallMs:1});
assert.equal(wall.firstFailure,'observer-wall-bound');
assert.equal(wall.observation.phase,'invalid');
assert.equal(timed.stepCalls,2);

const owner=fixture();
owner.observer.ports.bind();owner.observer.ports.step();
assert.throws(()=>owner.observer.ports.step(),/task-switch-during-owned-frame/);
owner.machine.cpu={};
const ownerReceipt=owner.observer.continue(owner.machine);
assert.equal(ownerReceipt.firstFailure,'observer-owner-change');
assert.equal(ownerReceipt.observation.phase,'invalid');
assert.equal(owner.stepCalls,2);

const invalidBound=fixture();
invalidBound.observer.ports.bind();invalidBound.observer.ports.step();
assert.throws(()=>invalidBound.observer.ports.step(),
  /task-switch-during-owned-frame/);
assert.throws(()=>invalidBound.observer.continue(invalidBound.machine,
  {maxSteps:100_001}),/continuation bound/);
assert.equal(invalidBound.stepCalls,2);

const backward=fixture();
backward.observer.ports.bind();backward.observer.ports.step();
assert.throws(()=>backward.observer.ports.step(),
  /task-switch-during-owned-frame/);
let clock=2;
const backwardReceipt=backward.observer.continue(backward.machine,
  {now:()=>clock--});
assert.equal(backwardReceipt.firstFailure,'observer-wall-bound');
assert.equal(backward.stepCalls,2);

const finalReentry=fixture('task-switch-during-owned-frame',(value,observer)=>{
  if(value.event==='task-terminal')
    assert.throws(()=>observer.ports.step(),/task port reentry/);
});
finalReentry.observer.ports.bind();finalReentry.observer.ports.step();
assert.throws(()=>finalReentry.observer.ports.step(),
  /task-switch-during-owned-frame/);
const terminalReceipt=finalReentry.observer.continue(finalReentry.machine);
assert.equal(terminalReceipt.firstFailure,'observer-port-reentry');
assert.equal(terminalReceipt.observation.phase,'candidate');
assert.equal(terminalReceipt.observation.frameReturnQualified,false);
assert.equal(finalReentry.stepCalls,3);

process.stdout.write('task orchestration controls PASS\n');
