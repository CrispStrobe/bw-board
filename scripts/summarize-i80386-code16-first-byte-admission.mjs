#!/usr/bin/env node
// Reduce private A/B/A/B Windows reports to a media-neutral admission receipt.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';

const args=process.argv.slice(2), names=['a1','b1','a2','b2'];
if(args.length!==12)throw new Error('usage: summarize-i80386-code16-first-byte-admission.mjs A1_REPORT B1_REPORT A2_REPORT B2_REPORT A1_TIME B1_TIME A2_TIME B2_TIME A1_HOST B1_HOST A2_HOST B2_HOST');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const reports=Object.fromEntries(names.map((name,i)=>[name,read(args[i])]));
const timing=Object.fromEntries(names.map((name,i)=>{
  const values=Object.fromEntries([...readFileSync(args[i+4],'utf8')
    .matchAll(/(wall|user|system|maxrss)=([0-9.]+)/g)]
    .map(([,key,value])=>[key,Number(value)]));
  if(!['wall','user','system','maxrss'].every(key=>Number.isFinite(values[key])))
    throw new Error(`invalid time file: ${name}`);
  return [name,values];
}));
const host=Object.fromEntries(names.map((name,i)=>{
  const h=read(args[i+8]);
  if(h.kind!==name||!Array.isArray(h.loadStart)||!Array.isArray(h.loadEnd))
    throw new Error(`invalid host record: ${name}`);
  return [name,h];
}));
const all=Object.values(reports),first=reports.a1;
const selected=['steps','stop','refusal','cpu','delivered','serial','textRam','vga'];
const guest=r=>Object.fromEntries(selected.map(key=>[key,r[key]]));
const guestHash=sha(JSON.stringify(guest(first)));
if(all.some(r=>r.steps!==60_000_000))throw new Error('expected 60M steps');
if(all.some(r=>sha(JSON.stringify(guest(r)))!==guestHash))
  throw new Error('selected reported guest fields differ');
for(const key of ['bios','vga','hdd','geometry','cmosType','cmosEquipment',
  'events','mouseEnabled','dosboxConfig','code16Wasm','code16Loads',
  'nativeBlocks'])
  if(all.some(r=>JSON.stringify(r.inputs[key])!==JSON.stringify(first.inputs[key])))
    throw new Error(`private input or switch differs: ${key}`);
if(first.inputs.code16Wasm!==true)throw new Error('opt-in switch absent');
const baseline=host.a1.revision,candidate=host.b1.revision;
if(baseline===candidate||host.a2.revision!==baseline||
   host.b2.revision!==candidate||reports.a1.executionRevision!==baseline||
   reports.a2.executionRevision!==baseline||
   reports.b1.executionRevision!==candidate||
   reports.b2.executionRevision!==candidate)
  throw new Error('unexpected execution revision');
if(host.a1.windowSha256!==host.a2.windowSha256||
   host.b1.windowSha256!==host.b2.windowSha256||
   host.a1.windowSha256===host.b1.windowSha256)
  throw new Error('unexpected code-window source hash');
const changed='../src/experimental/i80386-code16-wasm-block.js';
const sources=first.sourceSha256;
for(const [name,r] of Object.entries(reports)){
  if(Object.keys(r.sourceSha256).length!==Object.keys(sources).length)
    throw new Error(`source inventory size differs: ${name}`);
  for(const [path,hash] of Object.entries(sources))
    if(path!==changed&&r.sourceSha256[path]!==hash)
      throw new Error(`non-prototype execution source differs: ${name}: ${path}`);
}
if(reports.a2.sourceSha256[changed]!==sources[changed]||
   reports.b1.sourceSha256[changed]!==reports.b2.sourceSha256[changed]||
   reports.b1.sourceSha256[changed]===sources[changed])
  throw new Error('unexpected dispatcher source hash');
