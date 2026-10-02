import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {f0TimingResult} from '../scripts/lib/f0-timing-receipt.mjs';
import {f0GpioTimingResult,assertSameGpioGuest} from '../scripts/lib/f0-gpio-profile-receipt.mjs';
import {summarizeCpuProfile} from '../scripts/lib/wasm-motion-profile.mjs';
const base=new URL('../docs/receipts/2026-10-02-wasm-isolated-gpio/',import.meta.url);
const bytes=p=>readFileSync(new URL(p,base));
const manifest=JSON.parse(bytes('manifest.json'));
const hash=b=>createHash('sha256').update(b).digest('hex');
const raw=path=>{
 const f=manifest.files.find(f=>(f.original?.path??f.path)===path);assert.ok(f,`Missing original ${path}`);
 return f.original?Buffer.from(JSON.parse(bytes(f.path)).data,f.original.encoding):bytes(f.path);
};
const json=p=>JSON.parse(raw(p));
const ids=[null,37048440399,37048740665,37049199265];
const heads=[null,'d06d8c183d3c11d3ab65eb20a6b9c8b61c985ea2','d06d8c183d3c11d3ab65eb20a6b9c8b61c985ea2','3a6562ff588b65293bcae5afeafea0d59b63bc14'];
test('isolated GPIO corpus preserves every original and failed capture',()=>{
 assert.equal(manifest.diagnosticOnly,true);assert.equal(manifest.hostedOnly,true);
 assert.equal(new Set(manifest.files.map(f=>f.original?.path??f.path)).size,manifest.files.length);
 for(const f of manifest.files){
  assert.equal(bytes(f.path).length,f.bytes);assert.equal(hash(bytes(f.path)),f.sha256);
  if(f.original){assert.equal(raw(f.original.path).length,f.original.bytes);assert.equal(hash(raw(f.original.path)),f.original.sha256);}
 }
 for(const i of [1,2,3]){
  const run=json(`run-${i}-api.json`),a=json(`run-${i}-artifact-api.json`).artifacts;
  assert.equal(run.headSha,heads[i]);assert.equal(run.url,`https://github.com/CrispStrobe/bw-board/actions/runs/${ids[i]}`);
  assert.equal(run.status,'completed');assert.equal(run.conclusion,i===2?'failure':'success');
  assert.equal(a.length,1);assert.equal(a[0].name,'active-f0-main-profile-diagnostic');assert.equal(a[0].workflow_run.id,ids[i]);
  assert.equal(a[0].workflow_run.head_sha,heads[i]);assert.ok(a[0].size_in_bytes>0&&a[0].size_in_bytes<4*1024*1024);
 }
});
test('all three ordinary captures and sampled GPIO proofs reparse without dropping failed floors',()=>{
 for(const i of [1,2,3]){
  const prefix=`run-${i}/`,both=json(prefix+'f0/receipt.json'),gpio=json(prefix+'gpio-only/receipt.json');
  for(const r of [both,gpio]){
   assert.equal(r.node,'v22.23.3');assert.equal(r.diagnosticOnly,true);
   assert.equal(r.buildInfo.ref,'43b2d62f5a0fa24ae0b38a645069f5aaa78af685');
   assert.equal(r.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256,'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d');
   assert.equal(r.buildInfo.targets.nodejs['labwired_wasm.js'].sha256,'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73');
   assert.deepEqual(r.buildInfo,json(prefix+'build-info.json'));assert.deepEqual(r.ordinary.flags,[]);
   for(const [path,h] of Object.entries(r.files))assert.equal(hash(raw(`tool-source/${heads[i]}/${path}`)),h);
  }
  const ordinary=f0TimingResult(raw(prefix+'f0/ordinary-stdout.txt').toString(),both.ordinary.exitCode);
  assert.deepEqual(ordinary.workloads,both.ordinary.workloads);assert.equal(both.ordinary.signal,null);
  for(const label of ['ordinary','sampled']){
   assert.equal(gpio[label].signal,null);assert.equal(gpio[label].error,undefined);
   const p=f0GpioTimingResult(raw(prefix+`gpio-only/${label}-stdout.txt`).toString(),gpio[label].exitCode);
   assert.deepEqual(p.workloads,gpio[label].workloads);assert.equal(p.allWindowsMeet1x,gpio[label].allWindowsMeet1x);
  }
  assertSameGpioGuest(ordinary,gpio.ordinary);assertSameGpioGuest(gpio.ordinary,gpio.sampled);
  assert.deepEqual(gpio.sampled.flags.filter(f=>!f.startsWith('--cpu-prof-dir=')),['--cpu-prof','--cpu-prof-name=f0-gpio.cpuprofile']);
  for(const head of new Set(heads.slice(1))){
   const ordinarySource=raw(`tool-source/${head}/test/labwired-f0-timing.test.mjs`).toString();
   assert.equal(raw(`tool-source/${head}/test/labwired-f0-gpio-profile.test.mjs`).toString(),ordinarySource.replace("for (const workload of ['ram', 'gpio'])","for (const workload of ['gpio'])"));
  }
 }
});
test('raw CPU profiles reconstruct both valid summaries and the rejected negative-delta repeat',()=>{
 for(const i of [1,2,3]){
  const r=json(`run-${i}/gpio-only/receipt.json`),data=raw(`run-${i}/gpio-only/f0-gpio.cpuprofile`),p=JSON.parse(data);
  if(i===2){
   assert.equal(r.completedAt,undefined);assert.equal(r.sampled.profile,undefined);
   assert.throws(()=>summarizeCpuProfile(p),/Invalid CPU profile sample/);
   const failure=json('run-2-invalid-profile.json');assert.equal(failure.attributionAvailable,false);
   assert.equal(failure.profileSha256,hash(data));
   assert.deepEqual(p.timeDeltas.flatMap((delta,index)=>delta<0?[{index,delta}]:[]),[{index:7742,delta:-2}]);
  }else{
   assert.ok(r.completedAt);assert.equal(hash(data),r.sampled.profileSha256);
   assert.deepEqual(summarizeCpuProfile(p),{...r.sampled.profile,topWasmFrames:r.sampled.profile.topWasmFrames.map(({wasmName,...f})=>f)});
   const proof=json(`run-${i}-verified.json`);assert.equal(proof.profileSha256,hash(data));
   assert.deepEqual(proof.topWasmFrames,r.sampled.profile.topWasmFrames.map(({wasmName,...f})=>f));
  }
 }
});
