import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {verifySameHostPair,FROZEN_HARNESS,SAME_HOST_ENGINES,SAME_HOST_ORDERS} from '../scripts/lib/same-host-orders.mjs';
import {assertSameMotionGuest} from '../scripts/lib/motion-ab-receipt.mjs';
import {assertSameF0Guest} from '../scripts/lib/f0-timing-receipt.mjs';
const archive=new URL('../docs/receipts/2026-10-03-wasm-same-host-orders/',import.meta.url);
const bytes=path=>readFileSync(new URL(path,archive)),hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(bytes('manifest.json'));
const original=path=>{
 const f=manifest.files.find(f=>(f.original?.path??f.path)===path);assert(f,'Missing '+path);
 return f.original?Buffer.from(JSON.parse(bytes(f.path)).data,f.original.encoding):bytes(f.path);
};
const json=path=>JSON.parse(original(path));
const head='b00bff0b266eacb7dc975225cf23120fb931ccac',runId='37119884143';
test('same-host archive binds every original byte and exact frozen provenance',()=>{
 assert.equal(manifest.toolHead,head);assert.equal(manifest.runId,runId);
 assert.equal(manifest.frozenHarness,FROZEN_HARNESS);assert.equal(manifest.timingWindows,480);
 assert.equal(manifest.diagnosticOnly,true);assert.equal(manifest.hostedOnly,true);
 const paths=manifest.files.map(f=>f.original?.path??f.path);assert.equal(new Set(paths).size,paths.length);
 for(const f of manifest.files){
  const data=bytes(f.path);assert.equal(data.length,f.bytes);assert.equal(hash(data),f.sha256);
  assert(!/\.(wasm|elf|bin|cpuprofile)$/.test(f.path));
  if(f.original){const data=original(f.original.path);assert.equal(data.length,f.original.bytes);assert.equal(hash(data),f.original.sha256);}
 }
 for(const path of ['pipeline.json','run.json','artifacts.json','source-contract.json','capture-same-host-orders.mjs','land-pr301-after-checks.mjs','pr301-landing.json'])assert(paths.includes(path));
 const p=json('pipeline.json');assert(p.completedAt);assert.equal(p.head,head);
 assert.equal(p.timingWindows,480);assert.equal(p.localEngineDownloads,false);assert.equal(p.enginePromotion,false);assert.equal(p.physicalAcknowledgementChanges,false);
 assert.deepEqual(p.engines,SAME_HOST_ENGINES);
});
test('all eight same-host pairs independently reparse 480 windows, including losses and failed floors',()=>{
 const p=json('pipeline.json');assert.equal(p.captures.length,8);let first,windows=0;
 for(const node of ['20.20.2','22.23.3']){
  const prefix='same-host-orders-node-'+node+'/',r=json(prefix+'repeats/receipt.json');
  assert.equal(r.node,'v'+node);assert.equal(r.toolCommit,head);assert.equal(r.harness,FROZEN_HARNESS);
  assert.equal(r.workflowRun,runId);assert(r.completedAt&&!r.error);assert.equal(r.pairs.length,4);
  assert.deepEqual(r.orders,SAME_HOST_ORDERS);assert.deepEqual(r.flags,[]);assert.deepEqual(r.engines,SAME_HOST_ENGINES);
  assert(original(prefix+'runner.txt').toString().includes(head));
  for(const label of ['baseline','candidate'])assert.deepEqual(json(prefix+label+'-build-info.json'),r.buildInfo[label]);
  const members=json('members-node-'+node+'.json');
  for(const [path,binding]of Object.entries(members.members)){const data=original(prefix+path);assert.equal(data.length,binding.bytes);assert.equal(hash(data),binding.sha256);}
  for(const [index,pair]of r.pairs.entries()){
   assert.equal(pair.index,index);assert.equal(pair.reverse,SAME_HOST_ORDERS[index]);assert.equal(pair.cpu,r.cpu);assert(pair.completedAt);
   assert.deepEqual(pair.children.map(c=>c.label),['motion','f0']);
   for(const c of pair.children){assert.equal(c.exitCode,0);assert.equal(c.signal,null);assert.equal(c.error,undefined);}
   const dir=prefix+'repeats/pair-'+(index+1)+'/';
   for(const [path,binding]of Object.entries(pair.receipts)){const data=original(dir+path);assert.equal(data.length,binding.bytes);assert.equal(hash(data),binding.sha256);}
   const motion=json(dir+'abba.json'),f0=json(dir+'f0-abba/abba.json');
   assert.equal(motion.cpu,r.cpu);assert.equal(f0.cpu,r.cpu);
   for(const [i,run]of f0.runs.entries()){
    assert.deepEqual(json(dir+`f0-abba/${i+1}-${run.label}/receipt.json`),run.capture);
    assert.deepEqual(run.capture.buildInfo,r.buildInfo[run.label]);
   }
   const parsed=verifySameHostPair({motion,f0,stdoutFor:(i,label)=>original(dir+`f0-abba/${i+1}-${label}/ordinary-stdout.txt`).toString()},index,'v'+node);
   assert.deepEqual(pair.summary,{motion:parsed.motion,f0:parsed.f0});
   const summary=p.captures.find(c=>c.node===node&&c.pair===index+1);
   assert.deepEqual(summary,{node,pair:index+1,reverse:pair.reverse,cpu:r.cpu,...pair.summary});
   if(first){assertSameMotionGuest(first.motionGuest,parsed.motionGuest);assertSameF0Guest(first.f0Guest,parsed.f0Guest);}else first=parsed;
   windows+=motion.runs.reduce((n,r)=>n+r.samples.length,0)+f0.runs.reduce((n,r)=>n+r.capture.ordinary.workloads.ram.samples.length+r.capture.ordinary.workloads.gpio.samples.length,0);
  }
 }
 assert.equal(windows,480);
});
test('actual hosted jobs and exact-head tooling landing retain all enabled checks',()=>{
 const run=json('run.json');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');assert.equal(run.headSha,head);assert.equal(run.jobs.length,2);
 for(const job of run.jobs){assert.equal(job.conclusion,'success');const raw=json(`job-${job.databaseId}-log.json`);assert.deepEqual(raw.job,job);assert(raw.log.includes('probe-labwired-same-host-orders.mjs'));}
 const landing=json('pr301-landing.json');assert.equal(landing.head,head);assert.equal(landing.after.state,'MERGED');assert.equal(landing.after.headRefOid,head);
 const checks=landing.pr.statusCheckRollup;assert.equal(checks.length,14);assert(checks.every(c=>c.status==='COMPLETED'));
 assert.equal(checks.filter(c=>c.conclusion==='SUCCESS').length,12);
 const skipped=checks.filter(c=>c.conclusion==='SKIPPED');assert.equal(skipped.length,2);assert(skipped.every(c=>c.name==='vectors-full'));
 for(const node of ['20.20.2','22.23.3'])assert.equal(checks.filter(c=>c.name==='Repeated ordinary orders Node '+node&&c.conclusion==='SUCCESS').length,1);
 assert.equal(landing.engineMerge,false);assert.equal(landing.physicalAcknowledgementChanges,false);
});
test('same-host source contract changes only diagnostics and uses frozen parser bytes',()=>{
 const c=json('source-contract.json');assert.equal(c.head,head);assert.equal(c.frozenHarness,FROZEN_HARNESS);
 for(const key of ['engineModified','ordinaryHarnessModified','physicalAcknowledgementsModified'])assert.equal(c[key],false);
 assert.deepEqual(c.changed,['.github/workflows/labwired-same-host-orders.yml','scripts/lib/same-host-orders.mjs','scripts/probe-labwired-same-host-orders.mjs','test/same-host-orders.test.mjs']);
 for(const file of ['scripts/lib/same-host-orders.mjs','scripts/probe-labwired-same-host-orders.mjs','.github/workflows/labwired-same-host-orders.yml'])assert.equal(hash(original('tool-source/'+file)),c.files[file]);
 for(const file of ['scripts/lib/motion-ab-receipt.mjs','scripts/lib/f0-timing-receipt.mjs'])assert.equal(hash(readFileSync(new URL('../'+file,import.meta.url))),c.parsers[file]);
});