const normalizedReport=r=>{
  const copy={...r,executionRevision:first.executionRevision,
    sourceSha256:{...r.sourceSha256,[changed]:sources[changed]}};
  return JSON.stringify(copy);
};
if(all.some(r=>normalizedReport(r)!==normalizedReport(first)))
  throw new Error('unexpected difference elsewhere in full reported JSON');
const stats=first.code16WasmStats;
if(!stats||!all.every(r=>r.code16WasmStats&&
   JSON.stringify(r.code16WasmStats)===JSON.stringify(stats)))
  throw new Error('opt-in retirement/call counters differ');
if(stats.instructions+stats.fallback!==60_000_000)
  throw new Error('retirement partition invalid');
const mean=values=>values.reduce((sum,n)=>sum+n,0)/values.length;
const baseMean=mean([timing.a1.user,timing.a2.user]);
const candidateMean=mean([timing.b1.user,timing.b2.user]);
const userRatio=candidateMean/baseMean;
const noIndividualRegression=timing.b1.user<=timing.a1.user&&
  timing.b2.user<=timing.a2.user;
const passed=userRatio<=0.9&&noIndividualRegression;
const rawArtifactSha256=Object.fromEntries(names.map((name,i)=>[name,{
  report:sha(readFileSync(args[i])),time:sha(readFileSync(args[i+4])),
  host:sha(readFileSync(args[i+8]))}]));
const receipt={schema:'bw.i80386-code16-first-byte-admission.v1',
  baselineRevision:baseline,candidateRevision:candidate,
  observerSha256:sha(readFileSync(new URL(import.meta.url))),
  source:{reportedFilesChecked:Object.keys(sources).length,
    allOtherReportedExecutionSourcesIdentical:true,
    baselineDispatcherSha256:sources[changed],
    candidateDispatcherSha256:reports.b1.sourceSha256[changed],
    baselineCodeWindowSha256:host.a1.windowSha256,
    candidateCodeWindowSha256:host.b1.windowSha256,
    codeWindowHashScope:'Captured from each exact local revision; CLI source inventory omits this module.'},
  normalizedFullReportedJsonEqual:true,
  expectedRawReportDiffPaths:['/executionRevision',
    '/sourceSha256/../src/experimental/i80386-code16-wasm-block.js'],
  rawArtifactSha256,
  scope:'Two serial alternating unprofiled 60M Windows opt-in A/B pairs with diagnostics and form census enabled',
  selectedReportedFields:selected,selectedReportedFieldsSha256:guestHash,
  reportedInputsAndOptinSwitchIdentical:true,
  host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,
    node:process.version,
    load:Object.fromEntries(names.map(name=>[name,{startUtc:host[name].startUtc,
      endUtc:host[name].endUtc,loadStart:host[name].loadStart,
      loadEnd:host[name].loadEnd}]))},
  timing,exact:{steps:60_000_000,eligibleAttempts:stats.attempts,
    decodedBlocks:stats.decoded,nativeCalls:stats.blockCalls,
    nativeRetirements:stats.instructions,ordinaryFallbackCalls:stats.fallback,
    boundaryExits:stats.boundary},
  retentionGate:'Predeclared: two alternating unprofiled 60M A/B pairs, matching selected reported guest fields, private inputs, unaffected source blobs and exact opt-in counters, >=10% mean user-CPU gain, and no individual pair regression.',
  result:{baselineMeanUserSeconds:baseMean,
    candidateMeanUserSeconds:candidateMean,
    candidateToBaselineUserRatio:userRatio,
    meanUserCpuGainFraction:1-userRatio,
    noIndividualRegression,passed},
  limits:'The normalized full reported JSON equality extends beyond the selected digest, but the console reports omit full guest RAM, disk state, complete hidden CPU state and diagnostic-census maps. Host load may affect wall time and user-CPU variability; two pairs are a bounded retention gate, not a population estimate. Private media identifiers and guest text are omitted.'};
console.log(JSON.stringify(receipt,null,2));
