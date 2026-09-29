#!/usr/bin/env node
// Bounded public view of a private source-bound grouped-refusal pair.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {summarizeI80386GroupedFirstRefusalContext} from
  './summarize-i80386-grouped-first-refusal-context.mjs';

const MODES=['real','protected16','vm86','protected32'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const empty=items=>Array.isArray(items)&&items.length===0;
const sum=(records,key)=>records.reduce((n,record)=>n+record[key],0);

export function compactGroupedFirstRefusalResult(reduced,evidenceSha256){
  if(reduced.schema!=='bw.i80386-grouped-shadow-admission-receipt.v1'||
      reduced.completedSteps!==60_000_000||
      reduced.sourceHashesVerified!==true||
      reduced.selectedReportedGuestParity!==true||
      !empty(reduced.sourceHashDifferences)||
      !empty(reduced.inputPinDifferences)||
      !empty(reduced.guestReportedFieldDifferences)||
      !empty(reduced.unexpectedReportedDifferencePaths))
    throw new Error('source, input, or selected guest parity failed');
  const grouped=reduced.groupedShadowPotential;
  const context=grouped?.firstRefusalContext;
  if(grouped?.schema!=='bw.i80386-grouped-shadow-admission.v1'||
      context?.schema!=='bw.i80386-grouped-first-refusal-context.v1')
    throw new Error('missing grouped first-refusal report');
  const modes={};
  for(const mode of MODES){
    const bucket=context.modes?.[mode];
    const groupedBucket=grouped.modes?.[mode];
    if(!bucket||!groupedBucket||!bucket.records||
        bucket.refusedOrdinals!==bucket.selectedRefusals+bucket.unselectedRefusals||
        bucket.refusedOrdinals!==groupedBucket.refusedOrdinals)
      throw new Error(`refusal partition mismatch in ${mode}`);
    const records=Object.entries(bucket.records);
    if(sum(records.map(([,entry])=>entry),'count')!==bucket.selectedRefusals||
        sum(records.map(([,entry])=>entry),'bridgeAtLeast4')!==bucket.bridgeAtLeast4||
        sum(records.map(([,entry])=>entry),'bridgeAtLeast8')!==bucket.bridgeAtLeast8)
      throw new Error(`refusal record sum mismatch in ${mode}`);
    const groupedOpcodes=new Map();
    for(const [,record] of records){
      const item=groupedOpcodes.get(record.opcode)??{opcode:record.opcode,
        refusedOrdinals:0,bridgeAtLeast4:0,bridgeAtLeast8:0};
      item.refusedOrdinals+=record.count;
      item.bridgeAtLeast4+=record.bridgeAtLeast4;
      item.bridgeAtLeast8+=record.bridgeAtLeast8;
      groupedOpcodes.set(record.opcode,item);
    }
    const topBridgeOpcodes=[...groupedOpcodes.values()]
      .filter(item=>item.bridgeAtLeast4>0)
      .sort((a,b)=>b.bridgeAtLeast4-a.bridgeAtLeast4||
        b.refusedOrdinals-a.refusedOrdinals||a.opcode.localeCompare(b.opcode))
      .slice(0,8);
    const topBridgeForms=records.filter(([,entry])=>entry.bridgeAtLeast4>0)
      .sort(([keyA,a],[keyB,b])=>b.bridgeAtLeast4-a.bridgeAtLeast4||
        b.count-a.count||keyA.localeCompare(keyB))
      .slice(0,5).map(([,entry])=>({reason:entry.reason,opcode:entry.opcode,
        prefixSignature:entry.prefixSignature,operandWidth:entry.operandWidth,
        addressWidth:entry.addressWidth,modrm:entry.modrm,
        eaClass:entry.eaClass,observedAccess:entry.observedAccess,
        refusedOrdinals:entry.count,bridgeAtLeast4:entry.bridgeAtLeast4,
        bridgeAtLeast8:entry.bridgeAtLeast8}));
    modes[mode]={refusedOrdinals:bucket.refusedOrdinals,
      selectedRefusals:bucket.selectedRefusals,
      unselectedRefusals:bucket.unselectedRefusals,
      bridgeAtLeast4:bucket.bridgeAtLeast4,
      bridgeAtLeast8:bucket.bridgeAtLeast8,
      topBridgeOpcodes,topBridgeForms};
  }
  for(const field of ['refusedOrdinals','selectedRefusals','unselectedRefusals',
    'bridgeAtLeast4','bridgeAtLeast8'])
    if(MODES.reduce((n,mode)=>n+modes[mode][field],0)!==context[field])
      throw new Error(`aggregate ${field} mismatch`);
  if(context.refusedOrdinals!==grouped.refusedOrdinals||
      grouped.predeclaredSubsetOpportunityPassed!==
        (grouped.uniqueOrdinalsInRunsAtLeast8>=15_000_000&&
         grouped.protected16OrVm86OrdinalsInRunsAtLeast8>=5_000_000))
    throw new Error('grouped coverage mismatch');
  const protected16OrVm86BridgeAtLeast4=
    modes.protected16.bridgeAtLeast4+modes.vm86.bridgeAtLeast4;
  return {schema:'bw.i80386-grouped-first-refusal-result.v1',
    sourceRevision:reduced.sourceRevision,completedSteps:reduced.completedSteps,
    sourceHashesVerified:true,selectedReportedGuestParity:true,
    privateEvidenceSha256:evidenceSha256,
    groupedAdmission:{eligibleRetiredOrdinals:grouped.eligibleRetiredOrdinals,
      admittedOrdinals:grouped.admittedOrdinals,
      refusedOrdinals:grouped.refusedOrdinals,
      uniqueOrdinalsInRunsAtLeast8:grouped.uniqueOrdinalsInRunsAtLeast8,
      protected16OrVm86OrdinalsInRunsAtLeast8:
        grouped.protected16OrVm86OrdinalsInRunsAtLeast8,
      predeclaredSubsetOpportunityPassed:
        grouped.predeclaredSubsetOpportunityPassed},
    firstRefusal:{refusedOrdinals:context.refusedOrdinals,
      selectedRefusals:context.selectedRefusals,
      unselectedRefusals:context.unselectedRefusals,
      bridgeAtLeast4:context.bridgeAtLeast4,
      bridgeAtLeast8:context.bridgeAtLeast8,modes},
    predeclaredTriageGate:{overall:250_000,protected16OrVm86:100_000,
      protected16OrVm86BridgeAtLeast4,
      passed:context.bridgeAtLeast4>=250_000&&
        protected16OrVm86BridgeAtLeast4>=100_000},
    limitation:'Local adjacent-run bridges overlap and are not disjoint retired-run coverage or executor feasibility; diagnostic runtime is instrumentation overhead, not speed evidence.'};
}

export function summarizeGroupedFirstRefusalFiles(observedPath,baselinePath,candidatePath){
  const observedBytes=fs.readFileSync(observedPath);
  const baselineBytes=fs.readFileSync(baselinePath);
  const candidateBytes=fs.readFileSync(candidatePath);
  const observed=JSON.parse(observedBytes),baseline=JSON.parse(baselineBytes);
  const candidate=JSON.parse(candidateBytes);
  if(candidate.privateRawReportSha256!==sha(observedBytes)||
      candidate.privateBaselineReportSha256!==sha(baselineBytes))
    throw new Error('source-bound candidate private report hashes differ');
  const sourceBlobs={};
  for(const file of Object.keys(observed.sourceSha256??{})){
    const repositoryPath=file.startsWith('../')?file.slice(3):file.startsWith('./')?
      `scripts/${file.slice(2)}`:file;
    sourceBlobs[file]=execFileSync('git',
      ['show',`${observed.executionRevision}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  const reduced=summarizeI80386GroupedFirstRefusalContext(observed,baseline,{
    rawSha256:sha(observedBytes),baselineSha256:sha(baselineBytes),sourceBlobs});
  if(JSON.stringify(reduced)!==JSON.stringify(candidate))
    throw new Error('source-bound candidate differs from independent reduction');
  return compactGroupedFirstRefusalResult(reduced,{
    baselineReport:sha(baselineBytes),observedReport:sha(observedBytes),
    sourceBoundCandidate:sha(candidateBytes)});
}

export function serializeCompactGroupedFirstRefusalResult(result){
  const output=JSON.stringify(result,null,2)+'\n';
  if(Buffer.byteLength(output)>32*1024)
    throw new Error('compact result exceeds 32 KiB');
  return output;
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const args=process.argv.slice(2);
  if(args.length!==3)throw new Error('usage: summarize-i80386-grouped-first-refusal-result.mjs observed.json baseline.json source-bound-candidate.json');
  process.stdout.write(serializeCompactGroupedFirstRefusalResult(
    summarizeGroupedFirstRefusalFiles(...args)));
}
