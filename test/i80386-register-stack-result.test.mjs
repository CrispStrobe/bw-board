import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {reduceI80386RegisterStackResult} from
  '../scripts/summarize-i80386-register-stack-result.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const modes=['real','protected16','vm86','protected32'];
const required=['../src/experimental/i80386.js',
  '../src/experimental/i80386-at-machine.js',
  '../src/experimental/i80386-cross-mode-potential-trace-observer.js',
  '../src/experimental/i80386-form-resolved-admission.js',
  '../src/experimental/i80386-expanded-grouped-admission.js',
  '../src/experimental/i80386-register-stack-admission.js',
  './summarize-i80386-register-stack-result.mjs'];
const ordinary=()=>({entryAttempts:0,completedStepCalls:0,noRetirement:0,
  abortedCalls:0,repeatIterationCalls:0,eligibleRetiredOrdinals:0,
  ordinalsInRunsAtLeast8:0});
const typed=()=>({eligibleRetiredOrdinals:0,admittedOrdinals:0,
  refusedOrdinals:0,runs:0,runLengthHistogram:{},runEndReasons:{},
  refusals:{},admittedFormCounts:{},longRunFormCounts:{},
  ordinalsInRunsAtLeast8:0,typedCandidatesCutByGlobal:{},
  typedCandidatesCutByGlobalOpcode:{}});

function pair(workload){
  const steps=workload==='windows'?60_000_000:2;
  const sources=Object.fromEntries([...required,
    workload==='windows'?'./run-i80386-at-console.mjs':
      './probe-xv6-stock.mjs'].map(file=>[file,`bytes:${file}`]));
  const sourceSha256=Object.fromEntries(Object.entries(sources)
    .map(([file,bytes])=>[file,sha(bytes)]));
  const baseline={executionRevision:'a'.repeat(40),sourceSha256,steps,
    ramSha256:sha('ram'),diskSha256:sha('disk'),
    cpu:{instructionSnapshot:{eax:1,es:0},cycles:1},machineCycles:10,
    ...(workload==='windows'?{schema:'bw.i80386-at-console.v1',
      stop:'budget',inputs:{registerStackAdmission:false}}:
      {registerStackAdmission:false,
        filesystemDiskSha256:sha('fs')})};
  const observed=structuredClone(baseline);
  if(workload==='windows')observed.inputs.registerStackAdmission=true;
  else observed.registerStackAdmission=true;
  const broad=Object.fromEntries(modes.map(mode=>[mode,ordinary()]));
  const form=Object.fromEntries(modes.map(mode=>[mode,typed()]));
  broad.real.entryAttempts=steps;broad.real.noRetirement=steps;
  observed.crossModeTraceObserver={
    schema:'bw.i80386-cross-mode-potential-trace-observer.v1',modes:broad,
    registerStackPotential:{schema:'bw.i80386-register-stack-admission.v1',
      grammar:'typed-grouped-plus-owned-es-call-return-register-stack.v1',maxRun:64,
      modes:form,eligibleRetiredOrdinals:0,admittedOrdinals:0,
      refusedOrdinals:0,disjointRuns:0,uniqueOrdinalsInRunsAtLeast8:0,
      protected16OrVm86OrdinalsInRunsAtLeast8:0,
      typedCandidatesCutByGlobal:0,
      predeclaredSubsetOpportunityPassed:false}};
  return {baseline,observed,sources,options:{workload,sourceBlobs:sources,
    baselineSha256:sha('baseline'),observedSha256:sha('observed')}};
}

for(const workload of ['windows','xv6']){
  test(`${workload} source-bound whole-report and disjoint zero-opportunity reduction`,()=>{
    const {baseline,observed,options}=pair(workload);
    const result=reduceI80386RegisterStackResult(observed,baseline,options);
    assert.equal(result.wholeReportParityExceptDiagnostic,true);
    assert.equal(result.ramAndDiskHashesEqual,true);
    assert.equal(result.windowsGate.passed,workload==='windows'?false:null);
  });
  test(`${workload} rejects hidden-state, disk, and source mismatch`,()=>{
    const {baseline,observed,options}=pair(workload);
    observed.cpu.instructionSnapshot.es=4;
    assert.throws(()=>reduceI80386RegisterStackResult(observed,baseline,options),
      /whole reported guest/);
    observed.cpu.instructionSnapshot.es=0;
    observed.diskSha256=sha('changed');
    assert.throws(()=>reduceI80386RegisterStackResult(observed,baseline,options),
      /whole reported guest/);
    observed.diskSha256=baseline.diskSha256;
    options.sourceBlobs['../src/experimental/i80386.js']='changed';
    assert.throws(()=>reduceI80386RegisterStackResult(observed,baseline,options),
      /committed source mismatch/);
  });
}

test('reducer rejects inflated disjoint gate and typed-global-cut totals',()=>{
  const {baseline,observed,options}=pair('windows');
  const typed=observed.crossModeTraceObserver.registerStackPotential;
  typed.predeclaredSubsetOpportunityPassed=true;
  assert.throws(()=>reduceI80386RegisterStackResult(observed,baseline,options),
    /aggregate, disjoint coverage, or gate mismatch/);
  typed.predeclaredSubsetOpportunityPassed=false;
  typed.typedCandidatesCutByGlobal=1;
  assert.throws(()=>reduceI80386RegisterStackResult(observed,baseline,options),
    /aggregate, disjoint coverage, or gate mismatch/);
});
