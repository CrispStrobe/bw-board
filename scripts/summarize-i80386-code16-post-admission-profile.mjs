#!/usr/bin/env node
// Reduce a private post-admission Windows V8 profile to media-neutral evidence.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';

const [reportPath,prior1Path,prior2Path,timePath,hostPath,profilePath,
  priorHostPath]=process.argv.slice(2);
if(!priorHostPath)throw new Error('usage: summarize-i80386-code16-post-admission-profile.mjs POST_REPORT PRIOR_B1_REPORT PRIOR_B2_REPORT POST_TIME POST_HOST POST_CPUPROFILE PRIOR_B1_HOST');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const report=read(reportPath),prior1=read(prior1Path),prior2=read(prior2Path);
const host=read(hostPath),priorHost=read(priorHostPath),profile=read(profilePath);
const selected=['steps','stop','refusal','cpu','delivered','serial','textRam','vga'];
const guest=r=>Object.fromEntries(selected.map(key=>[key,r[key]]));
const guestHash=sha(JSON.stringify(guest(report)));
for(const r of [report,prior1,prior2]){
  if(r.steps!==60_000_000)throw new Error('expected 60M steps');
  if(sha(JSON.stringify(guest(r)))!==guestHash)
    throw new Error('selected reported guest fields differ');
  if(r.inputs.code16Wasm!==true)throw new Error('opt-in switch absent');
  if(JSON.stringify(r.inputs)!==JSON.stringify(report.inputs))
    throw new Error('private inputs differ');
  if(JSON.stringify(r.code16WasmStats)!==
     JSON.stringify(report.code16WasmStats))
    throw new Error('opt-in retirement/call counters differ');
}
if(prior1.executionRevision!==prior2.executionRevision||
   host.revision!==report.executionRevision||
   priorHost.revision!==prior1.executionRevision||
   host.code16WindowSha256!==priorHost.windowSha256)
  throw new Error('source revision or code-window hash differs');
const runScript='./run-i80386-at-console.mjs';
const newHelpers=['../src/experimental/i80386-code16-window.js',
  '../src/experimental/i80386-code16-ea.js',
  '../src/experimental/i80386-code16-data-window.js'];
const priorSources=prior1.sourceSha256,postSources=report.sourceSha256;
if(JSON.stringify(priorSources)!==JSON.stringify(prior2.sourceSha256))
  throw new Error('prior candidate source inventories differ');
if(Object.keys(postSources).length!==Object.keys(priorSources).length+3||
   newHelpers.some(path=>!postSources[path]))
  throw new Error('new helper source inventory missing');
for(const [path,hash] of Object.entries(priorSources))
  if(path!==runScript&&postSources[path]!==hash)
    throw new Error(`execution source differs: ${path}`);
if(postSources[runScript]===priorSources[runScript])
  throw new Error('expected post-measurement runner source-list change');
const normalized=r=>JSON.stringify({...r,
  executionRevision:prior1.executionRevision,
  sourceSha256:priorSources});
if(normalized(report)!==normalized(prior1)||
   normalized(report)!==normalized(prior2))
  throw new Error('unexpected difference elsewhere in full reported JSON');
const timing=Object.fromEntries([...readFileSync(timePath,'utf8')
  .matchAll(/(wall|user|system|maxrss)=([0-9.]+)/g)]
  .map(([,key,value])=>[key,Number(value)]));
if(!['wall','user','system','maxrss'].every(key=>Number.isFinite(timing[key]))||
   !Array.isArray(host.loadStart)||!Array.isArray(host.loadEnd))
  throw new Error('invalid time or host record');
if(!Array.isArray(profile.nodes)||!Array.isArray(profile.samples)||
   !Array.isArray(profile.timeDeltas)||
   profile.samples.length!==profile.timeDeltas.length||
   profile.samples.length===0)throw new Error('invalid CPU profile');

const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
const parents=new Map(profile.nodes.flatMap(node=>(node.children??[])
  .map(child=>[child,node.id])));
