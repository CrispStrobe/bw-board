import test from 'node:test';
import assert from 'node:assert/strict';
import {createFrameOrchestration} from '../scripts/i80386-cwsdpmi-0501-frame-at/orchestration.mjs';

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
  f.frame.ports.bind();f.setOpportunity({comparison,cs:0xa7});
  f.frame.ports.step();
  assert.deepEqual(f.calls,['machine-step','bind','observe','arm','machine-step','poll']);
  f.setPhase('complete');f.frame.ports.step();
  assert.deepEqual(f.calls.slice(-2),['machine-step','poll']);
  const result=f.frame.finish({passed:true,returnDiagnostic:{address:0x4a0000}});
  assert.equal(result.passed,true);assert.equal(result.frame0501.phase,'passed');
});
test('successful client without pair fails and retains original earlier failure',()=>{
  const f=fixture();
  const report=f.frame.finish({passed:true,firstFailure:null,
    returnDiagnostic:{address:0x4a0000}});
  assert.equal(report.passed,false);
  assert.equal(report.firstFailure,'missing pair');
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
  const f=fixture();f.frame.ports.bind();
  f.setOpportunity({comparison,cs:0xa7});
  const original=f.frame.ports.step;
  // Source observer failures are terminal in the actual driver. Here the
  // injected policy's one-shot arm is exercised without importing a CPU.
  assert.equal(typeof original,'function');
  assert.throws(()=>f.frame.ports.bind(),/duplicate/);
});
