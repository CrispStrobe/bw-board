import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {f0GpioTimingResult,assertSameGpioGuest} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/f0-gpio-profile-receipt.mjs';
import {summarizeCpuProfile} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/wasm-motion-profile.mjs';
const root='/mnt/volume1/code/lego/.fastpath-census-evidence.kYeuzx/window-profile-20261003';
const repo='/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002';
const toolHead='68a70a71cfc71ea434eb38765e90ae6e8b47ca94',base='3cf52d1dd8b77d8f4d39747f1002ed8c7206ffab';
const runId=37111247979,core='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const hash=b=>createHash('sha256').update(b).digest('hex');
const gh=args=>execFileSync('gh',args,{encoding:'utf8',maxBuffer:8*1024*1024,timeout:30000});
const git=args=>execFileSync('git',args,{cwd:repo,encoding:'utf8'});
function add(path,value){const text=JSON.stringify(value,null,2)+'\n';
 if(existsSync(path))assert.equal(readFileSync(path,'utf8'),text);
 else execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`,maxBuffer:8*1024*1024});
}
const run=JSON.parse(gh(['run','view',String(runId),'-R','CrispStrobe/bw-board','--json','status,conclusion,headSha,jobs,url']));
assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.headSha,toolHead);assert.equal(run.jobs.length,4);
add(root+'/run.json',run);
const artifactListing=JSON.parse(gh(['api',`repos/CrispStrobe/bw-board/actions/runs/${runId}/artifacts`]));
add(root+'/artifacts.json',artifactListing);
const prior=JSON.parse(readFileSync('/mnt/volume1/code/lego/.fastpath-census-evidence.kYeuzx/c3-word-hook-thunk-r2/pipeline.json'));
const baseline=prior.verifications.baseline;assert.equal(baseline.buildInfo.ref,core);
add(root+'/baseline-verification.json',baseline);
const changed=git(['diff','--name-only',base,toolHead]).trim().split('\n');
assert.deepEqual(changed,['.github/workflows/labwired-window-profile.yml','scripts/lib/window-cpu-profiler.mjs','scripts/profile-labwired-f0-windows.mjs','test/labwired-f0-gpio-window-profile.test.mjs','test/window-cpu-profiler.test.mjs','test/window-profile-scope.test.mjs']);
const unchanged=['test/labwired-f0-gpio-profile.test.mjs','test/labwired-f0-timing.test.mjs','scripts/probe-labwired-f0.mjs','scripts/probe-labwired-motion-ab.mjs','.github/workflows/labwired-motion-ab.yml','scripts/lib/wasm-motion-profile.mjs','scripts/lib/f0-gpio-profile-receipt.mjs'].map(path=>{
 const a=git(['show',base+':'+path]),b=git(['show',toolHead+':'+path]);assert.equal(a,b);return {path,sha256:hash(a)};
});
add(root+'/source-contract.json',{base,toolHead,changed,unchanged,core,productionEngineModified:false,ordinaryTimingHarnessModified:false,frozenAcceptanceHarness:'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162'});
const captures=[];
for(const node of ['20.20.2','22.23.3'])for(const repeat of [1,2]){
 const name=`warmed-gpio-node-${node}-repeat-${repeat}`;
 const found=artifactListing.artifacts.filter(a=>a.name===name);assert.equal(found.length,1);
 const artifact=found[0];assert(!artifact.expired&&artifact.size_in_bytes>0&&artifact.size_in_bytes<4*1024*1024);
 const directory=root+'/'+name;
 assert(!existsSync(directory),'Existing receipt download: inspect, never overwrite');
 gh(['run','download',String(runId),'-R','CrispStrobe/bw-board','--name',name,'--dir',directory]);
 const receipt=JSON.parse(readFileSync(directory+'/gpio/receipt.json'));
 assert.equal(receipt.schema,'labwired.f0-window-profile.v1');assert.equal(receipt.diagnosticOnly,true);
 assert.equal(receipt.node,'v'+node);assert(receipt.completedAt&&!receipt.error);assert.equal(receipt.guestObservationsMatch,true);
 assert.deepEqual(receipt.buildInfo,baseline.buildInfo);
 assert.deepEqual(JSON.parse(readFileSync(directory+'/build-info.json')),baseline.buildInfo);
 const runner=readFileSync(directory+'/runner.txt','utf8');assert(runner.includes(toolHead));assert.match(runner,new RegExp(`^repeat=${repeat}$`,'m'));assert.match(runner,/^build_run=36915940413$/m);
 assert.equal(run.jobs.find(j=>j.name===`Window sampling Node ${node} repeat ${repeat}`)?.conclusion,'success');
 for(const [path,sha]of Object.entries(receipt.files))assert.equal(sha,hash(git(['show',toolHead+':'+path])),path);
 for(const label of ['ordinary','profiled']){
  const stdout=readFileSync(directory+'/gpio/'+label+'-stdout.txt','utf8');
  assert.equal(receipt[label].signal,null);assert.equal(receipt[label].error,undefined);assert.deepEqual(receipt[label].flags,[]);
  const parsed=f0GpioTimingResult(stdout,receipt[label].exitCode);
  for(const [key,value]of Object.entries(parsed))assert.deepEqual(receipt[label][key],value);
 }
 assertSameGpioGuest(receipt.ordinary,receipt.profiled);
 if(captures.length)assertSameGpioGuest(captures[0].ordinary,receipt.ordinary);
 assert.equal(receipt.windows.length,5);
 const stdout=readFileSync(directory+'/gpio/profiled-stdout.txt','utf8');
 const markers=stdout.split('\n').filter(l=>l.startsWith('F0_WINDOW_PROFILE ')).map(l=>JSON.parse(l.slice(18)));
 assert.equal(markers.length,5);
 const frames=new Map();let totalMicros=0,wasmMicros=0,samples=0;
 for(const [index,w]of receipt.windows.entries()){
  assert.equal(w.index,index);assert.equal(w.profileFile,`gpio-${index}.cpuprofile`);
  assert.equal(w.scope,'warmed-cycle-window-with-profiler-boundary-overhead');assert.equal(w.samplingIntervalMicros,1000);
  assert.equal(w.warmupCycles,6_000_000);assert.equal(w.cycles,48_000_000);
  const {bytes,summary,...marker}=w;assert.deepEqual(marker,markers[index]);
  const rawBytes=readFileSync(directory+'/gpio/window-profiles/'+w.profileFile);assert.equal(rawBytes.length,bytes);assert.equal(hash(rawBytes),w.profileSha256);
  const raw=JSON.parse(rawBytes),parsed=summarizeCpuProfile(raw);assert(raw.endTime>raw.startTime);assert(parsed.wasmSamples>0);
  parsed.limitations=receipt.limitations.slice(2,6);
  const normalized=structuredClone(summary);for(const f of normalized.topWasmFrames)delete f.wasmName;
  assert.deepEqual(parsed,normalized);
  const named=new Map(summary.topWasmFrames.map(f=>[JSON.stringify([f.functionName,f.url,f.lineNumber]),f.wasmName]));
  const byId=new Map(raw.nodes.map(n=>[n.id,n.callFrame]));
  for(let i=0;i<raw.samples.length;i++){
   const f=byId.get(raw.samples[i]),micros=raw.timeDeltas[i],key=JSON.stringify([f.functionName,f.url,f.lineNumber]);
   const wasm=f.url.startsWith('wasm://')||f.functionName.startsWith('wasm-function');
   const entry=frames.get(key)||{...f,wasm,wasmName:named.get(key)||null,selfMicros:0,samples:0};
   if(!entry.wasmName&&named.get(key))entry.wasmName=named.get(key);
   entry.selfMicros+=micros;entry.samples++;frames.set(key,entry);totalMicros+=micros;samples++;if(wasm)wasmMicros+=micros;
  }
 }
 const topFrames=[...frames.values()].sort((a,b)=>b.selfMicros-a.selfMicros).map(f=>({...f,windowSelfShare:f.selfMicros/totalMicros}));
 const capture={name,node,repeat,artifact,ordinary:receipt.ordinary,profiled:receipt.profiled,profiles:5,samples,totalMicros,wasmSelfShare:wasmMicros/totalMicros,topFrames,limitations:receipt.limitations};
 captures.push(capture);
 console.log(JSON.stringify({node,repeat,ordinary:receipt.ordinary.workloads.gpio.medianRtx,profiled:receipt.profiled.workloads.gpio.medianRtx,wasmSelfShare:capture.wasmSelfShare,top:topFrames.filter(f=>f.wasm).slice(0,8).map(f=>({name:f.wasmName||f.functionName,share:f.windowSelfShare}))}));
}
add(root+'/pipeline.json',{schema:1,diagnosticOnly:true,hostedOnly:true,localEngineArtifactDownloads:false,runId,toolHead,core,buildRun:36915940413,captures,completedAt:new Date().toISOString(),automaticEngineMerge:false,publication:false,physicalAcknowledgementChanges:false});
console.log('Verified all four captures, 20 raw profiles and 40 separate ordinary/profiled timing windows.');
