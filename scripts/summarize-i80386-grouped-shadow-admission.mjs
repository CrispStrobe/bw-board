#!/usr/bin/env node
// Source-bound paired reduction of the opt-in grouped shadow admission replay.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {summarizeI80386CrossModePotentialTrace} from
  './summarize-i80386-cross-mode-potential-trace.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const MODES=['real','protected16','vm86','protected32'];
const sum=(modes,field)=>MODES.reduce((n,mode)=>n+modes[mode][field],0);
const count=object=>Object.values(object??{}).reduce((n,value)=>n+value,0);
const numberMap=object=>object&&Object.values(object).every(value=>
  Number.isSafeInteger(value)&&value>=0);
const GROUPED_GRAMMAR=
  'typed-mov-cmp-test-group7-short-control-byte-io-plus-a8-8d-0b-31-ff0.v1';
const ADMITTED_OPCODES=new Set(['88','89','8a','8b','39','3a','3b',
  '84','85','80','81','83','3c','3d','e4','e6','ec','ee','eb',
  ...Array.from({length:16},(_,i)=>(0x70+i).toString(16)),
  'a8','8d','0b','31','ff']);

export function summarizeI80386GroupedShadowAdmission(raw,baseline,options={}){
  if(baseline.crossModeTraceObserver!==undefined)
    throw new Error('baseline must have all cross-mode observation disabled');
  const base=summarizeI80386CrossModePotentialTrace(raw,baseline,options);
  const typed=base.observer.groupedShadowPotential;
  if(base.observer.formResolvedPotential!==undefined||
      typed?.schema!=='bw.i80386-grouped-shadow-admission.v1'||
      typed.grammar!==GROUPED_GRAMMAR||
      typed.maxRun!==base.observer.maxRun||!typed.modes||
      typed.firstRefusalContext!==undefined)
    throw new Error('missing or mismatched grouped shadow report');
  for(const mode of MODES){
    const bucket=typed.modes[mode],ordinary=base.observer.modes[mode];
    if(!bucket||!ordinary)throw new Error(`missing ${mode} mode`);
    const entries=Object.entries(bucket.runLengthHistogram??{});
    if(entries.some(([length,n])=>!Number.isInteger(Number(length))||
        Number(length)<1||Number(length)>typed.maxRun||
        !Number.isSafeInteger(n)||n<0))
      throw new Error(`invalid grouped run histogram in ${mode}`);
    const admitted=entries.reduce((n,[length,c])=>n+Number(length)*c,0);
    const long=entries.reduce((n,[length,c])=>n+
      (Number(length)>=8?Number(length)*c:0),0);
    const maps=['runEndReasons','refusals','observedPrefixSignatures',
      'observedOpcodeCounts','admittedFormCounts','longRunFormCounts',
      'admittedAccessClasses','longRunAccessClasses','admittedEaClasses',
      'admittedModrmShapes'];
    if(maps.some(name=>!numberMap(bucket[name]))||
        bucket.eligibleRetiredOrdinals!==ordinary.eligibleRetiredOrdinals||
        bucket.eligibleRetiredOrdinals!==bucket.admittedOrdinals+
          bucket.refusedOrdinals||
        admitted!==bucket.admittedOrdinals||
        count(bucket.runLengthHistogram)!==bucket.runs||
        count(bucket.runEndReasons)!==bucket.runs||
        count(bucket.refusals)!==bucket.refusedOrdinals||
        count(bucket.observedPrefixSignatures)!==bucket.eligibleRetiredOrdinals||
        count(bucket.observedOpcodeCounts)!==bucket.eligibleRetiredOrdinals||
        count(bucket.admittedFormCounts)!==admitted||
        count(bucket.admittedAccessClasses)!==admitted||
        count(bucket.admittedEaClasses)!==admitted||
        count(bucket.longRunFormCounts)!==long||
        count(bucket.longRunAccessClasses)!==long||
        long!==bucket.ordinalsInRunsAtLeast8||
        bucket.optimisticIoOrdinalsInRunsAtLeast8>long||
        long>ordinary.ordinalsInRunsAtLeast8)
      throw new Error(`grouped shadow partition mismatch in ${mode}`);
    for(const formKey of Object.keys(bucket.admittedFormCounts)){
      const opcode=formKey.slice(0,2);
      if(!ADMITTED_OPCODES.has(opcode)||
          opcode==='ff'&&!/\:m[0-3]r0b[0-7]/.test(formKey)||
          opcode==='8d'&&/\:m3r[0-7]b[0-7]/.test(formKey)||
          ['80','81','83'].includes(opcode)&&
            !/\:m[0-3]r7b[0-7]/.test(formKey))
        throw new Error(`deferred form admitted in ${mode}: ${formKey}`);
    }
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
    throw new Error('grouped shadow aggregate or gate mismatch');
  return {schema:'bw.i80386-grouped-shadow-admission-receipt.v1',
    sourceRevision:base.sourceRevision,
    sourceHashesVerified:base.sourceHashesVerified,
    sourceHashDifferences:base.sourceHashDifferences,
    privateRawReportSha256:base.privateRawReportSha256,
    privateBaselineReportSha256:base.privateBaselineReportSha256,
    completedSteps:base.completedSteps,
    guestReportedFieldDifferences:base.guestReportedFieldDifferences,
    inputPinDifferences:base.inputPinDifferences,
    unexpectedReportedDifferencePaths:base.unexpectedReportedDifferencePaths,
    selectedReportedGuestParity:base.selectedReportedGuestParity,
    groupedShadowPotential:typed};
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const [rawPath,baselinePath]=process.argv.slice(2);
  if(!rawPath||!baselinePath)
    throw new Error('usage: summarize-i80386-grouped-shadow-admission.mjs observed.json baseline.json');
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
  const receipt=summarizeI80386GroupedShadowAdmission(raw,baseline,{
    rawSha256:sha(rawBytes),baselineSha256:sha(baselineBytes),sourceBlobs});
  if(!receipt.selectedReportedGuestParity||!receipt.sourceHashesVerified)
    throw new Error('guest or source parity failed; refusing public receipt');
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}
