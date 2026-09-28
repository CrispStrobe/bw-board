#!/usr/bin/env node
// Reduce private Windows execution reports to a media-neutral performance
// receipt. This reads existing reports and never opens the guest image.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {cpus} from 'node:os';

const [ordinaryPath,optinPath,ordinaryTimePath,optinTimePath]=process.argv.slice(2);
if(!ordinaryPath||!optinPath||!ordinaryTimePath||!optinTimePath)
  throw new Error('usage: summarize-i80386-code16-windows.mjs ORDINARY OPTIN ORDINARY_TIME OPTIN_TIME');
const read=path=>JSON.parse(readFileSync(path,'utf8'));
const ordinary=read(ordinaryPath),optin=read(optinPath);
const sha=data=>createHash('sha256').update(data).digest('hex');
const timing=path=>{
  const text=readFileSync(path,'utf8');
  const values=Object.fromEntries([...text.matchAll(/(wall|user|system|maxrss)=([0-9.]+)/g)]
    .map(([,key,value])=>[key,Number(value)]));
  if(!['wall','user','system','maxrss'].every(key=>Number.isFinite(values[key])))
    throw new Error('invalid time receipt');
  return values;
};
const ordinaryTime=timing(ordinaryTimePath),optinTime=timing(optinTimePath);
const selectedReportedFields=['steps','stop','refusal','cpu','delivered',
  'serial','textRam','vga'];
const guest=r=>{
  for(const key of selectedReportedFields)
    if(!Object.hasOwn(r,key))throw new Error(`missing reported field: ${key}`);
  return Object.fromEntries(selectedReportedFields.map(key=>[key,r[key]]));
};
if(ordinary.steps!==60_000_000||optin.steps!==ordinary.steps)
  throw new Error('expected matching 60M-step reports');
if(ordinary.executionRevision!==optin.executionRevision)
  throw new Error('reports use different revisions');
if(JSON.stringify(ordinary.sourceSha256)!==JSON.stringify(optin.sourceSha256))
  throw new Error('reports use different source files');
if(ordinary.inputs.nativeBlocks!==false||optin.inputs.nativeBlocks!==false||
   ordinary.inputs.code16Loads!==false||optin.inputs.code16Loads!==false||
   ordinary.inputs.code16Wasm!==false||optin.inputs.code16Wasm!==true)
  throw new Error('expected ordinary versus code16 WASM switch pair');
for(const key of ['bios','vga','hdd','geometry','cmosType','cmosEquipment',
  'events','mouseEnabled','dosboxConfig'])
  if(JSON.stringify(ordinary.inputs[key])!==JSON.stringify(optin.inputs[key]))
    throw new Error(`private input differs: ${key}`);
const ordinaryGuest=sha(JSON.stringify(guest(ordinary)));
const optinGuest=sha(JSON.stringify(guest(optin)));
if(ordinaryGuest!==optinGuest)
  throw new Error('selected reported guest fields differ across the two reports');
const stats=optin.code16WasmStats,diag=optin.code16WasmDiagnostics;
if(!stats||!diag)throw new Error('missing code16 diagnostics');
if(stats.instructions+stats.fallback!==ordinary.steps)
  throw new Error('native and fallback retirement does not partition steps');
const top=(values,n=16)=>Object.entries(values??{}).sort((a,b)=>b[1]-a[1]).slice(0,n);
const mode32=diag.fallbacks.mode32??0;
const receipt={schema:'bw.i80386-code16-windows-census.v1',
  observerSha256:sha(readFileSync(new URL(import.meta.url))),
  executionRevision:ordinary.executionRevision,
  scope:'60M ordinary Windows 3.11 steps; current-source 32-bit count and opt-in code16 WASM eligibility',
  privateInputsIdentical:true,
  selectedReportedFields,selectedReportedFieldsSha256:ordinaryGuest,
  sourceSha256:Object.fromEntries(['../src/experimental/i80386.js',
    '../src/experimental/i80386-at-machine.js',
    '../src/experimental/i80386-code16-wasm-block.js',
    './run-i80386-at-console.mjs'].map(key=>[key,ordinary.sourceSha256[key]])),
  host:{cpuModel:cpus()[0]?.model,logicalCpus:cpus().length,
    node:process.version,platform:process.platform,arch:process.arch},
  timing:{ordinary:ordinaryTime,optin:optinTime,
    optinUserCpuToOrdinary:optinTime.user/ordinaryTime.user},
  modes:{protected32Steps:mode32,realProtected16Vm86CombinedSteps:ordinary.steps-mode32,
    splitSource:'the current diagnostic separates protected32 only; historical separate mode-clock receipt has the three-way 16-bit split'},
  code16:{stats,retirementShare:stats.instructions/ordinary.steps,
    meanInstructionsPerCall:stats.instructions/stats.blockCalls,
    fallbacks:top(diag.fallbacks),exits:top(diag.exits),
    shortBlockStops:top(diag.shortBlockStops),
    unsupportedFirstOpcodeEncoding:'decimal byte values, not hexadecimal; 38=0x26 ES, 142=0x8E MOV segment, 102=0x66 operand-size prefix',
    unsupportedFirstOpcodes:top(diag.unsupportedFirstOpcodes),
    formCensus:Object.fromEntries(Object.entries(diag.formCensus??{}).filter(([,value])=>value&&typeof value==='object')
      .map(([name,value])=>[name,{calls:value.calls,forms:top(value.forms,12),outcomes:top(value.outcomes,12)}]))},
  limits:'Acceptance compares only the selected reported fields: step count, stop/refusal, reported CPU subset, delivered events, serial/text-RAM and VGA plane results. The console report does not include a full RAM hash, disk state, or complete hidden CPU state; matching fields do not prove full guest-state equivalence. Observed opt-in execution and CPU modes are not a safe admission proof or 386DX timing claim. Private input identifiers and guest text are omitted.'};
console.log(JSON.stringify(receipt,null,2));
