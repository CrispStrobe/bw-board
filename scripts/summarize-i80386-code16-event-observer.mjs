#!/usr/bin/env node
// Reduce private Windows reports without emitting media identifiers or guest text.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';

const sha=data=>createHash('sha256').update(data).digest('hex');
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const own=(object,key)=>Object.prototype.hasOwnProperty.call(object,key);
const modeNames=['real','protected16','vm86','protected32'];
const guestFields=['schema','steps','stop','refusal','cpu','nativeStats',
  'delivered','serial','textRam','vga'];
const inputFields=['bios','vga','hdd','geometry','cmosType','cmosEquipment',
  'events','mouseEnabled'];
const differencePaths=(a,b,path='')=>{
  if(equal(a,b))return [];
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&
      !Array.isArray(a)&&!Array.isArray(b))
    return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(key=>
      differencePaths(a[key],b[key],path?`${path}.${key}`:key));
  return [path];
};
const expectedReportedDifference=path=>
  path==='executionRevision'||path==='sourceSha256'||
  path.startsWith('sourceSha256.')||
  path==='code16EventObserver'||path==='inputs.code16Wasm'||
  path==='code16WasmStats'||path==='code16WasmDiagnostics';

export function summarizeI80386Code16EventObserver(raw,baseline,{rawSha256,
  baselineSha256,sourceBlobs={}}={}){
  const observer=raw.code16EventObserver;
  if(observer?.schema!=='bw.i80386-code16-event-run-observer.v1')
    throw new Error('missing code16 event-run observer');
  if(raw.steps!==60_000_000||raw.stop!=='budget')
    throw new Error('observer did not complete pinned 60M budget');
  const guestDifferences=guestFields.filter(field=>!equal(raw[field],baseline[field]));
  const inputDifferences=inputFields.filter(field=>
    !equal(raw.inputs?.[field],baseline.inputs?.[field]));
  const fullReportedDifferencePaths=differencePaths(raw,baseline);
  const unexpectedReportedDifferencePaths=fullReportedDifferencePaths.filter(
    path=>!expectedReportedDifference(path));
  const sourceDifferences=[];
  for(const [path,bytes] of Object.entries(sourceBlobs))
    if(raw.sourceSha256?.[path]!==sha(bytes))sourceDifferences.push(path);
  const perMode={};
  for(const mode of modeNames){
    const bucket=observer.modes?.[mode];
    if(!bucket)throw new Error(`missing mode ${mode}`);
    const histogram=Object.entries(bucket.runLengthHistogram??{});
    const summed=histogram.reduce((value,[length,count])=>
      value+Number(length)*count,0);
    const long=histogram.reduce((value,[length,count])=>
      value+(Number(length)>=4?Number(length)*count:0),0);
    if(bucket.entryAttempts!==bucket.retiredSteps+bucket.noRetirement+
        bucket.abortedCalls||bucket.retiredSteps!==bucket.admittedOrdinals+
        bucket.refusedOrdinals||summed!==bucket.admittedOrdinals||
        long!==bucket.stepsInRunsAtLeast4)
      throw new Error(`observer partition mismatch in ${mode}`);
    perMode[mode]={entryAttempts:bucket.entryAttempts,
      retiredSteps:bucket.retiredSteps,noRetirement:bucket.noRetirement,
      abortedCalls:bucket.abortedCalls,
      admittedOrdinals:bucket.admittedOrdinals,
      refusedOrdinals:bucket.refusedOrdinals,runs:bucket.runs,
      runLengthHistogram:bucket.runLengthHistogram,
      stepsInRunsAtLeast4:bucket.stepsInRunsAtLeast4,
      runEndReasons:bucket.runEndReasons,refusals:bucket.refusals};
  }
  const eligible=modeNames.filter(mode=>mode!=='protected32');
  const denominator=eligible.reduce((sum,mode)=>sum+perMode[mode].retiredSteps,0);
  const admitted=eligible.reduce((sum,mode)=>sum+perMode[mode].admittedOrdinals,0);
  const runs=eligible.reduce((sum,mode)=>sum+perMode[mode].runs,0);
  const long=eligible.reduce((sum,mode)=>sum+perMode[mode].stepsInRunsAtLeast4,0);
  if(denominator!==observer.denominator16BitRetiredOrdinals||
      admitted!==observer.admitted16BitOrdinals||
      runs!==observer.disjointRuns16Bit||
      long!==observer.uniqueOrdinalsInRunsAtLeast4)
    throw new Error('observer aggregate mismatch');
  const mean=runs?admitted/runs:0,coverage=denominator?long/denominator:0;
  const feasibilityPassed=mean>=4&&coverage>=0.25;
  if(!equal(feasibilityPassed,observer.feasibilityPassed)||
      !equal(mean,observer.meanAllAdmittedRunLength)||
      !equal(coverage,observer.longRunCoverageOf16BitRetirements))
    throw new Error('observer gate mismatch');
  return {schema:'bw.i80386-code16-event-observer-receipt.v1',
    sourceRevision:raw.executionRevision,
    sourceSha256:{
      observer:raw.sourceSha256?.['../src/experimental/i80386-code16-event-run-observer.js'],
      runner:raw.sourceSha256?.['./run-i80386-at-console.mjs'],
      core:raw.sourceSha256?.['../src/experimental/i80386.js'],
      board:raw.sourceSha256?.['../src/experimental/i80386-at-machine.js']},
    sourceHashDifferences:sourceDifferences,
    privateRawReportSha256:rawSha256,
    privateBaselineReportSha256:baselineSha256,
    completedSteps:raw.steps,guestReportedFieldDifferences:guestDifferences,
    inputPinDifferences:inputDifferences,
    fullReportedDifferencePaths,unexpectedReportedDifferencePaths,
    selectedReportedGuestParity:guestDifferences.length===0&&
      inputDifferences.length===0&&unexpectedReportedDifferencePaths.length===0,
    observer:{maxRun:observer.maxRun,modes:perMode,
      deviceReads:observer.deviceReads,deviceWrites:observer.deviceWrites,
      denominator16BitRetiredOrdinals:denominator,
      admitted16BitOrdinals:admitted,disjointRuns16Bit:runs,
      meanAllAdmittedRunLength:mean,
      uniqueOrdinalsInRunsAtLeast4:long,
      longRunCoverageOf16BitRetirements:coverage,
      feasibilityPassed}};
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const [rawPath,baselinePath]=process.argv.slice(2);
  if(!rawPath||!baselinePath)throw new Error('usage: summarize... raw.json baseline.json');
  const rawBytes=fs.readFileSync(rawPath),baselineBytes=fs.readFileSync(baselinePath);
  const raw=JSON.parse(rawBytes),baseline=JSON.parse(baselineBytes);
  const sourceBlobs={};
  for(const [key,path] of [
    ['../src/experimental/i80386-code16-event-run-observer.js',
      'src/experimental/i80386-code16-event-run-observer.js'],
    ['./run-i80386-at-console.mjs','scripts/run-i80386-at-console.mjs'],
    ['../src/experimental/i80386.js','src/experimental/i80386.js'],
    ['../src/experimental/i80386-at-machine.js',
      'src/experimental/i80386-at-machine.js']]){
    sourceBlobs[key]=execFileSync('git',['show',`${raw.executionRevision}:${path}`],
      {cwd:new URL('..',import.meta.url)});
  }
  const receipt=summarizeI80386Code16EventObserver(raw,baseline,{
    rawSha256:sha(rawBytes),baselineSha256:sha(baselineBytes),sourceBlobs});
  if(!receipt.selectedReportedGuestParity||receipt.sourceHashDifferences.length)
    throw new Error('observer guest or source parity failed; refusing public receipt');
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}
