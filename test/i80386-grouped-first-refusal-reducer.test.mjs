import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeI80386GroupedFirstRefusalContext} from
  '../scripts/summarize-i80386-grouped-first-refusal-context.mjs';

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
const contextMode=()=>({refusedOrdinals:0,selectedRefusals:0,
  unselectedRefusals:0,followingResolved:0,bridgeAtLeast4:0,
  bridgeAtLeast8:0,records:{}});
function pair(){
  const baseline={schema:'bw.i80386-at-console.v1',steps:60_000_000,
    stop:'budget',refusal:null,cpu:{eip:2},nativeStats:null,
    delivered:[],serial:{bytes:0},textRam:'',vga:{planeSha256:[]},
    inputs:{bios:'private',vga:'private',hdd:'private',geometry:[1,1,1],
      cmosType:2,cmosEquipment:0,events:[],mouseEnabled:false},
    executionRevision:'abc',
    sourceSha256:{'../src/experimental/i80386.js':sha('core')}};
  const raw=structuredClone(baseline),broad=each(ordinary),typed=each(grouped);
  const context=each(contextMode);
  broad.real.entryAttempts=60_000_000;
  broad.real.noRetirement=59_999_999;
  broad.real.completedStepCalls=1;
  broad.real.eligibleRetiredOrdinals=1;
  broad.real.refusedOrdinals=1;
  typed.real.eligibleRetiredOrdinals=1;
  typed.real.refusedOrdinals=1;
  typed.real.refusals={'unsupported-opcode':1};
  typed.real.observedPrefixSignatures={'-/-/-':1};
  typed.real.observedOpcodeCounts={c1:1};
  context.real.refusedOrdinals=1;
  context.real.selectedRefusals=1;
  context.real.followingResolved=1;
  context.real.records['unsupported-opcode|c1:-:o16:a16:m3g4b0d0:register:none:shape-complete']={
    reason:'unsupported-opcode',opcode:'c1',prefixSignature:'-',
    operandWidth:16,addressWidth:16,
    modrm:{mod:3,reg:4,rm:0,sib:null,displacementBytes:0},
    eaClass:'register',observedAccess:'none',parseStatus:'shape-complete',
    count:1,followingResolved:1,precedingLengthHistogram:{'0':1},
    followingLengthHistogram:{'0':1},
    followingEndReasons:{'refusal-side-exit':1},
    bridgeAtLeast4:0,bridgeAtLeast8:0};
  raw.crossModeTraceObserver={
    schema:'bw.i80386-cross-mode-potential-trace-observer.v1',maxRun:64,
    modes:broad,completedStepCalls:1,eligibleRetiredOrdinals:1,
    repeatIterationCalls:0,noRetirementCalls:59_999_999,abortedCalls:0,
    uniqueOrdinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
    controlTransferOrdinalsInRunsAtLeast8:0,
    protected16OrVm86OrdinalsInRunsAtLeast8:0,
    predeclaredOpportunityGatePassed:false,
    groupedShadowPotential:{schema:'bw.i80386-grouped-shadow-admission.v1',
      grammar:'typed-mov-cmp-test-group7-short-control-byte-io-plus-a8-8d-0b-31-ff0.v1',
      maxRun:64,modes:typed,eligibleRetiredOrdinals:1,admittedOrdinals:0,
      refusedOrdinals:1,disjointRuns:0,uniqueOrdinalsInRunsAtLeast8:0,
      protected16OrVm86OrdinalsInRunsAtLeast8:0,
      optimisticIoOrdinalsInRunsAtLeast8:0,
      predeclaredSubsetOpportunityPassed:false,
      firstRefusalContext:{schema:'bw.i80386-grouped-first-refusal-context.v1',
        maxRun:64,modes:context,refusedOrdinals:1,selectedRefusals:1,
        unselectedRefusals:0,bridgeAtLeast4:0,bridgeAtLeast8:0}}};
  return {raw,baseline};
}
const options={sourceBlobs:{'../src/experimental/i80386.js':'core'},
  rawSha256:'raw',baselineSha256:'baseline'};

test('grouped refusal reducer retains exact selected shape and source parity',()=>{
  const {raw,baseline}=pair();
  const result=summarizeI80386GroupedFirstRefusalContext(raw,baseline,options);
  assert.equal(result.sourceHashesVerified,true);
  assert.equal(result.selectedReportedGuestParity,true);
  const context=result.groupedShadowPotential.firstRefusalContext;
  assert.equal(context.modes.real.selectedRefusals,1);
  assert.equal(context.modes.real.records[Object.keys(context.modes.real.records)[0]]
    .modrm.reg,4);
});

test('requires full source map, same revision and selected reported guest state',()=>{
  const {raw,baseline}=pair();
  assert.throws(()=>summarizeI80386GroupedFirstRefusalContext(raw,baseline),
    /source blobs do not cover/);
  baseline.executionRevision='other';
  assert.throws(()=>summarizeI80386GroupedFirstRefusalContext(raw,baseline,options),
    /execution revisions/);
  baseline.executionRevision='abc';
  baseline.cpu.eip=3;
  const result=summarizeI80386GroupedFirstRefusalContext(raw,baseline,options);
  assert.equal(result.selectedReportedGuestParity,false);
});

test('rejects mismatched selected/non-target partitions and run lengths',()=>{
  const {raw,baseline}=pair();
  const context=raw.crossModeTraceObserver.groupedShadowPotential.firstRefusalContext;
  const record=Object.values(context.modes.real.records)[0];
  context.modes.real.unselectedRefusals=1;
  assert.throws(()=>summarizeI80386GroupedFirstRefusalContext(raw,baseline,options),
    /grouped refusal partition mismatch/);
  context.modes.real.unselectedRefusals=0;
  record.followingLengthHistogram={'65':1};
  assert.throws(()=>summarizeI80386GroupedFirstRefusalContext(raw,baseline,options),
    /grouped refusal partition mismatch/);
  record.followingLengthHistogram={'0':1};
  record.opcode='90';
  assert.throws(()=>summarizeI80386GroupedFirstRefusalContext(raw,baseline,options),
    /grouped refusal partition mismatch/);
});