const fileOf=url=>{
  const match=(url??'').match(/(?:^|\/)(src|scripts)\/([^?#]*)$/);
  return match?`${match[1]}/${match[2]}`:
    url?.startsWith('wasm:')?'wasm':url?'other':'(runtime)';
};
const underDispatcher=id=>{
  for(let parent=parents.get(id);parent!==undefined;parent=parents.get(parent)){
    const frame=nodes.get(parent)?.callFrame;
    if(frame?.functionName==='run'&&
       fileOf(frame.url)==='src/experimental/i80386-code16-wasm-block.js')
      return true;
  }
  return false;
};
const counts=new Map(),functions=new Map();
const add=(map,key)=>map.set(key,(map.get(key)??0)+1);
for(const id of profile.samples){
  const frame=nodes.get(id)?.callFrame;
  if(!frame)throw new Error('unknown profile node');
  const file=fileOf(frame.url),name=frame.functionName||'(anonymous)';
  const key=file.startsWith('src/')||file.startsWith('scripts/')?
    `${file}::${name}`:`${file}::(redacted)`;
  add(functions,key);
  let category;
  if(file==='src/experimental/i80386-code16-window.js')
    category='codeWindowProof';
  else if(file==='src/experimental/i80386-code16-wasm-block.js')
    category=name==='decodeBlock'?'blockDecode':
      name==='prepare'?'blockPrepare':
      name==='eligible'||name==='ineligibleReason'?'dispatcherAdmission':
      ['bump','observeForm','refused','stepTerminalBranch'].includes(name)?
        'dispatcherDiagnostics':'otherDispatcher';
  else if(file==='src/experimental/i80386-code16-ea.js'||
          file==='src/experimental/i80386-code16-data-window.js')
    category='eaDataProof';
  else if((file==='src/experimental/i80386.js'||
           file==='src/i8086-machine.js')&&underDispatcher(id))
    category='ordinaryFallbackCore';
  else if(file==='src/experimental/i80386-at-machine.js'&&
          underDispatcher(id))category='ordinaryFallbackBoard';
  else if(file==='wasm')category='wasm';
  else category='otherProcess';
  add(counts,category);
}
const sum=[...counts.values()].reduce((total,value)=>total+value,0);
if(sum!==profile.samples.length)throw new Error('sample bins are not disjoint');
const ordered=map=>Object.fromEntries([...map].sort((a,b)=>b[1]-a[1]||
  a[0].localeCompare(b[0])));
const buckets=ordered(counts);
const opportunityKeys=['blockDecode','blockPrepare','dispatcherAdmission',
  'dispatcherDiagnostics','otherDispatcher','eaDataProof',
  'ordinaryFallbackCore','ordinaryFallbackBoard'];
const opportunitySamples=opportunityKeys.reduce((total,key)=>
  total+(buckets[key]??0),0);
const opportunityShare=opportunitySamples/profile.samples.length;
const receipt={schema:'bw.i80386-code16-post-admission-profile.v1',
  profileRevision:report.executionRevision,
  priorCandidateRevision:prior1.executionRevision,
  observerSha256:sha(readFileSync(new URL(import.meta.url))),
  source:{priorReportedFiles:Object.keys(priorSources).length,
    profileReportedFiles:Object.keys(postSources).length,
    unchangedPriorExecutionSourcesExceptRunner:true,
    expectedNewHelpers:Object.fromEntries(newHelpers.map(path=>
      [path,postSources[path]])),
    priorRunnerSha256:priorSources[runScript],
    profileRunnerSha256:postSources[runScript],
    code16WindowSha256:host.code16WindowSha256},
  selectedReportedFields:selected,
  selectedReportedFieldsSha256:guestHash,
  normalizedFullReportedJsonEqual:true,
  expectedRawReportDifferences:'Execution revision, runner source hash, and three newly listed helper source hashes only.',
  privateInputsIdentical:true,
  exact:{steps:report.steps,...report.code16WasmStats},
  host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,
    node:process.version,startUtc:host.startUtc,endUtc:host.endUtc,
    loadStart:host.loadStart,loadEnd:host.loadEnd},
  timing,
  rawArtifactSha256:{report:sha(readFileSync(reportPath)),
    time:sha(readFileSync(timePath)),host:sha(readFileSync(hostPath)),
    cpuprofile:sha(readFileSync(profilePath))},
  sampling:{requestedIntervalMicroseconds:5000,
    allProcessSelfSamples:profile.samples.length,
    disjointBuckets:buckets,
    topSelfFunctions:Object.entries(ordered(functions)).slice(0,20)
      .map(([functionName,samples])=>({functionName,samples})),
    nonWindowDispatcherAndFallbackSamples:opportunitySamples,
    nonWindowDispatcherAndFallbackShareOfAllSamples:opportunityShare,
    feasibilitySampleScreenAtLeast20Percent:opportunityShare>=0.20},
  nextGate:'Even if the sample screen passes, a separate disjoint event-aware run observer must reach >=4 mean instructions per all admitted run and cover >=25% of unique real/protected16/VM86 completed step ordinals in runs of length >=4 before runtime coding.',
  limits:'Self samples indicate approximate CPU position, not removable cost. This one profiled run is not a timing A/B. Full reported JSON equality omits full guest RAM, disk state, hidden CPU state and diagnostic-census maps. Private media identifiers, paths and guest text are omitted.'};
console.log(JSON.stringify(receipt,null,2));
