import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {f0GpioTimingResult,assertSameGpioGuest} from '../scripts/lib/f0-gpio-profile-receipt.mjs';
import {summarizeCpuProfile} from '../scripts/lib/wasm-motion-profile.mjs';
const archive=new URL('../docs/receipts/2026-10-03-wasm-warmed-window-profiles/',import.meta.url);
const bytes=path=>readFileSync(new URL(path,archive)),manifest=JSON.parse(bytes('manifest.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
function original(path){const f=manifest.files.find(f=>(f.original?.path??f.path)===path);assert(f,path);return f.original?Buffer.from(JSON.parse(bytes(f.path)).data,f.original.encoding):bytes(f.path);}
const json=path=>JSON.parse(original(path));
const sources={initial:'68a70a71cfc71ea434eb38765e90ae6e8b47ca94',corrected:'1d7023e9813d8a574301b42e0447a02e383032e0'};
const runs={initial:37111247979,corrected:37112129837},core='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const captures=Object.keys(sources).flatMap(dataset=>json(dataset+'/pipeline.json').captures.map(c=>({...c,dataset})));
test('window corpus binds every original, both immutable datasets and exact tool landing',()=>{
 assert.equal(manifest.diagnosticOnly,true);assert.equal(manifest.hostedOnly,true);
 assert.equal(new Set(manifest.files.map(f=>f.path)).size,manifest.files.length);
 for(const f of manifest.files){const raw=bytes(f.path);assert.equal(raw.length,f.bytes);assert.equal(hash(raw),f.sha256,f.path);if(f.original){const decoded=original(f.original.path);assert.equal(decoded.length,f.original.bytes);assert.equal(hash(decoded),f.original.sha256);}}
 const landing=json('tool-landing.json');assert.equal(landing.after.state,'MERGED');assert.equal(landing.after.headRefOid,sources.corrected);
 assert.equal(landing.pr.statusCheckRollup.length,16);assert.equal(landing.pr.statusCheckRollup.filter(c=>c.conclusion==='SUCCESS').length,14);
 assert(landing.pr.statusCheckRollup.filter(c=>c.conclusion==='SKIPPED').every(c=>c.name==='vectors-full'));
 assert.equal(captures.length,8);
 for(const dataset of Object.keys(sources)){const p=json(dataset+'/pipeline.json'),run=json(dataset+'/run.json');assert.equal(p.toolHead,sources[dataset]);assert.equal(p.runId,runs[dataset]);assert.equal(p.core,core);assert(p.completedAt);assert.equal(p.localEngineArtifactDownloads,false);assert.equal(p.automaticEngineMerge,false);assert.equal(run.headSha,sources[dataset]);assert.equal(run.conclusion,'success');assert.equal(run.jobs.length,4);assert(run.jobs.every(j=>j.conclusion==='success'));}
});
test('all 80 ordinary/profiled windows reparse their original floors and identical guest observations',()=>{
 for(const c of captures){const prefix=c.dataset+'/'+c.name+'/gpio/';const r=json(prefix+'receipt.json');assert.equal(r.node,'v'+c.node);assert.equal(r.guestObservationsMatch,true);assert(r.completedAt&&!r.error);assert.equal(r.buildInfo.ref,core);
  assert.equal(r.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256,'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d');
  assert.equal(r.buildInfo.targets.nodejs['labwired_wasm.js'].sha256,'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73');
  for(const label of ['ordinary','profiled']){const parsed=f0GpioTimingResult(original(prefix+label+'-stdout.txt').toString(),r[label].exitCode);assert.equal(r[label].signal,null);assert.deepEqual(r[label].flags,[]);for(const [key,value]of Object.entries(parsed))assert.deepEqual(r[label][key],value);assert.deepEqual(c[label],r[label]);assert.equal(parsed.workloads.gpio.samples.length,5);}
  assertSameGpioGuest(r.ordinary,r.profiled);assertSameGpioGuest(captures[0].ordinary,r.ordinary);
  const runner=original(c.dataset+'/'+c.name+'/runner.txt').toString();assert(runner.includes(sources[c.dataset]));assert.match(runner,new RegExp(`^repeat=${c.repeat}$`,'m'));assert.match(runner,/^build_run=36915940413$/m);
  assert.deepEqual(json(c.dataset+'/'+c.name+'/build-info.json'),r.buildInfo);
 }
});
test('all 40 raw profiles reparse strict deltas and reproduce weighted attribution without engine bytes',()=>{
 for(const c of captures){const prefix=c.dataset+'/'+c.name+'/gpio/',r=json(prefix+'receipt.json');assert.equal(r.windows.length,5);const markers=original(prefix+'profiled-stdout.txt').toString().split('\n').filter(l=>l.startsWith('F0_WINDOW_PROFILE ')).map(l=>JSON.parse(l.slice(18)));assert.equal(markers.length,5);
  const frames=new Map();let totalMicros=0,wasmMicros=0,samples=0;
  for(const [index,w]of r.windows.entries()){assert.equal(w.index,index);assert.equal(w.profileFile,`gpio-${index}.cpuprofile`);assert.equal(w.warmupCycles,6_000_000);assert.equal(w.cycles,48_000_000);assert.equal(w.samplingIntervalMicros,1000);assert.equal(w.scope,'warmed-cycle-window-with-profiler-boundary-overhead');const {bytes:count,summary,...marker}=w;assert.deepEqual(marker,markers[index]);const rawBytes=original(prefix+'window-profiles/'+w.profileFile);assert.equal(rawBytes.length,count);assert.equal(hash(rawBytes),w.profileSha256);
   const raw=JSON.parse(rawBytes),parsed=summarizeCpuProfile(raw),normalized=structuredClone(summary);for(const f of normalized.topWasmFrames)delete f.wasmName;parsed.limitations=r.limitations.slice(2,6);assert.deepEqual(parsed,normalized);assert(raw.endTime>raw.startTime);assert(parsed.wasmSamples>0);
   const named=new Map(summary.topWasmFrames.map(f=>[JSON.stringify([f.functionName,f.url,f.lineNumber]),f.wasmName])),byId=new Map(raw.nodes.map(n=>[n.id,n.callFrame]));
   for(let i=0;i<raw.samples.length;i++){const f=byId.get(raw.samples[i]),micros=raw.timeDeltas[i],key=JSON.stringify([f.functionName,f.url,f.lineNumber]),wasm=f.url.startsWith('wasm://')||f.functionName.startsWith('wasm-function');const entry=frames.get(key)||{...f,wasm,wasmName:named.get(key)||null,selfMicros:0,samples:0};if(!entry.wasmName&&named.get(key))entry.wasmName=named.get(key);entry.selfMicros+=micros;entry.samples++;frames.set(key,entry);totalMicros+=micros;samples++;if(wasm)wasmMicros+=micros;}
  }
  const top=[...frames.values()].sort((a,b)=>b.selfMicros-a.selfMicros).map(f=>({...f,windowSelfShare:f.selfMicros/totalMicros}));assert.deepEqual(top,c.topFrames);assert.equal(totalMicros,c.totalMicros);assert.equal(samples,c.samples);assert.equal(wasmMicros/totalMicros,c.wasmSelfShare);
 }
});
test('empty-slice callee parent attribution reproduces original trees, not a metadata-work claim',()=>{
 const saved=json('caller-attribution.json'),inspection=json('initial/core-inspection.json');assert.equal(inspection.core,core);assert.equal(inspection.engineModified,false);assert(inspection.implementation.includes('NO_CHANNELS'));assert(inspection.traitSignature.includes('&[InputChannel]'));assert(inspection.coldBody.includes('.edge_service_addrs()'));assert(!inspection.coldBody.includes('input_channels'));
 for(const c of captures){const callers=new Map();for(let index=0;index<5;index++){const raw=json(c.dataset+'/'+c.name+'/gpio/window-profiles/gpio-'+index+'.cpuprofile'),byId=new Map(raw.nodes.map(n=>[n.id,n])),parents=new Map();for(const n of raw.nodes)for(const child of n.children||[]){assert(!parents.has(child));assert(byId.has(child));parents.set(child,n.id);}for(let i=0;i<raw.samples.length;i++){const n=byId.get(raw.samples[i]);if(!n.callFrame.functionName.includes('::input_channels::'))continue;const parent=byId.get(parents.get(n.id));assert(parent);const key=parent.callFrame.functionName,entry=callers.get(key)||{functionName:key,selfMicros:0,samples:0};entry.selfMicros+=raw.timeDeltas[i];entry.samples++;callers.set(key,entry);}}
  const actual={dataset:c.dataset,node:c.node,repeat:c.repeat,name:c.name,callers:[...callers.values()].sort((a,b)=>b.selfMicros-a.selfMicros)};assert.deepEqual(saved.find(v=>v.dataset===c.dataset&&v.name===c.name),actual);assert(callers.size>0);assert([...callers.keys()].every(n=>n.includes('service_edge_driven_gpio_devices')));
 }
});
test('initial census failure remains lossless and distinct from passed actual captures',()=>{
 const f=json('initial/initial-census-failure.json');assert.equal(f.source,sources.initial);assert.equal(f.corrected,sources.corrected);assert.equal(f.initialProfileRun,runs.initial);assert.equal(f.initialActualCapturesPassed,4);assert.equal(f.initialProfiles,20);assert.deepEqual(f.changed,['scripts/oracle-census.mjs','test/window-profile-scope.test.mjs']);assert.equal(f.ratchetUnchanged,true);assert.equal(f.debtListUnchanged,true);assert.equal(f.engineOrTimingHarnessChanged,false);assert.equal(f.mergeAttempted,false);
 assert.equal(f.runs.length,2);for(const r of f.runs){assert.equal(r.run.headSha,sources.initial);assert.equal(r.run.conclusion,'failure');assert.equal(r.failures,1);const wrapped=json('initial/'+r.failedStepLog);assert.equal(wrapped.encoding,'gzip+base64');const compressed=Buffer.from(wrapped.data,'base64');assert.equal(compressed.length,wrapped.compressedBytes);const raw=gunzipSync(compressed);assert.equal(raw.length,wrapped.originalBytes);assert.equal(hash(raw),wrapped.originalSha256);assert(raw.includes('labwired-f0-gpio-window-profile.test.mjs'));assert(raw.includes('every guard-then-skip test is in the census or named as debt'));assert.match(raw.toString(),/Z # fail 1$/m);}
 for(const dataset of Object.keys(sources)){const c=json(dataset+'/source-contract.json');assert.equal(c.toolHead,sources[dataset]);assert.equal(c.core,core);assert.equal(c.ordinaryTimingHarnessModified,false);assert.equal(c.productionEngineModified,false);assert.equal(c.frozenAcceptanceHarness,'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162');assert.equal(c.changed.length,dataset==='initial'?6:7);for(const file of c.unchanged)assert.match(file.sha256,/^[a-f0-9]{64}$/);}
});
