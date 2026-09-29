import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {compactGroupedFirstRefusalResult,summarizeGroupedFirstRefusalFiles,
  serializeCompactGroupedFirstRefusalResult} from
  '../scripts/summarize-i80386-grouped-first-refusal-result.mjs';

const modes=['real','protected16','vm86','protected32'];
const record=(opcode,bridge)=>({reason:'unsupported-opcode',opcode,
  prefixSignature:'-',operandWidth:16,addressWidth:16,
  modrm:{mod:3,reg:2,rm:1,sib:null,displacementBytes:0},
  eaClass:'register',observedAccess:'none',count:10,
  bridgeAtLeast4:bridge,bridgeAtLeast8:0});
const contextMode=(opcode,bridge)=>({refusedOrdinals:12,selectedRefusals:10,
  unselectedRefusals:2,bridgeAtLeast4:bridge,bridgeAtLeast8:0,
  records:{one:record(opcode,bridge)}});
const groupedMode=()=>({refusedOrdinals:12});
const reduced={schema:'bw.i80386-grouped-shadow-admission-receipt.v1',
  sourceRevision:'pinned',completedSteps:60_000_000,
  sourceHashesVerified:true,selectedReportedGuestParity:true,
  sourceHashDifferences:[],inputPinDifferences:[],
  guestReportedFieldDifferences:[],unexpectedReportedDifferencePaths:[],
  groupedShadowPotential:{schema:'bw.i80386-grouped-shadow-admission.v1',
    eligibleRetiredOrdinals:100,admittedOrdinals:52,refusedOrdinals:48,
    uniqueOrdinalsInRunsAtLeast8:8,
    protected16OrVm86OrdinalsInRunsAtLeast8:4,
    predeclaredSubsetOpportunityPassed:false,
    modes:Object.fromEntries(modes.map(mode=>[mode,groupedMode()])),
    firstRefusalContext:{schema:'bw.i80386-grouped-first-refusal-context.v1',
      refusedOrdinals:48,selectedRefusals:40,unselectedRefusals:8,
      bridgeAtLeast4:16,bridgeAtLeast8:0,
      modes:{real:contextMode('8e',4),protected16:contextMode('8e',5),
        vm86:contextMode('ff',6),protected32:contextMode('0f84',1)}}}};

test('compact result preserves disjoint coverage and local bridges without media',()=>{
  const result=compactGroupedFirstRefusalResult(reduced,{observedReport:'abc'});
  assert.equal(result.groupedAdmission.uniqueOrdinalsInRunsAtLeast8,8);
  assert.equal(result.firstRefusal.bridgeAtLeast4,16);
  assert.equal(result.predeclaredTriageGate.protected16OrVm86BridgeAtLeast4,11);
  assert.equal(result.predeclaredTriageGate.passed,false);
  assert.equal(result.firstRefusal.modes.protected32.topBridgeForms[0].opcode,'0f84');
  assert.ok(!serializeCompactGroupedFirstRefusalResult(result).includes('private media'));
});

test('fails closed on source/guest parity, selected partition and bridge sums',()=>{
  assert.throws(()=>compactGroupedFirstRefusalResult({...reduced,
    sourceHashesVerified:false},{}),/parity failed/);
  assert.throws(()=>compactGroupedFirstRefusalResult({...reduced,
    inputPinDifferences:['media']},{}),/parity failed/);
  const broken=structuredClone(reduced);
  broken.groupedShadowPotential.firstRefusalContext.modes.vm86.unselectedRefusals++;
  assert.throws(()=>compactGroupedFirstRefusalResult(broken,{}),/partition mismatch/);
  const brokenBridge=structuredClone(reduced);
  brokenBridge.groupedShadowPotential.firstRefusalContext.modes.vm86.records.one.bridgeAtLeast4++;
  assert.throws(()=>compactGroupedFirstRefusalResult(brokenBridge,{}),/record sum mismatch/);
});

test('file path refuses private report hash mismatch before reducing',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'grouped-refusal-result-'));
  try{
    const files=['observed','baseline','candidate'].map(name=>path.join(dir,`${name}.json`));
    fs.writeFileSync(files[0],JSON.stringify({sourceSha256:{}}));
    fs.writeFileSync(files[1],JSON.stringify({sourceSha256:{}}));
    fs.writeFileSync(files[2],JSON.stringify({privateRawReportSha256:'wrong'}));
    assert.throws(()=>summarizeGroupedFirstRefusalFiles(...files),/private report hashes/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('published receipt stays bounded and records the failed predeclared gate',()=>{
  const bytes=fs.readFileSync(new URL('../docs/receipts/2026-09-29-i80386-grouped-first-refusal-result.json',
    import.meta.url));
  const receipt=JSON.parse(bytes);
  assert.ok(bytes.length<32*1024);
  assert.equal(receipt.firstRefusal.refusedOrdinals,32_691_982);
  assert.equal(receipt.firstRefusal.selectedRefusals+receipt.firstRefusal.unselectedRefusals,
    receipt.firstRefusal.refusedOrdinals);
  assert.equal(receipt.firstRefusal.bridgeAtLeast4,100_787);
  assert.equal(receipt.predeclaredTriageGate.protected16OrVm86BridgeAtLeast4,96_255);
  assert.equal(receipt.predeclaredTriageGate.passed,false);
  assert.equal(receipt.sourceHashesVerified,true);
  assert.equal(receipt.selectedReportedGuestParity,true);
  assert.ok(!JSON.stringify(receipt).includes('/mnt/'));
});
