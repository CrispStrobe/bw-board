#!/usr/bin/env node
// Reduce paired private Windows reports without publishing media or guest text.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const MODES=['real','protected16','vm86','protected32'];
const guestFields=['schema','steps','stop','refusal','cpu','nativeStats',
  'delivered','serial','textRam','vga'];
const inputFields=['bios','vga','hdd','geometry','cmosType','cmosEquipment',
  'events','mouseEnabled'];
const differencePaths=(a,b,path='')=>{
  if(same(a,b))return [];
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&
      !Array.isArray(a)&&!Array.isArray(b))
    return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(key=>
      differencePaths(a[key],b[key],path?`${path}.${key}`:key));
  return [path];
};
const sum=(modes,field)=>MODES.reduce((total,mode)=>total+modes[mode][field],0);

export function summarizeI80386CrossModePotentialTrace(raw,baseline,{
  rawSha256,baselineSha256,sourceBlobs={}}={}){
  const observer=raw.crossModeTraceObserver;
  if(observer?.schema!=='bw.i80386-cross-mode-potential-trace-observer.v1')
    throw new Error('missing cross-mode observer');
  if(raw.steps!==60_000_000||raw.stop!=='budget'||
      baseline.steps!==60_000_000||baseline.stop!=='budget')
    throw new Error('paired reports did not complete pinned 60M budget');
  const guestDifferences=guestFields.filter(field=>!same(raw[field],baseline[field]));
  const inputDifferences=inputFields.filter(field=>
    !same(raw.inputs?.[field],baseline.inputs?.[field]));
  const fullReportedDifferencePaths=differencePaths(raw,baseline);
  const unexpectedReportedDifferencePaths=fullReportedDifferencePaths.filter(path=>
    path!=='executionRevision'&&path!=='sourceSha256'&&
    !path.startsWith('sourceSha256.')&&path!=='crossModeTraceObserver');
  const sourceHashDifferences=Object.entries(sourceBlobs).filter(([path,bytes])=>
    raw.sourceSha256?.[path]!==sha(bytes)).map(([path])=>path);
  if(!observer.modes||MODES.some(mode=>!observer.modes[mode]))
    throw new Error('missing observer mode');
  for(const mode of MODES){
    const bucket=observer.modes[mode];
    const entries=Object.entries(bucket.runLengthHistogram??{});
    const admitted=entries.reduce((n,[length,count])=>n+Number(length)*count,0);
    const long=entries.reduce((n,[length,count])=>
      n+(Number(length)>=8?Number(length)*count:0),0);
    if(bucket.entryAttempts!==bucket.completedStepCalls+bucket.noRetirement+
        bucket.abortedCalls||bucket.completedStepCalls!==
        bucket.repeatIterationCalls+bucket.eligibleRetiredOrdinals||
        bucket.eligibleRetiredOrdinals!==bucket.admittedOrdinals+
        bucket.refusedOrdinals||admitted!==bucket.admittedOrdinals||
        long!==bucket.ordinalsInRunsAtLeast8||
        Object.values(bucket.longRunOpcodeCounts).reduce((a,b)=>a+b,0)!==long||
        bucket.optimisticIoOrdinalsInRunsAtLeast8>long)
      throw new Error(`observer partition mismatch in ${mode}`);
  }
  const long=sum(observer.modes,'ordinalsInRunsAtLeast8');
  const protected16OrVm86Long=observer.modes.protected16.ordinalsInRunsAtLeast8+
    observer.modes.vm86.ordinalsInRunsAtLeast8;
  const gate=long>=30_000_000&&protected16OrVm86Long>=5_000_000;
  if(sum(observer.modes,'entryAttempts')!==raw.steps||
      observer.completedStepCalls!==sum(observer.modes,'completedStepCalls')||
      observer.eligibleRetiredOrdinals!==sum(observer.modes,'eligibleRetiredOrdinals')||
      observer.repeatIterationCalls!==sum(observer.modes,'repeatIterationCalls')||
      observer.noRetirementCalls!==sum(observer.modes,'noRetirement')||
      observer.abortedCalls!==sum(observer.modes,'abortedCalls')||
      observer.uniqueOrdinalsInRunsAtLeast8!==long||
      observer.optimisticIoOrdinalsInRunsAtLeast8!==
        sum(observer.modes,'optimisticIoOrdinalsInRunsAtLeast8')||
      observer.controlTransferOrdinalsInRunsAtLeast8!==
        sum(observer.modes,'controlTransferOrdinalsInRunsAtLeast8')||
      observer.protected16OrVm86OrdinalsInRunsAtLeast8!==protected16OrVm86Long||
      observer.predeclaredOpportunityGatePassed!==gate)
    throw new Error('observer aggregate or gate mismatch');
  return {schema:'bw.i80386-cross-mode-potential-trace-receipt.v1',
    sourceRevision:raw.executionRevision,
    sourceHashDifferences,privateRawReportSha256:rawSha256,
    privateBaselineReportSha256:baselineSha256,
    completedSteps:raw.steps,guestReportedFieldDifferences:guestDifferences,
    inputPinDifferences:inputDifferences,fullReportedDifferencePaths,
    unexpectedReportedDifferencePaths,
    selectedReportedGuestParity:guestDifferences.length===0&&
      inputDifferences.length===0&&unexpectedReportedDifferencePaths.length===0,
    observer};
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const [rawPath,baselinePath]=process.argv.slice(2);
  if(!rawPath||!baselinePath)
    throw new Error('usage: summarize-i80386-cross-mode-potential-trace.mjs raw.json baseline.json');
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
  const receipt=summarizeI80386CrossModePotentialTrace(raw,baseline,{
    rawSha256:sha(rawBytes),baselineSha256:sha(baselineBytes),sourceBlobs});
  if(!receipt.selectedReportedGuestParity||receipt.sourceHashDifferences.length)
    throw new Error('observer guest or source parity failed; refusing public receipt');
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}
