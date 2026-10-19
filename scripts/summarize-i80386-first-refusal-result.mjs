#!/usr/bin/env node
// Compact, media-neutral view of a source-bound paired first-refusal reduction.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {summarizeI80386FormResolvedAdmission} from
  './summarize-i80386-form-resolved-admission.mjs';

const MODES=['real','protected16','vm86','protected32'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceMapSha=map=>sha(JSON.stringify(map,Object.keys(map).sort()));
const REQUIRE_REASONS=new Set(['unsupported-group-extension']);
const CANDIDATE_OPCODES=new Set(['80','81','83']);
const CANDIDATE_REGS=new Set([0,1,4,5,6]);
const sum=(items,field)=>items.reduce((n,item)=>n+item[field],0);

export function compactFirstRefusalResult(reduced,host,evidenceSha256){
  if(!reduced.sourceHashesVerified||!reduced.selectedReportedGuestParity||
      reduced.sourceHashDifferences.length||
      reduced.guestReportedFieldDifferences.length||
      reduced.inputPinDifferences.length||
      reduced.unexpectedReportedDifferencePaths.length||
      reduced.completedSteps!==60_000_000||
      host.boardRevision!==reduced.sourceRevision||
      host.pins.boardRevision!==reduced.sourceRevision||
      host.pins.steps!==60_000_000||
      host.sourceHashesVerified!==true||
      host.selectedReportedGuestParity!==true)
    throw new Error('source, selected guest, input, or host provenance failed');
  const typed=reduced.formResolvedPotential;
  const context=typed?.firstRefusalContext;
  if(context?.schema!=='bw.i80386-first-refusal-context.v1')
    throw new Error('missing first-refusal context');
  const modes={};
  for(const mode of MODES){
    const bucket=context.modes[mode],records=Object.entries(bucket.records);
    const candidate=records.filter(([,entry])=>
      REQUIRE_REASONS.has(entry.reason)&&CANDIDATE_OPCODES.has(entry.opcode)&&
      CANDIDATE_REGS.has(entry.modrm?.reg));
    const groups=new Map();
    for(const [,entry] of records){
      const key=`${entry.reason}|${entry.opcode}`;
      const group=groups.get(key)??{reason:entry.reason,opcode:entry.opcode,
        refusedOrdinals:0,bridgeAtLeast4:0,bridgeAtLeast8:0};
      group.refusedOrdinals+=entry.count;
      group.bridgeAtLeast4+=entry.bridgeAtLeast4;
      group.bridgeAtLeast8+=entry.bridgeAtLeast8;
      groups.set(key,group);
    }
    const topBridgeOpcodeGroups=[...groups.values()]
      .filter(group=>group.bridgeAtLeast4>0)
      .sort((a,b)=>b.bridgeAtLeast4-a.bridgeAtLeast4||
        b.refusedOrdinals-a.refusedOrdinals||
        `${a.reason}|${a.opcode}`.localeCompare(`${b.reason}|${b.opcode}`))
      .slice(0,10);
    const topBridgeForms=records
      .filter(([,entry])=>entry.bridgeAtLeast4>0)
      .sort(([keyA,a],[keyB,b])=>b.bridgeAtLeast4-a.bridgeAtLeast4||
        b.count-a.count||keyA.localeCompare(keyB))
      .slice(0,8).map(([,entry])=>({
        reason:entry.reason,opcode:entry.opcode,
        prefixSignature:entry.prefixSignature,
        operandWidth:entry.operandWidth,addressWidth:entry.addressWidth,
        modrm:entry.modrm,eaClass:entry.eaClass,
        observedAccess:entry.observedAccess,parseStatus:entry.parseStatus,
        refusedOrdinals:entry.count,bridgeAtLeast4:entry.bridgeAtLeast4,
        bridgeAtLeast8:entry.bridgeAtLeast8}));
    modes[mode]={refusedOrdinals:bucket.refusedOrdinals,
      bridgeAtLeast4:bucket.bridgeAtLeast4,
      bridgeAtLeast8:bucket.bridgeAtLeast8,
      candidateA:{refusedOrdinals:sum(candidate.map(([,entry])=>entry),'count'),
        bridgeAtLeast4:sum(candidate.map(([,entry])=>entry),'bridgeAtLeast4'),
        bridgeAtLeast8:sum(candidate.map(([,entry])=>entry),'bridgeAtLeast8')},
      topBridgeOpcodeGroups,topBridgeForms};
  }
  const candidateTotal=MODES.reduce((n,mode)=>n+modes[mode].candidateA.bridgeAtLeast4,0);
  const candidate16=modes.protected16.candidateA.bridgeAtLeast4+
    modes.vm86.candidateA.bridgeAtLeast4;
  return {schema:'bw.i80386-first-refusal-result.v1',
    sourceRevision:reduced.sourceRevision,
    completedSteps:reduced.completedSteps,
    sourceHashesVerified:true,selectedReportedGuestParity:true,
    privateEvidenceSha256:evidenceSha256,
    formAdmission:{eligibleRetiredOrdinals:typed.eligibleRetiredOrdinals,
      admittedOrdinals:typed.admittedOrdinals,
      refusedOrdinals:typed.refusedOrdinals,
      uniqueOrdinalsInRunsAtLeast8:typed.uniqueOrdinalsInRunsAtLeast8,
      protected16OrVm86OrdinalsInRunsAtLeast8:
        typed.protected16OrVm86OrdinalsInRunsAtLeast8,
      predeclaredSubsetOpportunityPassed:typed.predeclaredSubsetOpportunityPassed},
    firstRefusal:{refusedOrdinals:context.refusedOrdinals,
      bridgeAtLeast4:context.bridgeAtLeast4,
      bridgeAtLeast8:context.bridgeAtLeast8,
      modes},
    candidateA:{definition:'unsupported-group-extension; 80/81/83; /0,/1,/4,/5,/6; both adjacent admitted runs >=4',
      bridgeAtLeast4:candidateTotal,
      protected16OrVm86BridgeAtLeast4:candidate16,
      predeclaredThresholds:{overall:250_000,protected16OrVm86:100_000},
      passed:candidateTotal>=250_000&&candidate16>=100_000},
    interpretation:'Local bridge contexts overlap and are not disjoint retired-run coverage; observed-arm runtime is instrumentation overhead, not speed data.'};
}

export function summarizeFirstRefusalFiles(observedPath,baselinePath,hostPath,
  baselineTimePath,observedTimePath,candidatePath){
  const observedBytes=fs.readFileSync(observedPath);
  const baselineBytes=fs.readFileSync(baselinePath);
  const hostBytes=fs.readFileSync(hostPath);
  const candidateBytes=fs.readFileSync(candidatePath);
  const observed=JSON.parse(observedBytes),baseline=JSON.parse(baselineBytes);
  const host=JSON.parse(hostBytes);
  const runs=host.runs??[];
  if(runs.length!==2||runs[0].arm!=='baseline'||runs[0].observer!==false||
      runs[1].arm!=='observed'||runs[1].observer!==true||
      runs[0].reportSha256!==sha(baselineBytes)||
      runs[1].reportSha256!==sha(observedBytes)||
      runs[0].sourceHashMapSha256!==sourceMapSha(baseline.sourceSha256)||
      runs[1].sourceHashMapSha256!==sourceMapSha(observed.sourceSha256)||
      host.publicCandidateReceiptSha256!==sha(candidateBytes)||
      runs[0].timeText!==fs.readFileSync(baselineTimePath,'utf8').trim()||
      runs[1].timeText!==fs.readFileSync(observedTimePath,'utf8').trim())
    throw new Error('private host/report/time hashes or arm selection differ');
  const sourceBlobs={};
  for(const path of Object.keys(observed.sourceSha256??{})){
    const repositoryPath=path.startsWith('../')?path.slice(3):path.startsWith('./')?
      `scripts/${path.slice(2)}`:path;
    sourceBlobs[path]=execFileSync('git',
      ['show',`${observed.executionRevision}:${repositoryPath}`],
      {cwd:new URL('..',import.meta.url)});
  }
  const reduced=summarizeI80386FormResolvedAdmission(observed,baseline,{
    rawSha256:sha(observedBytes),baselineSha256:sha(baselineBytes),sourceBlobs,
    requireFirstRefusalContext:true});
  if(JSON.stringify(reduced)!==JSON.stringify(JSON.parse(candidateBytes)))
    throw new Error('private source-bound candidate differs from rerun reduction');
  return compactFirstRefusalResult(reduced,host,{
    baselineReport:sha(baselineBytes),observedReport:sha(observedBytes),
    sourceBoundCandidate:sha(candidateBytes),
    hostManifest:sha(hostBytes),baselineTime:sha(fs.readFileSync(baselineTimePath)),
    observedTime:sha(fs.readFileSync(observedTimePath))});
}

if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const args=process.argv.slice(2);
  if(args.length!==6)throw new Error('usage: summarize-i80386-first-refusal-result.mjs observed.json baseline.json host.json baseline-time.txt observed-time.txt candidate.json');
  process.stdout.write(JSON.stringify(summarizeFirstRefusalFiles(...args),null,2)+'\n');
}
