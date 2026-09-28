import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeI80386GroupedShadowAdmission} from
  '../scripts/summarize-i80386-grouped-shadow-admission.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const modes=['real','protected16','vm86','protected32'];
const each=make=>Object.fromEntries(modes.map(mode=>[mode,make()]));
const ordinary=()=>({entryAttempts:0,completedStepCalls:0,noRetirement:0,
  abortedCalls:0,repeatIterationCalls:0,eligibleRetiredOrdinals:0,
  admittedOrdinals:0,refusedOrdinals:0,runLengthHistogram:{},
  ordinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
  controlTransferOrdinalsInRunsAtLeast8:0,longRunOpcodeCounts:{}});
const grouped=()=>({eligibleRetiredOrdinals:0,admittedOrdinals:0,
  refusedOrdinals:0,runs:0,runLengthHistogram:{},refusals:{},
  runEndReasons:{},observedPrefixSignatures:{},observedOpcodeCounts:{},
  ordinalsInRunsAtLeast8:0,admittedFormCounts:{},longRunFormCounts:{},
  admittedAccessClasses:{},admittedEaClasses:{},admittedModrmShapes:{},
  longRunAccessClasses:{},optimisticIoOrdinalsInRunsAtLeast8:0});

function pair(){
  const baseline={schema:'bw.i80386-at-console.v1',steps:60_000_000,
    stop:'budget',refusal:null,cpu:{eip:2},nativeStats:null,
    delivered:[],serial:{bytes:0},textRam:'',vga:{planeSha256:[]},
    inputs:{bios:'private',vga:'private',hdd:'private',geometry:[1,1,1],
      cmosType:2,cmosEquipment:0,events:[],mouseEnabled:false},
    executionRevision:'abc',
    sourceSha256:{'../src/experimental/i80386.js':sha('core')}};
  const raw=structuredClone(baseline),broad=each(ordinary),typed=each(grouped);
  broad.real.entryAttempts=60_000_000;
  broad.real.noRetirement=60_000_000;
  raw.crossModeTraceObserver={
    schema:'bw.i80386-cross-mode-potential-trace-observer.v1',maxRun:64,
    modes:broad,completedStepCalls:0,eligibleRetiredOrdinals:0,
    repeatIterationCalls:0,noRetirementCalls:60_000_000,abortedCalls:0,
    uniqueOrdinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
    controlTransferOrdinalsInRunsAtLeast8:0,
    protected16OrVm86OrdinalsInRunsAtLeast8:0,
    predeclaredOpportunityGatePassed:false,
    groupedShadowPotential:{schema:'bw.i80386-grouped-shadow-admission.v1',
      grammar:'typed-mov-cmp-test-group7-short-control-byte-io-plus-a8-8d-0b-31-ff0.v1',
      maxRun:64,modes:typed,eligibleRetiredOrdinals:0,admittedOrdinals:0,
      refusedOrdinals:0,disjointRuns:0,uniqueOrdinalsInRunsAtLeast8:0,
      protected16OrVm86OrdinalsInRunsAtLeast8:0,
      optimisticIoOrdinalsInRunsAtLeast8:0,
      predeclaredSubsetOpportunityPassed:false}};
  return {raw,baseline};
}
const options={sourceBlobs:{'../src/experimental/i80386.js':'core'},
  rawSha256:'raw',baselineSha256:'baseline'};

test('grouped reducer verifies source, guest and 15M/5M gate',()=>{
  const {raw,baseline}=pair();
  const result=summarizeI80386GroupedShadowAdmission(raw,baseline,options);
  assert.equal(result.sourceHashesVerified,true);
  assert.equal(result.selectedReportedGuestParity,true);
  assert.equal(result.groupedShadowPotential.predeclaredSubsetOpportunityPassed,false);
});

test('grouped reducer rejects source and partition changes',()=>{
  const {raw,baseline}=pair();
  baseline.executionRevision='other';
  assert.throws(()=>summarizeI80386GroupedShadowAdmission(raw,baseline,options),
    /execution revisions/);
  baseline.executionRevision='abc';
  assert.throws(()=>summarizeI80386GroupedShadowAdmission(raw,baseline),
    /source blobs do not cover/);
  const typed=raw.crossModeTraceObserver.groupedShadowPotential;
  typed.modes.real.admittedOrdinals=1;
  assert.throws(()=>summarizeI80386GroupedShadowAdmission(raw,baseline,options),
    /grouped shadow partition mismatch/);
  typed.modes.real.admittedOrdinals=0;
});

test('grouped reducer rejects a coherent-looking deferred FF /2 form',()=>{
  const {raw,baseline}=pair();
  const observer=raw.crossModeTraceObserver;
  const broad=observer.modes.real,typed=observer.groupedShadowPotential.modes.real;
  broad.completedStepCalls=1;broad.noRetirement=59_999_999;
  broad.eligibleRetiredOrdinals=1;broad.admittedOrdinals=1;
  broad.runLengthHistogram={'1':1};
  observer.completedStepCalls=1;observer.noRetirementCalls=59_999_999;
  observer.eligibleRetiredOrdinals=1;
  typed.eligibleRetiredOrdinals=1;typed.admittedOrdinals=1;typed.runs=1;
  typed.runLengthHistogram={'1':1};typed.runEndReasons={'report-boundary':1};
  typed.observedPrefixSignatures={'-/-/-':1};typed.observedOpcodeCounts={ff:1};
  typed.admittedFormCounts['ff:-/-/-:o16:a16:m3r2b0d0:register']=1;
  typed.admittedAccessClasses={register:1};typed.admittedEaClasses={register:1};
  const aggregate=observer.groupedShadowPotential;
  aggregate.eligibleRetiredOrdinals=1;aggregate.admittedOrdinals=1;
  aggregate.disjointRuns=1;
  assert.throws(()=>summarizeI80386GroupedShadowAdmission(raw,baseline,options),
    /deferred form admitted/);
});

test('grouped reducer refuses unexpected reported guest differences',()=>{
  const {raw,baseline}=pair();
  raw.cpu.eip=3;
  const result=summarizeI80386GroupedShadowAdmission(raw,baseline,options);
  assert.equal(result.selectedReportedGuestParity,false);
  assert.deepEqual(result.guestReportedFieldDifferences,['cpu']);
});
