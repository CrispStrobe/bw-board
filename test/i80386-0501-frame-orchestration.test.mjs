import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameOrchestration,guardObservation} from '../scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs';

const comparison=Object.freeze({schema:'bw.cwsdpmi-0501.wrapper-comparison.v1',
  address:0x5700,bytes:0x30});
function fixture() {
  const calls=[];
  let phase='armed',observe=null;
  const policy={
    arm(options){calls.push('arm');assert.equal(options.comparison,comparison);
      return {phase:'armed'};},
    afterStep(){calls.push('poll');return {phase};},
    status(){return {phase};},
    finish({clientPassed,diagnostic}){calls.push('grade');
      assert.equal(clientPassed,true);assert.equal(diagnostic.address,0x4a0000);
      return {phase:phase==='complete'?'passed':'invalid',firstFailure:'missing pair'};},
  };
  const ports={bind(){calls.push('bind');return {ownedCodeAtEntry:'PASS'};},
    step(){calls.push('machine-step');}};
  const frame=createFrameOrchestration(ports,{policy,opportunity(){
    calls.push('observe');return observe;
  }});
  return {frame,calls,setOpportunity(value){observe=value;},setPhase(value){phase=value;}};
}
test('no pre-main arm and CPU poll follows ordinary step',()=>{
  const f=fixture();
  f.frame.ports.step();assert.deepEqual(f.calls,['machine-step']);
  f.frame.ports.bind();f.setOpportunity({comparison,cs:0xa7,
    receipt:{sourceCs:0xa7,sourceEip:0x5700}});
  f.frame.ports.step();
  assert.deepEqual(f.calls,['machine-step','bind','observe','arm','machine-step','poll']);
  f.setPhase('complete');f.frame.ports.step();
  assert.deepEqual(f.calls.slice(-2),['machine-step','poll']);
  const result=f.frame.finish({passed:true,returnDiagnostic:{address:0x4a0000}});
  assert.equal(result.passed,true);assert.equal(result.frame0501.phase,'passed');
  assert.equal(result.finiteClientPassed,true);
  assert.equal(result.frame0501.wrapper.sourceEip,0x5700);
});
test('successful client without pair fails and retains original earlier failure',()=>{
  const f=fixture();
  const report=f.frame.finish({passed:true,firstFailure:null,
    returnDiagnostic:{address:0x4a0000}});
  assert.equal(report.passed,false);
  assert.equal(report.firstFailure,'missing pair');
  assert.equal(report.finiteClientPassed,true);
  const g=fixture();
  const prior=g.frame.finish({passed:false,firstFailure:'disk first failure'});
  assert.equal(prior.firstFailure,'disk first failure');
});
test('invalid journal stops after original machine step; no second attempt',()=>{
  const f=fixture();f.frame.ports.bind();
  f.setOpportunity({comparison,cs:0xa7});f.setPhase('invalid');
  assert.throws(()=>f.frame.ports.step(),/journal invalid/);
  const report=f.frame.finish({passed:false,firstFailure:'journal invalid'});
  assert.equal(report.passed,false);
  assert.equal(report.firstFailure,'journal invalid');
  assert.deepEqual(f.calls,['bind','observe','arm','machine-step','poll']);
});
test('observer refusal happens before step and cannot be retried',()=>{
  const calls=[];
  const ports={bind(){return {ownedCodeAtEntry:'PASS'};},
    step(){calls.push('machine-step');}};
  const policy={arm(){throw new Error('must not arm');},
    afterStep(){throw new Error('must not poll');},
    finish(){throw new Error('must not finish');},status(){return {phase:'waiting'};}};
  let observations=0;
  const f=createFrameOrchestration(ports,{policy,opportunity(){
    observations++;throw new Error('passive refusal');}});
  f.ports.bind();
  assert.throws(()=>f.ports.step(),/passive refusal/);
  assert.throws(()=>f.ports.step(),/wrapper opportunity exception/);
  assert.equal(observations,1);assert.deepEqual(calls,[]);
});
test('swallowed nested observation poisons the outer receipt and future calls',()=>{
  let observed;
  observed=guardObservation(()=>{
    try{observed();}catch{}
    return {comparison};
  });
  assert.throws(()=>observed(),/swallowed wrapper observer reentry/);
  assert.throws(()=>observed(),/reentered\/failed/);
});
test('CPU arm exception is terminal even if caller catches and retries',()=>{
  let armCalls=0,steps=0;
  const ports={bind:()=>({ownedCodeAtEntry:'PASS'}),step:()=>{steps++;}};
  const policy={arm(){armCalls++;throw new Error('CPU refused');},
    afterStep(){throw new Error('unexpected poll');},
    finish(){throw new Error('unexpected finish');},status(){return {phase:'waiting'};}};
  const frame=createFrameOrchestration(ports,{policy,
    opportunity:()=>({comparison,cs:0xa7})});
  frame.ports.bind();
  assert.throws(()=>frame.ports.step(),/CPU refused/);
  assert.throws(()=>frame.ports.step(),/journal arm exception/);
  assert.deepEqual([armCalls,steps],[1,0]);
});
test('swallowed nested port step cannot publish a successful outer step',()=>{
  let frame,steps=0;
  const ports={bind:()=>({ownedCodeAtEntry:'PASS'}),step(){
    steps++;
    try{frame.ports.step();}catch{}
  }};
  const policy={arm(){throw new Error('must not arm');},
    afterStep(){throw new Error('must not poll');},
    finish(){throw new Error('must not finish');},status(){return {phase:'waiting'};}};
  frame=createFrameOrchestration(ports,{policy,opportunity:()=>null});
  assert.throws(()=>frame.ports.step(),/frame port reentry/);
  assert.equal(steps,1);
  assert.throws(()=>frame.ports.step(),/frame port reentry/);
  assert.equal(steps,1);
});
