#!/usr/bin/env node
// Source-bound, media-neutral reduction of a paired ordinary/observer report.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const MODES=['real','protected16','vm86','protected32'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sum=(map)=>Object.values(map??{}).reduce((n,value)=>n+value,0);
const hex64=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const count=(modes,key)=>MODES.reduce((n,mode)=>n+modes[mode][key],0);
const strip=(report,workload)=>{
  const copy=structuredClone(report);
  delete copy.crossModeTraceObserver;
  if(workload==='windows')delete copy.inputs.registerStackAdmission;
  else delete copy.registerStackAdmission;
  return copy;
};

export function reduceI80386RegisterStackResult(observed,baseline,{
  workload,sourceBlobs,observedSha256,baselineSha256}={}){
  if(!['windows','xv6'].includes(workload))throw new Error('unknown workload');
  const flag=report=>workload==='windows'?
    report.inputs?.registerStackAdmission:report.registerStackAdmission;
  if(flag(observed)!==true||flag(baseline)!==false||
      baseline.crossModeTraceObserver!==undefined||
      observed.executionRevision!==baseline.executionRevision||
      !/^[0-9a-f]{40}$/.test(observed.executionRevision??'')||
      !same(observed.sourceSha256,baseline.sourceSha256)||
      !same(Object.keys(observed.sourceSha256??{}).sort(),
        Object.keys(sourceBlobs??{}).sort()))
    throw new Error('variant, revision, or source map mismatch');
  const required=['../src/experimental/i80386.js',
    '../src/experimental/i80386-at-machine.js',
    '../src/experimental/i80386-cross-mode-potential-trace-observer.js',
    '../src/experimental/i80386-form-resolved-admission.js',
    '../src/experimental/i80386-expanded-grouped-admission.js',
    '../src/experimental/i80386-register-stack-admission.js',
    './summarize-i80386-register-stack-result.mjs',
    workload==='windows'?'./run-i80386-at-console.mjs':
      './probe-xv6-stock.mjs'];
  if(required.some(file=>!Object.hasOwn(observed.sourceSha256,file)))
    throw new Error('incomplete variant source inventory');
  for(const [file,expected] of Object.entries(observed.sourceSha256))
    if(!hex64(expected)||sha(sourceBlobs[file])!==expected)
      throw new Error(`committed source mismatch: ${file}`);
  if(!same(strip(observed,workload),strip(baseline,workload)))
    throw new Error('whole reported guest/input state differs beyond diagnostic field and flag');
  if(!Number.isSafeInteger(observed.steps)||observed.steps<1||
      workload==='windows'&&(observed.steps!==60_000_000||
        observed.stop!=='budget')||
      !hex64(observed.ramSha256)||!hex64(baseline.ramSha256)||
      !hex64(observed.diskSha256)||!hex64(baseline.diskSha256)||
      workload==='xv6'&&(!hex64(observed.filesystemDiskSha256)||
        !hex64(baseline.filesystemDiskSha256)))
    throw new Error('incomplete workload or final RAM/disk hashes');
  const observer=observed.crossModeTraceObserver;
  const typed=observer?.registerStackPotential;
  if(observer?.schema!=='bw.i80386-cross-mode-potential-trace-observer.v1'||
      typed?.schema!=='bw.i80386-register-stack-admission.v1'||
      typed.grammar!=='typed-grouped-plus-owned-es-call-return-register-stack.v1'||
      typed.maxRun!==64||!typed.modes)
    throw new Error('wrong observer variant or grammar');
  const modes={};
  const entryAttempts=MODES.reduce((n,mode)=>n+
    (observer.modes?.[mode]?.entryAttempts??0),0);
  if(entryAttempts!==observed.steps)
    throw new Error('observer entry attempts differ from completed workload steps');
  for(const mode of MODES){
    const bucket=typed.modes[mode],ordinary=observer.modes?.[mode];
    if(!bucket||!ordinary)throw new Error(`missing mode ${mode}`);
    const entries=Object.entries(bucket.runLengthHistogram??{});
    if(entries.some(([length,n])=>!/^[1-9]\d*$/.test(length)||
        Number(length)>64||!Number.isSafeInteger(n)||n<0))
      throw new Error(`invalid run histogram ${mode}`);
    const admitted=entries.reduce((n,[length,c])=>n+Number(length)*c,0);
    const long=entries.reduce((n,[length,c])=>n+
      (Number(length)>=8?Number(length)*c:0),0);
    const cut=sum(bucket.typedCandidatesCutByGlobal);
    if(bucket.eligibleRetiredOrdinals!==ordinary.eligibleRetiredOrdinals||
        ordinary.entryAttempts!==ordinary.completedStepCalls+
          ordinary.noRetirement+ordinary.abortedCalls||
        ordinary.completedStepCalls!==ordinary.repeatIterationCalls+
          ordinary.eligibleRetiredOrdinals||
        bucket.eligibleRetiredOrdinals!==bucket.admittedOrdinals+
          bucket.refusedOrdinals||
        admitted!==bucket.admittedOrdinals||long!==bucket.ordinalsInRunsAtLeast8||
        sum(bucket.runLengthHistogram)!==bucket.runs||
        sum(bucket.runEndReasons)!==bucket.runs||
        sum(bucket.refusals)!==bucket.refusedOrdinals||
        sum(bucket.admittedFormCounts)!==admitted||
        sum(bucket.longRunFormCounts)!==long||
        sum(bucket.typedCandidatesCutByGlobalOpcode)!==cut||
        cut>bucket.refusedOrdinals||long>ordinary.ordinalsInRunsAtLeast8)
      throw new Error(`typed partition or global cut mismatch ${mode}`);
    modes[mode]={eligibleRetiredOrdinals:bucket.eligibleRetiredOrdinals,
      admittedOrdinals:bucket.admittedOrdinals,
      refusedOrdinals:bucket.refusedOrdinals,disjointRuns:bucket.runs,
      uniqueOrdinalsInRunsAtLeast8:long,
      runLengthHistogram:bucket.runLengthHistogram,
      refusals:bucket.refusals,
      typedCandidatesCutByGlobal:bucket.typedCandidatesCutByGlobal,
      typedCandidatesCutByGlobalOpcode:bucket.typedCandidatesCutByGlobalOpcode,
      admittedSpecialForms:Object.fromEntries(Object.entries(
        bucket.admittedFormCounts).filter(([key])=>
        /^(8e|e8|c3|5[0-9a-f]):/.test(key)||
        key.startsWith('ff:')&&/:m[0-2]r2b/.test(key)))};
  }
  const long=count(modes,'uniqueOrdinalsInRunsAtLeast8');
  const long16=modes.protected16.uniqueOrdinalsInRunsAtLeast8+
    modes.vm86.uniqueOrdinalsInRunsAtLeast8;
  if(typed.eligibleRetiredOrdinals!==count(modes,'eligibleRetiredOrdinals')||
      typed.admittedOrdinals!==count(modes,'admittedOrdinals')||
      typed.refusedOrdinals!==count(modes,'refusedOrdinals')||
      typed.disjointRuns!==count(modes,'disjointRuns')||
      typed.uniqueOrdinalsInRunsAtLeast8!==long||
      typed.protected16OrVm86OrdinalsInRunsAtLeast8!==long16||
      typed.typedCandidatesCutByGlobal!==MODES.reduce((n,mode)=>n+
        sum(modes[mode].typedCandidatesCutByGlobal),0)||
      typed.predeclaredSubsetOpportunityPassed!==
        (long>=15_000_000&&long16>=5_000_000))
    throw new Error('aggregate, disjoint coverage, or gate mismatch');
  return {schema:'bw.i80386-register-stack-result.v1',workload,
    sourceRevision:observed.executionRevision,
    sourceHashesVerified:true,wholeReportParityExceptDiagnostic:true,
    ramAndDiskHashesEqual:true,completedSteps:observed.steps,
    privateEvidenceSha256:{observedReport:observedSha256,
      baselineReport:baselineSha256},
    eligibleRetiredOrdinals:typed.eligibleRetiredOrdinals,
    admittedOrdinals:typed.admittedOrdinals,
    refusedOrdinals:typed.refusedOrdinals,
    disjointRuns:typed.disjointRuns,uniqueOrdinalsInRunsAtLeast8:long,
    protected16OrVm86OrdinalsInRunsAtLeast8:long16,
    typedCandidatesCutByGlobal:typed.typedCandidatesCutByGlobal,
    windowsGate:{applicable:workload==='windows',overall:15_000_000,
      protected16OrVm86:5_000_000,
      passed:workload==='windows'?typed.predeclaredSubsetOpportunityPassed:null},
    modes,limitation:'Execution-neutral observed opportunity only; global identity, event, paging and write cuts remain. No speed or executor claim.'};
}

export function summarizeI80386RegisterStackFiles(observedFile,baselineFile,
  workload){
  const observedBytes=fs.readFileSync(observedFile),
    baselineBytes=fs.readFileSync(baselineFile);
  const observed=JSON.parse(observedBytes),baseline=JSON.parse(baselineBytes);
  const sourceBlobs={};
  for(const file of Object.keys(observed.sourceSha256??{})){
    const repositoryPath=file.startsWith('../')?file.slice(3):file.startsWith('./')?
      `scripts/${file.slice(2)}`:file;
    sourceBlobs[file]=execFileSync('git',
      ['show',`${observed.executionRevision}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  return reduceI80386RegisterStackResult(observed,baseline,{workload,
    sourceBlobs,observedSha256:sha(observedBytes),
    baselineSha256:sha(baselineBytes)});
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const [workload,observedFile,baselineFile]=process.argv.slice(2);
  if(!workload||!observedFile||!baselineFile)
    throw new Error('usage: summarize-i80386-register-stack-result.mjs windows|xv6 observed.json baseline.json');
  process.stdout.write(JSON.stringify(summarizeI80386RegisterStackFiles(
    observedFile,baselineFile,workload),null,2)+'\n');
}
