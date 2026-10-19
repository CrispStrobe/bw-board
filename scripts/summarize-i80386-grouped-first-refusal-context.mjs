#!/usr/bin/env node
// Exact source-bound paired reduction of grouped first-refusal diagnostics.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {summarizeI80386GroupedShadowAdmission} from
  './summarize-i80386-grouped-shadow-admission.mjs';

const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

export function summarizeI80386GroupedFirstRefusalContext(raw,baseline,options={}){
  return summarizeI80386GroupedShadowAdmission(raw,baseline,{
    ...options,requireGroupedFirstRefusalContext:true});
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const [observedPath,baselinePath]=process.argv.slice(2);
  if(!observedPath||!baselinePath||process.argv.length!==4)
    throw new Error('usage: summarize-i80386-grouped-first-refusal-context.mjs observed.json baseline.json');
  const observedBytes=fs.readFileSync(observedPath);
  const baselineBytes=fs.readFileSync(baselinePath);
  const observed=JSON.parse(observedBytes),baseline=JSON.parse(baselineBytes);
  const sourceBlobs={};
  for(const path of Object.keys(observed.sourceSha256??{})){
    const repositoryPath=path.startsWith('../')?path.slice(3):path.startsWith('./')?
      `scripts/${path.slice(2)}`:path;
    sourceBlobs[path]=execFileSync('git',
      ['show',`${observed.executionRevision}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  const receipt=summarizeI80386GroupedFirstRefusalContext(observed,baseline,{
    rawSha256:sha(observedBytes),baselineSha256:sha(baselineBytes),sourceBlobs});
  if(!receipt.selectedReportedGuestParity||!receipt.sourceHashesVerified)
    throw new Error('guest or source parity failed; refusing public receipt');
  process.stdout.write(JSON.stringify(receipt,null,2)+'\n');
}
