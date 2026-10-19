import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {summarizeI80386CrossModePotentialTrace} from
  '../scripts/summarize-i80386-cross-mode-potential-trace.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const mode=()=>({entryAttempts:0,completedStepCalls:0,noRetirement:0,
  abortedCalls:0,repeatIterationCalls:0,eligibleRetiredOrdinals:0,
  admittedOrdinals:0,refusedOrdinals:0,runLengthHistogram:{},
  ordinalsInRunsAtLeast8:0,optimisticIoOrdinalsInRunsAtLeast8:0,
  controlTransferOrdinalsInRunsAtLeast8:0,
  longRunOpcodeCounts:{}});
function pair(){
  const modes={real:mode(),protected16:mode(),vm86:mode(),protected32:mode()};
  modes.real.entryAttempts=60_000_000;
  modes.real.noRetirement=60_000_000;
  const baseline={schema:'bw.i80386-at-console.v1',steps:60_000_000,
    stop:'budget',refusal:null,cpu:{eip:2},nativeStats:null,
    delivered:[],serial:{bytes:0},textRam:'',vga:{planeSha256:[]},
    inputs:{bios:'private',vga:'private',hdd:'private',geometry:[1,1,1],
      cmosType:2,cmosEquipment:0,events:[],mouseEnabled:false}};
  const raw=structuredClone(baseline);
  raw.executionRevision='abc';raw.sourceSha256={'../src/experimental/i80386.js':sha('core')};
  baseline.executionRevision=raw.executionRevision;
  baseline.sourceSha256=structuredClone(raw.sourceSha256);
  raw.crossModeTraceObserver={schema:'bw.i80386-cross-mode-potential-trace-observer.v1',
    modes,completedStepCalls:0,eligibleRetiredOrdinals:0,repeatIterationCalls:0,
    noRetirementCalls:60_000_000,abortedCalls:0,uniqueOrdinalsInRunsAtLeast8:0,
    optimisticIoOrdinalsInRunsAtLeast8:0,
    controlTransferOrdinalsInRunsAtLeast8:0,
    protected16OrVm86OrdinalsInRunsAtLeast8:0,
    predeclaredOpportunityGatePassed:false};
  return {raw,baseline};
}

test('reducer checks the full 60M partition, source and selected guest parity',()=>{
  const {raw,baseline}=pair();
  const receipt=summarizeI80386CrossModePotentialTrace(raw,baseline,{
    sourceBlobs:{'../src/experimental/i80386.js':'core'},
    rawSha256:'raw',baselineSha256:'baseline'});
  assert.equal(receipt.selectedReportedGuestParity,true);
  assert.equal(receipt.sourceHashesVerified,true);
  assert.deepEqual(receipt.sourceHashDifferences,[]);
  assert.equal(receipt.observer.predeclaredOpportunityGatePassed,false);
});

test('reducer detects changed guest output and inconsistent denominators',()=>{
  const {raw,baseline}=pair();
  raw.cpu.eip=3;
  const sourceBlobs={'../src/experimental/i80386.js':'core'};
  const receipt=summarizeI80386CrossModePotentialTrace(raw,baseline,{sourceBlobs});
  assert.equal(receipt.selectedReportedGuestParity,false);
  assert.deepEqual(receipt.guestReportedFieldDifferences,['cpu']);
  raw.crossModeTraceObserver.modes.real.noRetirement--;
  assert.throws(()=>summarizeI80386CrossModePotentialTrace(raw,baseline,{sourceBlobs}),
    /observer partition mismatch/);
});

test('reducer refuses a baseline from another revision or source hash map',()=>{
  const {raw,baseline}=pair();
  const sourceBlobs={'../src/experimental/i80386.js':'core'};
  baseline.executionRevision='older';
  assert.throws(()=>summarizeI80386CrossModePotentialTrace(raw,baseline,{sourceBlobs}),
    /execution revisions/);
  baseline.executionRevision=raw.executionRevision;
  baseline.sourceSha256['../src/experimental/i80386.js']=sha('older core');
  assert.throws(()=>summarizeI80386CrossModePotentialTrace(raw,baseline,{sourceBlobs}),
    /complete source hash maps/);
  baseline.sourceSha256=structuredClone(raw.sourceSha256);
  baseline.sourceSha256['../src/extra.js']=sha('extra');
  assert.throws(()=>summarizeI80386CrossModePotentialTrace(raw,baseline,{sourceBlobs}),
    /complete source hash maps/);
});

test('reducer requires complete source blobs whose bytes match the report',()=>{
  const {raw,baseline}=pair();
  assert.throws(()=>summarizeI80386CrossModePotentialTrace(raw,baseline),
    /source blobs do not cover/);
  assert.throws(()=>summarizeI80386CrossModePotentialTrace(raw,baseline,{
    sourceBlobs:{'../src/experimental/i80386.js':'wrong'}}),
  /source bytes disagree/);
});
