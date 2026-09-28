import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeI80386FormResolvedAdmission} from
  '../scripts/summarize-i80386-form-resolved-admission.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const baseMode=()=>({entryAttempts:0,completedStepCalls:0,noRetirement:0,
  abortedCalls:0,repeatIterationCalls:0,eligibleRetiredOrdinals:0,
  admittedOrdinals:0,refusedOrdinals:0,runLengthHistogram:{},
  ordinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
  controlTransferOrdinalsInRunsAtLeast8:0,longRunOpcodeCounts:{}});
const typedMode=()=>({eligibleRetiredOrdinals:0,admittedOrdinals:0,
  refusedOrdinals:0,runs:0,runLengthHistogram:{},refusals:{},
  runEndReasons:{},observedPrefixSignatures:{},observedOpcodeCounts:{},
  ordinalsInRunsAtLeast8:0,admittedFormCounts:{},longRunFormCounts:{},
  admittedAccessClasses:{},admittedEaClasses:{},longRunAccessClasses:{},
  optimisticIoOrdinalsInRunsAtLeast8:0});
const modeNames=['real','protected16','vm86','protected32'];
const modes=make=>Object.fromEntries(modeNames.map(name=>[name,make()]));
function pair(){
  const baseline={schema:'bw.i80386-at-console.v1',steps:60_000_000,
    stop:'budget',refusal:null,cpu:{eip:2},nativeStats:null,
    delivered:[],serial:{bytes:0},textRam:'',vga:{planeSha256:[]},
    inputs:{bios:'private',vga:'private',hdd:'private',geometry:[1,1,1],
      cmosType:2,cmosEquipment:0,events:[],mouseEnabled:false},
    executionRevision:'abc',
    sourceSha256:{'../src/experimental/i80386.js':sha('core')}};
  const raw=structuredClone(baseline),ordinary=modes(baseMode),typed=modes(typedMode);
  ordinary.real.entryAttempts=60_000_000;
  ordinary.real.noRetirement=60_000_000;
  raw.crossModeTraceObserver={
    schema:'bw.i80386-cross-mode-potential-trace-observer.v1',maxRun:64,
    modes:ordinary,completedStepCalls:0,eligibleRetiredOrdinals:0,
    repeatIterationCalls:0,noRetirementCalls:60_000_000,abortedCalls:0,
    uniqueOrdinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
    controlTransferOrdinalsInRunsAtLeast8:0,
    protected16OrVm86OrdinalsInRunsAtLeast8:0,
    predeclaredOpportunityGatePassed:false,
    formResolvedPotential:{schema:'bw.i80386-form-resolved-admission.v1',
      grammar:'typed-mov-cmp-test-group7-short-control-byte-io.v1',
      maxRun:64,modes:typed,eligibleRetiredOrdinals:0,admittedOrdinals:0,
      refusedOrdinals:0,disjointRuns:0,uniqueOrdinalsInRunsAtLeast8:0,
      protected16OrVm86OrdinalsInRunsAtLeast8:0,
      optimisticIoOrdinalsInRunsAtLeast8:0,
      predeclaredSubsetOpportunityPassed:false}};
  return {raw,baseline};
}
const options={sourceBlobs:{'../src/experimental/i80386.js':'core'},
  rawSha256:'raw',baselineSha256:'baseline'};

test('paired reducer verifies source and guest parity and predeclared gate',()=>{
  const {raw,baseline}=pair();
  const result=summarizeI80386FormResolvedAdmission(raw,baseline,options);
  assert.equal(result.selectedReportedGuestParity,true);
  assert.equal(result.sourceHashesVerified,true);
  assert.equal(result.formResolvedPotential.predeclaredSubsetOpportunityPassed,false);
});

test('paired reducer rejects revision, source, guest and typed partition changes',()=>{
  const {raw,baseline}=pair();
  baseline.executionRevision='other';
  assert.throws(()=>summarizeI80386FormResolvedAdmission(raw,baseline,options),
    /execution revisions/);
  baseline.executionRevision='abc';
  baseline.sourceSha256['../src/experimental/i80386.js']=sha('other');
  assert.throws(()=>summarizeI80386FormResolvedAdmission(raw,baseline,options),
    /source hash maps/);
  baseline.sourceSha256=structuredClone(raw.sourceSha256);
  raw.cpu.eip=3;
  assert.equal(summarizeI80386FormResolvedAdmission(raw,baseline,options)
    .selectedReportedGuestParity,false);
  raw.cpu.eip=2;
  raw.crossModeTraceObserver.formResolvedPotential.modes.real.admittedOrdinals++;
  assert.throws(()=>summarizeI80386FormResolvedAdmission(raw,baseline,options),
    /typed admission partition mismatch/);
});

test('paired reducer requires complete source bytes and ordinary baseline',()=>{
  const {raw,baseline}=pair();
  assert.throws(()=>summarizeI80386FormResolvedAdmission(raw,baseline),
    /source blobs do not cover/);
  baseline.crossModeTraceObserver={};
  assert.throws(()=>summarizeI80386FormResolvedAdmission(raw,baseline,options),
    /baseline must have/);
});
