#!/usr/bin/env node
// Source-bound paired reduction of an opt-in, execution-neutral admission run.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {summarizeI80386CrossModePotentialTrace} from
  './summarize-i80386-cross-mode-potential-trace.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const MODES=['real','protected16','vm86','protected32'];
const count=object=>Object.values(object??{}).reduce((n,value)=>n+value,0);
const sum=(modes,field)=>MODES.reduce((n,mode)=>n+modes[mode][field],0);

export function summarizeI80386FormResolvedAdmission(raw,baseline,options={}){
  if(baseline.crossModeTraceObserver!==undefined)
    throw new Error('baseline must have all cross-mode observation disabled');
  const base=summarizeI80386CrossModePotentialTrace(raw,baseline,options);
  const typed=base.observer.formResolvedPotential;
  if(typed?.schema!=='bw.i80386-form-resolved-admission.v1'||
      typed.grammar!=='typed-mov-cmp-test-group7-short-control-byte-io.v1'||
      typed.maxRun!==base.observer.maxRun||!typed.modes)
    throw new Error('missing or mismatched form-resolved admission report');
  for(const mode of MODES){
    const bucket=typed.modes[mode],ordinary=base.observer.modes[mode];
    if(!bucket||!ordinary)throw new Error(`missing ${mode} mode`);
    const entries=Object.entries(bucket.runLengthHistogram??{});
    if(entries.some(([length,n])=>!Number.isInteger(Number(length))||
        Number(length)<1||Number(length)>typed.maxRun||
        !Number.isInteger(n)||n<0))
      throw new Error(`invalid typed run histogram in ${mode}`);
    const admitted=entries.reduce((n,[length,c])=>n+Number(length)*c,0);
    const long=entries.reduce((n,[length,c])=>n+
      (Number(length)>=8?Number(length)*c:0),0);
    if(bucket.eligibleRetiredOrdinals!==ordinary.eligibleRetiredOrdinals||
        bucket.eligibleRetiredOrdinals!==bucket.admittedOrdinals+
          bucket.refusedOrdinals||admitted!==bucket.admittedOrdinals||
        count(bucket.runLengthHistogram)!==bucket.runs||
        count(bucket.runEndReasons)!==bucket.runs||
        count(bucket.observedPrefixSignatures)!==bucket.eligibleRetiredOrdinals||
        count(bucket.observedOpcodeCounts)!==bucket.eligibleRetiredOrdinals||
        long!==bucket.ordinalsInRunsAtLeast8||
        count(bucket.refusals)!==bucket.refusedOrdinals||
        count(bucket.admittedFormCounts)!==admitted||
        count(bucket.longRunFormCounts)!==long||
        count(bucket.admittedAccessClasses)!==admitted||
        count(bucket.admittedEaClasses)!==admitted||
        count(bucket.longRunAccessClasses)!==long||
        bucket.optimisticIoOrdinalsInRunsAtLeast8>long||
        long>ordinary.ordinalsInRunsAtLeast8)
      throw new Error(`typed admission partition mismatch in ${mode}`);
  }
  const context=typed.firstRefusalContext;
  if(options.requireFirstRefusalContext&&!context)
    throw new Error('missing required first-refusal context');
  if(context){
    if(context.schema!=='bw.i80386-first-refusal-context.v1'||
        context.maxRun!==typed.maxRun||!context.modes)
      throw new Error('first-refusal context schema or run budget mismatch');
    for(const mode of MODES){
      const bucket=context.modes[mode],typedBucket=typed.modes[mode];
      if(!bucket)throw new Error(`missing first-refusal mode ${mode}`);
      const records=Object.values(bucket.records??{});
      const sum=field=>records.reduce((n,entry)=>n+entry[field],0);
      const validHistogram=(histogram,count)=>histogram&&
        Object.entries(histogram).every(([length,n])=>
          Number.isInteger(Number(length))&&Number(length)>=0&&
          Number(length)<=context.maxRun&&Number.isInteger(n)&&n>=0)&&
        count===Object.values(histogram).reduce((n,value)=>n+value,0);
      if(bucket.refusedOrdinals!==typedBucket.refusedOrdinals||
          bucket.followingResolved!==bucket.refusedOrdinals||
          sum('count')!==bucket.refusedOrdinals||
          sum('followingResolved')!==bucket.refusedOrdinals||
          sum('bridgeAtLeast4')!==bucket.bridgeAtLeast4||
          sum('bridgeAtLeast8')!==bucket.bridgeAtLeast8||
          records.some(entry=>!validHistogram(entry.precedingLengthHistogram,
            entry.count)||!validHistogram(entry.followingLengthHistogram,
            entry.count)||count(entry.followingEndReasons)!==entry.count||
            entry.bridgeAtLeast8>entry.bridgeAtLeast4||
            entry.bridgeAtLeast4>entry.count))
        throw new Error(`first-refusal context partition mismatch in ${mode}`);
    }
    if(context.refusedOrdinals!==sum(context.modes,'refusedOrdinals')||
        context.bridgeAtLeast4!==sum(context.modes,'bridgeAtLeast4')||
        context.bridgeAtLeast8!==sum(context.modes,'bridgeAtLeast8'))
      throw new Error('first-refusal context aggregate mismatch');
  }
  const long=sum(typed.modes,'ordinalsInRunsAtLeast8');
  const long16=typed.modes.protected16.ordinalsInRunsAtLeast8+
    typed.modes.vm86.ordinalsInRunsAtLeast8;
  if(typed.eligibleRetiredOrdinals!==sum(typed.modes,'eligibleRetiredOrdinals')||
      typed.admittedOrdinals!==sum(typed.modes,'admittedOrdinals')||
      typed.refusedOrdinals!==sum(typed.modes,'refusedOrdinals')||
      typed.disjointRuns!==sum(typed.modes,'runs')||
      typed.uniqueOrdinalsInRunsAtLeast8!==long||
      typed.protected16OrVm86OrdinalsInRunsAtLeast8!==long16||
      typed.optimisticIoOrdinalsInRunsAtLeast8!==
        sum(typed.modes,'optimisticIoOrdinalsInRunsAtLeast8')||
      typed.predeclaredSubsetOpportunityPassed!==
        (long>=15_000_000&&long16>=5_000_000))
    throw new Error('typed admission aggregate or predeclared gate mismatch');
  return {schema:'bw.i80386-form-resolved-admission-receipt.v1',
    sourceRevision:base.sourceRevision,sourceHashesVerified:base.sourceHashesVerified,
    sourceHashDifferences:base.sourceHashDifferences,
    privateRawReportSha256:base.privateRawReportSha256,
    privateBaselineReportSha256:base.privateBaselineReportSha256,
    completedSteps:base.completedSteps,
    guestReportedFieldDifferences:base.guestReportedFieldDifferences,
    inputPinDifferences:base.inputPinDifferences,
    unexpectedReportedDifferencePaths:base.unexpectedReportedDifferencePaths,
    selectedReportedGuestParity:base.selectedReportedGuestParity,
    formResolvedPotential:typed};
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const requireFirstRefusalContext=process.argv.includes('--require-first-refusal-context');
  const [rawPath,baselinePath]=process.argv.slice(2).filter(arg=>
    arg!=='--require-first-refusal-context');
  if(!rawPath||!baselinePath)
    throw new Error('usage: summarize-i80386-form-resolved-admission.mjs raw.json baseline.json');
  const rawBytes=fs.readFileSync(rawPath),baselineBytes=fs.readFileSync(baselinePath);
  const raw=JSON.parse(rawBytes),baseline=JSON.parse(baselineBytes);
  const sourceBlobs={};
  for(const path of Object.keys(raw.sourceSha256??{})){
    const repositoryPath=path.startsWith('../')?path.slice(3):path.startsWith('./')?
      `scripts/${path.slice(2)}`:path;
    sourceBlobs[path]=execFileSync('git',
      ['show',`${raw.executionRevision}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  const receipt=summarizeI80386FormResolvedAdmission(raw,baseline,{
    rawSha256:sha(rawBytes),baselineSha256:sha(baselineBytes),sourceBlobs,
    requireFirstRefusalContext});
  if(!receipt.selectedReportedGuestParity||!receipt.sourceHashesVerified)
    throw new Error('guest or source parity failed; refusing public receipt');
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}
