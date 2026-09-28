import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeI80386Code16EventObserver} from
  '../scripts/summarize-i80386-code16-event-observer.mjs';

const bucket=(retired,admitted,length)=>({entryAttempts:retired,
  retiredSteps:retired,noRetirement:0,abortedCalls:0,
  admittedOrdinals:admitted,refusedOrdinals:retired-admitted,
  runs:admitted?1:0,runLengthHistogram:admitted?{[length]:1}:{},
  stepsInRunsAtLeast4:length>=4?admitted:0,runEndReasons:{},refusals:{}});
function fixtures(){
  const baseline={schema:'bw.i80386-at-console.v1',steps:60_000_000,
    stop:'budget',refusal:null,cpu:{eip:10},nativeStats:null,
    delivered:[],serial:{bytes:0,text:''},textRam:[],vga:{planeSha256:[]},
    inputs:{bios:'private',vga:'private',hdd:'private',geometry:[1,1,1],
      cmosType:47,cmosEquipment:0,events:'private',mouseEnabled:false}};
  const raw=structuredClone(baseline);
  raw.executionRevision='test-source';raw.sourceSha256={};
  raw.code16EventObserver={schema:'bw.i80386-code16-event-run-observer.v1',
    maxRun:64,modes:{real:bucket(0,0,0),protected16:bucket(5,4,4),
      vm86:bucket(0,0,0),protected32:bucket(0,0,0)},
    deviceReads:1,deviceWrites:0,
    denominator16BitRetiredOrdinals:5,admitted16BitOrdinals:4,
    disjointRuns16Bit:1,meanAllAdmittedRunLength:4,
    uniqueOrdinalsInRunsAtLeast4:4,
    longRunCoverageOf16BitRetirements:4/5,feasibilityPassed:true};
  return {raw,baseline};
}

test('media-neutral reducer uses unique denominator and emits no guest values',()=>{
  const {raw,baseline}=fixtures();
  const receipt=summarizeI80386Code16EventObserver(raw,baseline);
  assert.equal(receipt.selectedReportedGuestParity,true);
  assert.equal(receipt.observer.denominator16BitRetiredOrdinals,5);
  assert.equal(receipt.observer.uniqueOrdinalsInRunsAtLeast4,4);
  assert.equal(receipt.observer.feasibilityPassed,true);
  assert.equal(JSON.stringify(receipt).includes('private'),false);
});

test('reducer exposes reported guest mismatch and rejects overlapping run counts',()=>{
  const {raw,baseline}=fixtures();
  raw.cpu.eip=11;
  const mismatch=summarizeI80386Code16EventObserver(raw,baseline);
  assert.deepEqual(mismatch.guestReportedFieldDifferences,['cpu']);
  assert.deepEqual(mismatch.unexpectedReportedDifferencePaths,['cpu.eip']);
  assert.equal(mismatch.selectedReportedGuestParity,false);
  raw.code16EventObserver.modes.protected16.runLengthHistogram={'4':2};
  assert.throws(()=>summarizeI80386Code16EventObserver(raw,baseline),
    /partition mismatch/);
});
