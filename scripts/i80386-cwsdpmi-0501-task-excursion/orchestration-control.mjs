import assert from 'node:assert/strict';
import {createTaskOrchestration} from './orchestration.mjs';

function fixture(failure='task-switch-during-owned-frame') {
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
      return {phase:task,activeSteps:stepCalls-1,transitions:1};
    },
    abortOwned0501TaskExcursion(token,reason){
      assert.equal(token,taskToken);assert.match(reason,/^observer-/);
      task='invalid';
      return {phase:task,activeSteps:stepCalls-1,transitions:1,
        firstFailure:reason};
    },
    takeOwned0501TaskExcursionObservation(token){
      assert.equal(token,taskToken);
      return {phase:task,frameReturnQualified:false,
        transitions:[{step:2,enclosingStepCommitted:true}]};
    },
  };
  const machine={cpu,step(){stepCalls++;task='candidate';}};
  const ports={bind(){return {ownedCodeAtEntry:'PASS'};},
    step(){stepCalls++;frame=stepCalls===1?'open':'invalid';}};
  const observer=createTaskOrchestration(ports,{cpu,
    opportunity:()=>({cs:11,comparison:{address:100,bytes:80},
      receipt:{sourceEip:100}}),progress:value=>updates.push(value)});
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
  {now:()=>1,wallMs:0,maxSteps:0});
assert.equal(expired.status.phase,'invalid');
assert.equal(expired.firstFailure,'observer-step-bound');
assert.equal(expired.observation.transitions[0].enclosingStepCommitted,true);
assert.equal(bounded.stepCalls,2);

process.stdout.write('task orchestration controls PASS\n');
