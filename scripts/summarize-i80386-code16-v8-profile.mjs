#!/usr/bin/env node
// Reduce two private Windows profile/control pairs to a media-neutral receipt.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';

const args=process.argv.slice(2);
if(args.length!==14)throw new Error('usage: summarize-i80386-code16-v8-profile.mjs ORDINARY_PROFILE_REPORT ORDINARY_CONTROL_REPORT OPTIN_PROFILE_REPORT OPTIN_CONTROL_REPORT ORDINARY_PROFILE_TIME ORDINARY_CONTROL_TIME OPTIN_PROFILE_TIME OPTIN_CONTROL_TIME ORDINARY_PROFILE_HOST ORDINARY_CONTROL_HOST OPTIN_PROFILE_HOST OPTIN_CONTROL_HOST ORDINARY_CPUPROFILE OPTIN_CPUPROFILE');
const names=['ordinaryProfile','ordinaryControl','optinProfile','optinControl'];
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const sha=data=>createHash('sha256').update(data).digest('hex');
const reports=Object.fromEntries(names.map((name,i)=>[name,json(args[i])]));
const timing=Object.fromEntries(names.map((name,i)=>{
  const values=Object.fromEntries([...readFileSync(args[i+4],'utf8')
    .matchAll(/(wall|user|system|maxrss)=([0-9.]+)/g)]
    .map(([,key,value])=>[key,Number(value)]));
  if(!['wall','user','system','maxrss'].every(key=>Number.isFinite(values[key])))
    throw new Error(`invalid time file for ${name}`);
  return [name,values];
}));
const hostLoad=Object.fromEntries(names.map((name,i)=>{
  const h=json(args[i+8]);
  if(h.kind!==name.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())||
     !Array.isArray(h.loadStart)||!Array.isArray(h.loadEnd))
    throw new Error(`invalid host record for ${name}`);
  return [name,{startUtc:h.startUtc,endUtc:h.endUtc,
    loadStart:h.loadStart,loadEnd:h.loadEnd}];
}));
const selected=['steps','stop','refusal','cpu','delivered','serial','textRam','vga'];
const guest=r=>Object.fromEntries(selected.map(key=>[key,r[key]]));
const all=Object.values(reports),first=all[0];
if(all.some(r=>r.steps!==60_000_000))throw new Error('expected 60M steps');
if(all.some(r=>sha(JSON.stringify(guest(r)))!==sha(JSON.stringify(guest(first)))))
  throw new Error('selected reported guest fields differ');
for(const key of ['bios','vga','hdd','geometry','cmosType','cmosEquipment',
  'events','mouseEnabled','dosboxConfig'])
  if(all.some(r=>JSON.stringify(r.inputs[key])!==JSON.stringify(first.inputs[key])))
    throw new Error(`private input differs: ${key}`);
for(const [name,r] of Object.entries(reports)){
  const optin=name.startsWith('optin');
  if(r.inputs.code16Wasm!==optin||r.executionRevision!==first.executionRevision)
    throw new Error(`unexpected switch/revision: ${name}`);
  if(optin!==Boolean(r.code16WasmStats))throw new Error(`missing stats: ${name}`);
  if(JSON.stringify(r.sourceSha256)!==JSON.stringify(first.sourceSha256))
    throw new Error(`execution source differs: ${name}`);
}
const stats=reports.optinProfile.code16WasmStats;
const controlStats=reports.optinControl.code16WasmStats;
for(const key of ['attempts','decoded','blockCalls','instructions','fallback','boundary'])
  if(JSON.stringify(stats[key])!==JSON.stringify(controlStats[key]))
    throw new Error(`retirement/call count differs: ${key}`);
if(stats.instructions+stats.fallback!==60_000_000)
  throw new Error('opt-in retirement partition invalid');

