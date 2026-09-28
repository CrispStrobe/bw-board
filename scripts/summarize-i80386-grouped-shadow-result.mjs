#!/usr/bin/env node
// Bounded media-neutral view of the source-bound paired grouped admission result.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {summarizeI80386GroupedShadowAdmission} from
  './summarize-i80386-grouped-shadow-admission.mjs';

const MODES=['real','protected16','vm86','protected32'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const clear=differences=>Array.isArray(differences)&&differences.length===0;
const top=(counts,limit=8)=>Object.entries(counts??{})
  .sort(([a,na],[b,nb])=>nb-na||a.localeCompare(b))
  .slice(0,limit).map(([key,count])=>({key,count}));

export function compactI80386GroupedShadowResult(reduced,evidenceSha256){
  if(reduced.schema!=='bw.i80386-grouped-shadow-admission-receipt.v1'||
      reduced.completedSteps!==60_000_000||
      reduced.sourceHashesVerified!==true||
      reduced.selectedReportedGuestParity!==true||
      !clear(reduced.sourceHashDifferences)||
      !clear(reduced.guestReportedFieldDifferences)||
      !clear(reduced.inputPinDifferences)||
      !clear(reduced.unexpectedReportedDifferencePaths))
    throw new Error('source, input, or selected guest parity failed');
  const typed=reduced.groupedShadowPotential;
  if(typed?.schema!=='bw.i80386-grouped-shadow-admission.v1'||
      typed.predeclaredSubsetOpportunityPassed!==
        (typed.uniqueOrdinalsInRunsAtLeast8>=15_000_000&&
         typed.protected16OrVm86OrdinalsInRunsAtLeast8>=5_000_000))
    throw new Error('missing grouped report or inconsistent opportunity gate');
  const modes={};
  for(const mode of MODES){
    const bucket=typed.modes?.[mode];
    if(!bucket)throw new Error(`missing grouped mode ${mode}`);
    if(bucket.eligibleRetiredOrdinals!==bucket.admittedOrdinals+
        bucket.refusedOrdinals)
      throw new Error(`grouped mode partition mismatch in ${mode}`);
    modes[mode]={eligibleRetiredOrdinals:bucket.eligibleRetiredOrdinals,
      admittedOrdinals:bucket.admittedOrdinals,
      refusedOrdinals:bucket.refusedOrdinals,
      disjointRuns:bucket.runs,
      uniqueOrdinalsInRunsAtLeast8:bucket.ordinalsInRunsAtLeast8,
      optimisticIoOrdinalsInRunsAtLeast8:
        bucket.optimisticIoOrdinalsInRunsAtLeast8,
      admittedAccessClasses:bucket.admittedAccessClasses,
      longRunAccessClasses:bucket.longRunAccessClasses,
      topAdmittedForms:top(bucket.admittedFormCounts),
      topLongRunForms:top(bucket.longRunFormCounts),
      topRefusalReasons:top(bucket.refusals),
      topRunEndReasons:top(bucket.runEndReasons)};
  }
  const total=field=>MODES.reduce((n,mode)=>n+modes[mode][field],0);
  if(total('eligibleRetiredOrdinals')!==typed.eligibleRetiredOrdinals||
      total('admittedOrdinals')!==typed.admittedOrdinals||
      total('refusedOrdinals')!==typed.refusedOrdinals||
      total('disjointRuns')!==typed.disjointRuns||
      total('uniqueOrdinalsInRunsAtLeast8')!==typed.uniqueOrdinalsInRunsAtLeast8||
      modes.protected16.uniqueOrdinalsInRunsAtLeast8+
        modes.vm86.uniqueOrdinalsInRunsAtLeast8!==
          typed.protected16OrVm86OrdinalsInRunsAtLeast8)
    throw new Error('grouped aggregate or disjoint-run count mismatch');
  return {schema:'bw.i80386-grouped-shadow-result.v1',
    sourceRevision:reduced.sourceRevision,
    completedSteps:reduced.completedSteps,
    sourceHashesVerified:true,selectedReportedGuestParity:true,
    privateEvidenceSha256:evidenceSha256,
    eligibleRetiredOrdinals:typed.eligibleRetiredOrdinals,
    admittedOrdinals:typed.admittedOrdinals,
    refusedOrdinals:typed.refusedOrdinals,
    disjointRuns:typed.disjointRuns,
    uniqueOrdinalsInRunsAtLeast8:typed.uniqueOrdinalsInRunsAtLeast8,
    protected16OrVm86OrdinalsInRunsAtLeast8:
      typed.protected16OrVm86OrdinalsInRunsAtLeast8,
    predeclaredGate:{overall:15_000_000,protected16OrVm86:5_000_000,
      passed:typed.predeclaredSubsetOpportunityPassed},
    modes,
    limitation:'Disjoint retired-ordinal opportunity only; ordinary execution supplies optimistic syntax/semantics and synchronous I/O. No executable-backend feasibility or speed claim.'};
}

export function summarizeI80386GroupedShadowFiles(observedPath,baselinePath,
  candidatePath){
  const observedBytes=fs.readFileSync(observedPath);
  const baselineBytes=fs.readFileSync(baselinePath);
  const candidateBytes=fs.readFileSync(candidatePath);
  const observed=JSON.parse(observedBytes),baseline=JSON.parse(baselineBytes);
  const candidate=JSON.parse(candidateBytes);
  if(candidate.privateRawReportSha256!==sha(observedBytes)||
      candidate.privateBaselineReportSha256!==sha(baselineBytes))
    throw new Error('source-bound candidate does not match private report hashes');
  const sourceBlobs={};
  for(const path of Object.keys(observed.sourceSha256??{})){
    const repositoryPath=path.startsWith('../')?path.slice(3):path.startsWith('./')?
      `scripts/${path.slice(2)}`:path;
    sourceBlobs[path]=execFileSync('git',
      ['show',`${observed.executionRevision}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  const rerun=summarizeI80386GroupedShadowAdmission(observed,baseline,{
    rawSha256:sha(observedBytes),baselineSha256:sha(baselineBytes),sourceBlobs});
  if(JSON.stringify(rerun)!==JSON.stringify(candidate))
    throw new Error('candidate differs from rerun source-bound paired reduction');
  return compactI80386GroupedShadowResult(rerun,{
    observedReport:sha(observedBytes),baselineReport:sha(baselineBytes),
    sourceBoundCandidate:sha(candidateBytes)});
}

export function serializeCompactI80386GroupedShadowResult(result){
  const output=JSON.stringify(result,null,2)+'\n';
  if(Buffer.byteLength(output)>32*1024)
    throw new Error('compact grouped-shadow result exceeds 32 KiB bound');
  return output;
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const args=process.argv.slice(2);
  if(args.length!==3)throw new Error('usage: summarize-i80386-grouped-shadow-result.mjs observed.json baseline.json source-bound-candidate.json');
  process.stdout.write(serializeCompactI80386GroupedShadowResult(
    summarizeI80386GroupedShadowFiles(...args)));
}
