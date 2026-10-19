import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {compactI80386GroupedShadowResult,
  serializeCompactI80386GroupedShadowResult,
  summarizeI80386GroupedShadowFiles} from
  '../scripts/summarize-i80386-grouped-shadow-result.mjs';

const mode=()=>({eligibleRetiredOrdinals:10,admittedOrdinals:8,
  refusedOrdinals:2,runs:1,ordinalsInRunsAtLeast8:8,
  optimisticIoOrdinalsInRunsAtLeast8:0,
  admittedAccessClasses:{register:8},longRunAccessClasses:{register:8},
  admittedFormCounts:Object.fromEntries(Array.from({length:12},(_,i)=>
    [`form${String(i).padStart(2,'0')}`,i+1])),
  longRunFormCounts:{'a8:-/-/-:o8:a16:-:register':8},
  refusals:{'deferred-segment-state':2},runEndReasons:{'run-budget':1}});
const modes=()=>Object.fromEntries(['real','protected16','vm86','protected32']
  .map(name=>[name,mode()]));
const reduced=()=>({schema:'bw.i80386-grouped-shadow-admission-receipt.v1',
  sourceRevision:'pinned-revision',completedSteps:60_000_000,
  sourceHashesVerified:true,selectedReportedGuestParity:true,
  sourceHashDifferences:[],guestReportedFieldDifferences:[],
  inputPinDifferences:[],unexpectedReportedDifferencePaths:[],
  groupedShadowPotential:{schema:'bw.i80386-grouped-shadow-admission.v1',
    eligibleRetiredOrdinals:40,admittedOrdinals:32,refusedOrdinals:8,
    disjointRuns:4,uniqueOrdinalsInRunsAtLeast8:32,
    protected16OrVm86OrdinalsInRunsAtLeast8:16,
    predeclaredSubsetOpportunityPassed:false,modes:modes()}});

test('retains disjoint per-mode coverage and bounds top forms without media',()=>{
  const input=reduced();input.inputs={hdd:'must-not-leak'};
  const result=compactI80386GroupedShadowResult(input,
    {observedReport:'raw-hash',baselineReport:'baseline-hash',
      sourceBoundCandidate:'candidate-hash'});
  assert.equal(result.modes.vm86.uniqueOrdinalsInRunsAtLeast8,8);
  assert.equal(result.protected16OrVm86OrdinalsInRunsAtLeast8,16);
  assert.equal(result.modes.real.topAdmittedForms.length,8);
  assert.equal(result.modes.real.topAdmittedForms[0].count,12);
  assert.equal(result.predeclaredGate.passed,false);
  assert.ok(!JSON.stringify(result).includes('must-not-leak'));
  assert.ok(Buffer.byteLength(serializeCompactI80386GroupedShadowResult(result))<32*1024);
});

test('rejects parity, source and disjoint aggregate mutations',()=>{
  const input=reduced();input.selectedReportedGuestParity=false;
  assert.throws(()=>compactI80386GroupedShadowResult(input,{}),/parity failed/);
  input.selectedReportedGuestParity=true;input.sourceHashDifferences=['core'];
  assert.throws(()=>compactI80386GroupedShadowResult(input,{}),/parity failed/);
  input.sourceHashDifferences=[];
  input.groupedShadowPotential.modes.vm86.ordinalsInRunsAtLeast8=7;
  assert.throws(()=>compactI80386GroupedShadowResult(input,{}),
    /disjoint-run count mismatch/);
});

test('rejects an oversized result and a candidate with wrong report hashes',()=>{
  assert.throws(()=>serializeCompactI80386GroupedShadowResult({
    oversized:'x'.repeat(33*1024)}),/32 KiB bound/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grouped-result-'));
  try{
    const files=['observed.json','baseline.json','candidate.json']
      .map(name=>path.join(dir,name));
    fs.writeFileSync(files[0],'{}');fs.writeFileSync(files[1],'{}');
    fs.writeFileSync(files[2],JSON.stringify({
      privateRawReportSha256:'wrong',privateBaselineReportSha256:'wrong'}));
    assert.throws(()=>summarizeI80386GroupedShadowFiles(...files),
      /does not match private report hashes/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
