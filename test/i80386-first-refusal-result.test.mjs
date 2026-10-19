import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {compactFirstRefusalResult,summarizeFirstRefusalFiles} from
  '../scripts/summarize-i80386-first-refusal-result.mjs';

const revision='cbab1b3535854750ea83bdea86dc5fc6aaeb3960';
const record=(reason,opcode,reg,bridges)=>({reason,opcode,
  prefixSignature:'-',operandWidth:16,addressWidth:16,
  modrm:{mod:3,reg,rm:0,sib:null,displacementBytes:0},
  eaClass:'register',observedAccess:'none',parseStatus:'parsed',
  count:10,bridgeAtLeast4:bridges,bridgeAtLeast8:0});
const mode=records=>({refusedOrdinals:20,bridgeAtLeast4:11,
  bridgeAtLeast8:0,records});
const reduced={sourceRevision:revision,completedSteps:60_000_000,
  sourceHashesVerified:true,selectedReportedGuestParity:true,
  sourceHashDifferences:[],guestReportedFieldDifferences:[],
  inputPinDifferences:[],unexpectedReportedDifferencePaths:[],
  formResolvedPotential:{eligibleRetiredOrdinals:100,admittedOrdinals:20,
    refusedOrdinals:80,uniqueOrdinalsInRunsAtLeast8:8,
    protected16OrVm86OrdinalsInRunsAtLeast8:4,
    predeclaredSubsetOpportunityPassed:false,
    firstRefusalContext:{schema:'bw.i80386-first-refusal-context.v1',
      refusedOrdinals:80,bridgeAtLeast4:44,bridgeAtLeast8:0,modes:{
        real:mode({yes:record('unsupported-group-extension','83',0,4),
          no:record('unsupported-opcode','83',0,7)}),
        protected16:mode({yes:record('unsupported-group-extension','81',5,4),
          no:record('unsupported-group-extension','81',7,7)}),
        vm86:mode({yes:record('unsupported-group-extension','80',1,4),
          no:record('unsupported-group-extension','80',3,7)}),
        protected32:mode({yes:record('unsupported-group-extension','83',6,4),
          no:record('unsupported-group-extension','82',6,7)})}}}};
const host={boardRevision:revision,pins:{boardRevision:revision,
  steps:60_000_000,mediaSha256:{private:'must-not-leak'}},
  sourceHashesVerified:true,selectedReportedGuestParity:true};

test('counts only predeclared reason/opcode/extension and omits media pins',()=>{
  const compact=compactFirstRefusalResult(reduced,host,{observedReport:'abc'});
  assert.equal(compact.candidateA.bridgeAtLeast4,16);
  assert.equal(compact.candidateA.protected16OrVm86BridgeAtLeast4,8);
  assert.equal(compact.candidateA.passed,false);
  assert.equal(compact.firstRefusal.modes.real.topBridgeForms[0].bridgeAtLeast4,7);
  assert.equal(compact.firstRefusal.modes.real.topBridgeOpcodeGroups[0].reason,
    'unsupported-opcode');
  assert.ok(!JSON.stringify(compact).includes('must-not-leak'));
});

test('refuses failed paired provenance',()=>{
  assert.throws(()=>compactFirstRefusalResult({...reduced,
    selectedReportedGuestParity:false},host,{}),/provenance failed/);
  assert.throws(()=>compactFirstRefusalResult(reduced,{...host,
    boardRevision:'different'},{}),/provenance failed/);
});

test('file reducer rejects a host report hash before source reduction',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'first-refusal-test-'));
  try{
    const files=['observed.json','baseline.json','host.json','baseline-time.txt',
      'observed-time.txt','candidate.json'].map(name=>path.join(dir,name));
    fs.writeFileSync(files[0],JSON.stringify({sourceSha256:{}}));
    fs.writeFileSync(files[1],JSON.stringify({sourceSha256:{}}));
    fs.writeFileSync(files[2],JSON.stringify({runs:[
      {arm:'baseline',observer:false,reportSha256:'wrong'},
      {arm:'observed',observer:true,reportSha256:'wrong'}]}));
    for(const file of files.slice(3))fs.writeFileSync(file,'');
    assert.throws(()=>summarizeFirstRefusalFiles(...files),
      /host\/report\/time hashes/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