function summarizeProfile(path){
  const profile=json(path);
  if(!Array.isArray(profile.nodes)||!Array.isArray(profile.samples)||
     !Array.isArray(profile.timeDeltas)||
     profile.samples.length!==profile.timeDeltas.length)
    throw new Error('invalid CPU profile');
  const nodes=new Map(profile.nodes.map(node=>[node.id,node]));
  const parents=new Map(profile.nodes.flatMap(node=>(node.children??[])
    .map(child=>[child,node.id])));
  const underDispatcher=id=>{
    for(let parent=parents.get(id);parent!==undefined;parent=parents.get(parent)){
      const frame=nodes.get(parent)?.callFrame;
      if(frame?.functionName==='run'&&
         frame.url?.endsWith('/src/experimental/i80386-code16-wasm-block.js'))
        return true;
    }
    return false;
  };
  const functions=new Map(),files=new Map(),categories=new Map();
  const add=(map,key)=>map.set(key,(map.get(key)??0)+1);
  let candidate=0;
  for(const id of profile.samples){
    const frame=nodes.get(id)?.callFrame;
    if(!frame)throw new Error('unknown profile node');
    const url=frame.url??'',name=frame.functionName||'(anonymous)';
    // Path normalization is intentionally an allowlist: no private path can escape.
    const match=url.match(/(?:^|\/)(src|scripts)\/([^?#]*)$/);
    const file=match?`${match[1]}/${match[2]}`:
      url.startsWith('node:')?'node-internal':
      url.startsWith('wasm:')?'wasm':
      url?'other':'(runtime)';
    const functionName=match?name:file==='(runtime)'?name:'(redacted)';
    const key=`${file}::${functionName}`;
    add(functions,key);add(files,file);
    const category=file==='src/experimental/i80386-code16-window.js'?
      'codeWindow':
      file==='src/experimental/i80386-code16-wasm-block.js'&&name==='decodeBlock'?
        'blockDecode':
        file==='src/experimental/i80386-code16-wasm-block.js'&&name==='prepare'?
          'blockPrepare':
          file==='src/experimental/i80386-code16-wasm-block.js'&&
          (name==='eligible'||name==='ineligibleReason')?
            'dispatcherAdmission':
          file==='src/experimental/i80386-code16-wasm-block.js'?
            'otherCode16Dispatcher':
            (file==='src/experimental/i80386.js'||
             file==='src/experimental/i8086-machine.js')?
              underDispatcher(id)?'ordinaryFallbackCore':'ordinaryCore':
              file==='src/experimental/i80386-at-machine.js'?
                underDispatcher(id)?'ordinaryFallbackBoard':'ordinaryBoard':
            file==='wasm'?'wasm':file==='(runtime)'?'runtime':'other';
    add(categories,category);
    if(category==='codeWindow'||category==='blockDecode')candidate++;
  }
  const sort=map=>Object.fromEntries([...map].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
  return {sha256:sha(readFileSync(path)),samples:profile.samples.length,
    intervalRequestedMicroseconds:5000,
    candidateSelfSamples:candidate,
    candidateShareOfAllSamples:candidate/profile.samples.length,
    categories:sort(categories),files:sort(files),topSelfFunctions:
      Object.entries(sort(functions)).slice(0,25).map(([functionName,samples])=>
        ({functionName,samples}))};
}
const profiles={ordinary:summarizeProfile(args[12]),optin:summarizeProfile(args[13])};
const gate=profiles.optin.candidateShareOfAllSamples>=0.20;
const receipt={schema:'bw.i80386-code16-v8-profile.v1',
  executionRevision:first.executionRevision,
  observerSha256:sha(readFileSync(new URL(import.meta.url))),
  source:{filesChecked:Object.keys(first.sourceSha256).length,
    allFourReportedSourceInventoriesIdentical:true,
    code16DispatcherSha256:first.sourceSha256['../src/experimental/i80386-code16-wasm-block.js'],
    code16WindowSha256:sha(readFileSync(new URL('../src/experimental/i80386-code16-window.js',import.meta.url))),
    code16WindowHashScope:'Hash of the local revision file; the CLI source inventory does not list this module.'},
  scope:'Four serial 60M executions: ordinary/opt-in, each with a V8 CPU profile and a nearby unprofiled control',
  selectedReportedFields:selected,
  selectedReportedFieldsSha256:sha(JSON.stringify(guest(first))),
  privateInputsIdentical:true,
  host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,node:process.version,
    profileRequestedIntervalMicroseconds:5000,load:hostLoad},
  timing,exact:{steps:60_000_000,eligibleAttempts:stats.attempts,
    decodedBlocks:stats.decoded,nativeCalls:stats.blockCalls,
    nativeRetirements:stats.instructions,ordinaryFallbackCalls:stats.fallback},
  profiles,
  predeclaredCandidate:'Cheaper code-window/cache admission, with strict candidate self samples from all code-window functions plus decodeBlock only.',
  predeclaredGate:'Prototype only if candidate is >=20% of all opt-in V8 self samples with selected reported guest/input/source parity; retain only after two alternating unprofiled 60M A/B pairs with matching selected fields, >=10% mean user-CPU gain, and no individual regression.',
  gateResult:gate?'Candidate crosses profile screening gate; no speed or removability claim; unprofiled A/B proof remains required.':'Candidate below 20% all-process self-sample gate; do not prototype this architecture from these data.',
  limits:'V8 CPU self samples are approximate process attribution, not removable cost or an Amdahl bound. A single profiled/control pair per mode cannot isolate host drift or profiler overhead. Reports omit full guest RAM, disk state and complete hidden CPU state. Private media identifiers, paths and guest text are omitted.'};
console.log(JSON.stringify(receipt,null,2));
