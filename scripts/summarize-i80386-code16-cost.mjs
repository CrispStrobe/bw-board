#!/usr/bin/env node
// Reduce private Windows reports to a media-neutral sampled-cost receipt.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';

const [profilePath,ordinaryPath,optinPath,profileTimePath,
  ordinaryTimePath,optinTimePath,patchPath]=process.argv.slice(2);
if(!patchPath)throw new Error('usage: summarize-i80386-code16-cost.mjs PROFILE ORDINARY OPTIN PROFILE_TIME ORDINARY_TIME OPTIN_TIME PROBE_PATCH');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const profile=read(profilePath),ordinary=read(ordinaryPath),optin=read(optinPath);
const time=path=>{
  const values=Object.fromEntries([...readFileSync(path,'utf8')
    .matchAll(/(wall|user|system|maxrss)=([0-9.]+)/g)]
    .map(([,key,value])=>[key,Number(value)]));
  if(!['wall','user','system','maxrss'].every(key=>Number.isFinite(values[key])))
    throw new Error('invalid time receipt');
  return values;
};
const times={profile:time(profileTimePath),ordinary:time(ordinaryTimePath),
  priorOptin:time(optinTimePath)};
const selected=['steps','stop','refusal','cpu','delivered','serial','textRam','vga'];
const guest=r=>Object.fromEntries(selected.map(key=>[key,r[key]]));
if([profile,ordinary,optin].some(r=>r.steps!==60_000_000))
  throw new Error('expected 60M steps in all reports');
const guestHash=sha(JSON.stringify(guest(profile)));
if([ordinary,optin].some(r=>sha(JSON.stringify(guest(r)))!==guestHash))
  throw new Error('selected reported guest fields differ');
for(const key of ['bios','vga','hdd','geometry','cmosType',
  'cmosEquipment','events','mouseEnabled','dosboxConfig'])
  if([ordinary,optin].some(r=>JSON.stringify(r.inputs[key])!==
      JSON.stringify(profile.inputs[key])))
    throw new Error(`private input differs: ${key}`);
if(profile.inputs.code16Wasm!==true||ordinary.inputs.code16Wasm!==false||
   optin.inputs.code16Wasm!==true)
  throw new Error('unexpected executable switches');
const altered='../src/experimental/i80386-code16-wasm-block.js';
for(const [path,hash] of Object.entries(optin.sourceSha256)){
  if(path===altered)continue;
  if(profile.sourceSha256[path]!==hash||ordinary.sourceSha256[path]!==hash)
    throw new Error(`source mismatch: ${path}`);
}
if(Object.keys(profile.sourceSha256).length!==Object.keys(optin.sourceSha256).length||
   Object.keys(profile.sourceSha256).length!==Object.keys(ordinary.sourceSha256).length)
  throw new Error('source inventory differs');
const stats=profile.code16WasmStats,cost=stats?.costProbe;
if(!cost||cost.sampleRate!==256||cost.calls!==stats.blockCalls+stats.fallback||
   stats.instructions+stats.fallback!==profile.steps)
  throw new Error('cost probe or retirement partition invalid');
const baselineStats=optin.code16WasmStats;
for(const key of ['attempts','decoded','blockCalls','instructions','fallback','boundary'])
  if(stats[key]!==baselineStats[key])
    throw new Error(`profile changed execution count: ${key}`);
const phases=Object.fromEntries(Object.entries(cost.phases)
  .map(([name,value])=>[name,{samples:value.samples,
    sampledMs:value.ms,
    shareOfSampledInstrumentedCallTime:value.ms/cost.phases.total.ms}]));
const observerSha256=sha(readFileSync(new URL(import.meta.url)));
const receipt={schema:'bw.i80386-code16-sampled-cost.v1',
  profileRevision:profile.executionRevision,
  priorRevision:ordinary.executionRevision,
  observerSha256,probePatchSha256:sha(readFileSync(patchPath)),
  source:{filesChecked:Object.keys(profile.sourceSha256).length,
    nonProbeSourceBlobsIdentical:true,
    originalDispatcherSha256:optin.sourceSha256[altered],
    instrumentedDispatcherSha256:profile.sourceSha256[altered]},
  scope:'One sampled-timer 60M code16 WASM diagnostic run against the same private input and source-equivalent prior ordinary/opt-in pair',
  selectedReportedFields:selected,selectedReportedFieldsSha256:guestHash,
  privateInputsIdentical:true,
  host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,node:process.version},
  timing:times,
  exact:{steps:profile.steps,dispatcherCalls:cost.calls,
    eligibleAttempts:stats.attempts,decodedBlocks:stats.decoded,
    nativeCalls:stats.blockCalls,nativeRetirements:stats.instructions,
    ordinaryFallbackCalls:stats.fallback},
  sampling:{method:'multiplicative hash of dispatcher call ordinal; approximately one in 256 calls',
    sampleRate:cost.sampleRate,sampledCalls:cost.sampledCalls,
    expectedCalls:cost.calls/cost.sampleRate,phases,
    naiveScaledTotalSeconds:cost.phases.total.ms*cost.sampleRate/1000,
    naiveExtrapolationValid:false,
    failureReason:'Naive 256x sampled-call total exceeds the observed whole-process wall time; timer/sample-path overhead and possible pause bias invalidate absolute attribution.'},
  retentionGate:'Predeclared: investigate a phase only if it is >=20% of sampled dispatcher time and a plausible 2x phase reduction implies >=10% whole-run potential. Retain executable changes only after two alternating 60M A/B pairs with matching selected reported guest fields, >=10% mean user-CPU gain, and no individual regression.',
  gateResult:'Inconclusive: sampling distortion invalidates the phase-share premise, so no optimization is selected by this gate.',
  limits:'Sampled monotonic wall time within one process is a ranking of instrumented calls, not whole-run or removable CPU cost. A single later instrumented run and earlier uninstrumented runs cannot isolate timer overhead from host drift. Prior report fields omit full RAM, disk state and hidden CPU state. No hardware 386DX RTx claim; private media identifiers and guest text omitted.'};
console.log(JSON.stringify(receipt,null,2));
