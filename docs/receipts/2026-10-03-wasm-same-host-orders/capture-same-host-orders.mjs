import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,existsSync,statfsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {verifySameHostPair,FROZEN_HARNESS,SAME_HOST_ENGINES,SAME_HOST_ORDERS} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/same-host-orders.mjs';
import {assertSameMotionGuest} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/motion-ab-receipt.mjs';
import {assertSameF0Guest} from '/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002/scripts/lib/f0-timing-receipt.mjs';
const exec=promisify(execFile), repo='CrispStrobe/bw-board';
const wt='/mnt/volume1/code/lego/wt-bw-fastpath-census-20261002';
const root='/tmp/labwired-same-host-20261003.R0T0cC/same-host-orders-20261003';
const head='b00bff0b266eacb7dc975225cf23120fb931ccac',base='9a3ed736c51b4ed85a80824c3411bbe5692a5319',runId='37119884143';
assert(!existsSync(root+'/pipeline.json'),'Existing final capture: inspect; do not repeat downloads');
const command=async(cmd,args,options={})=>(await exec(cmd,args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024,...options})).stdout;
const gh=async args=>{for(let i=0;;i++){try{return await command('gh',args);}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,2000));}}};
const hash=b=>createHash('sha256').update(b).digest('hex');
async function save(path,value){
 const text=JSON.stringify(value,null,2)+'\n';
 if(existsSync(path)){assert.equal(readFileSync(path,'utf8'),text);return;}
 const task=exec('apply_patch',[],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});
 task.child.stdin.end(`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`);await task;
}
const git=args=>command('git',args,{cwd:wt});
assert.equal((await git(['rev-parse','HEAD'])).trim(),head);
const changed=(await git(['diff','--name-only',base,head])).trim().split('\n');
assert.deepEqual(changed,['.github/workflows/labwired-same-host-orders.yml','scripts/lib/same-host-orders.mjs','scripts/probe-labwired-same-host-orders.mjs','test/same-host-orders.test.mjs']);
const files={};
for(const file of changed)files[file]=hash(await git(['show',head+':'+file]));
const parsers={};
for(const file of ['scripts/lib/motion-ab-receipt.mjs','scripts/lib/f0-timing-receipt.mjs']){
 const bytes=await git(['show',head+':'+file]);assert.equal(bytes,await git(['show',FROZEN_HARNESS+':'+file]));parsers[file]=hash(bytes);
}
await save(root+'/source-contract.json',{head,base,changed,files,parsers,frozenHarness:FROZEN_HARNESS,engineModified:false,ordinaryHarnessModified:false,physicalAcknowledgementsModified:false});
let run;
const deadline=Date.now()+6*60*60*1000;
while(Date.now()<deadline){
 run=JSON.parse(await gh(['run','view',runId,'-R',repo,'--json','status,conclusion,headSha,jobs,url']));
 assert.equal(run.headSha,head);
 if(run.status==='completed')break;
 console.log(new Date().toISOString(),run.status,run.jobs.map(j=>j.name+':'+j.status).join(', '));
 await new Promise(r=>setTimeout(r,45000));
}
assert.equal(run.status,'completed','Monitoring deadline; no writes to GitHub');
await save(root+'/run.json',run);
const listing=JSON.parse(await gh(['api',`repos/${repo}/actions/runs/${runId}/artifacts`]));
await save(root+'/artifacts.json',listing);
// Full job logs preserve failures. No engine artifacts are requested.
for(const job of run.jobs){
 const log=await gh(['api',`repos/${repo}/actions/jobs/${job.databaseId}/logs`]);
 await save(root+`/job-${job.databaseId}-log.json`,{job,log});
}
const downloaded=[];
for(const node of ['20.20.2','22.23.3']){
 const name='same-host-orders-node-'+node,found=listing.artifacts.filter(a=>a.name===name);
 if(!found.length)continue;
 assert.equal(found.length,1);const artifact=found[0];
 assert(!artifact.expired&&artifact.size_in_bytes>0&&artifact.size_in_bytes<4*1024*1024);
 const disk=statfsSync(root);assert(disk.bavail*disk.bsize>128*1024*1024,'Disk reserve');
 const dir=root+'/'+name;assert(!existsSync(dir),'Existing download: inspect, never overwrite');
 await command('gh',['run','download',runId,'-R',repo,'--name',name,'--dir',dir]);downloaded.push({node,dir,artifact});
}
// Preserve partial outputs before rejecting failed hosted jobs.
assert.equal(run.conclusion,'success','Hosted failure retained; inspect raw logs and partial receipts');
assert.equal(run.jobs.length,2);assert(run.jobs.every(j=>j.conclusion==='success'));
assert.equal(downloaded.length,2);
let first;const captures=[];
for(const {node,dir,artifact} of downloaded){
 const receipt=JSON.parse(readFileSync(dir+'/repeats/receipt.json'));
 assert.equal(receipt.schema,1);assert.equal(receipt.hostedOnly,true);assert.equal(receipt.diagnosticOnly,true);
 assert.equal(receipt.harness,FROZEN_HARNESS);assert.equal(receipt.toolCommit,head);
 assert.equal(receipt.workflowRun,runId);assert.equal(receipt.node,'v'+node);
 assert(receipt.completedAt&&!receipt.error);assert.deepEqual(receipt.orders,SAME_HOST_ORDERS);
 assert.deepEqual(receipt.flags,[]);assert.deepEqual(receipt.engines,SAME_HOST_ENGINES);
 assert.equal(receipt.pairs.length,4);
 const runner=readFileSync(dir+'/runner.txt','utf8');assert(runner.includes(head)&&runner.includes(FROZEN_HARNESS));
 for(const label of ['baseline','candidate'])assert.deepEqual(JSON.parse(readFileSync(dir+'/'+label+'-build-info.json')),receipt.buildInfo[label]);
 for(const [index,pair]of receipt.pairs.entries()){
  assert.equal(pair.index,index);assert.equal(pair.reverse,SAME_HOST_ORDERS[index]);assert(pair.completedAt);
  assert.equal(pair.cpu,receipt.cpu);assert.equal(pair.children.length,2);
  assert.deepEqual(pair.children.map(c=>c.label),['motion','f0']);
  for(const c of pair.children){assert.equal(c.exitCode,0);assert.equal(c.signal,null);assert.equal(c.error,undefined);}
  const directory=dir+'/repeats/pair-'+(index+1);
  for(const [path,binding]of Object.entries(pair.receipts)){
   const bytes=readFileSync(join(directory,path));assert.equal(bytes.length,binding.bytes);assert.equal(hash(bytes),binding.sha256);
  }
  const motion=JSON.parse(readFileSync(directory+'/abba.json')),f0=JSON.parse(readFileSync(directory+'/f0-abba/abba.json'));
  assert.equal(motion.cpu,receipt.cpu);assert.equal(f0.cpu,receipt.cpu);
  for(const r of f0.runs)assert.deepEqual(r.capture.buildInfo,receipt.buildInfo[r.label]);
  const parsed=verifySameHostPair({motion,f0,stdoutFor:(i,label)=>readFileSync(directory+`/f0-abba/${i+1}-${label}/ordinary-stdout.txt`,'utf8')},index,'v'+node);
  assert.deepEqual(pair.summary,{motion:parsed.motion,f0:parsed.f0});
  if(first){assertSameMotionGuest(first.motionGuest,parsed.motionGuest);assertSameF0Guest(first.f0Guest,parsed.f0Guest);}else first=parsed;
  const summary={node,pair:index+1,reverse:pair.reverse,cpu:receipt.cpu,...pair.summary};captures.push(summary);console.log(JSON.stringify(summary));
 }
 // Bind every downloaded raw member, explicitly excluding engine bytes.
 const members={};
 function walk(path,relative=''){for(const entry of readdirSync(path,{withFileTypes:true})){
  const rel=relative+entry.name;
  if(entry.isDirectory())walk(join(path,entry.name),rel+'/');else{
   assert(entry.isFile());assert(!/\.(wasm|elf|bin|cpuprofile)$/.test(rel));assert(!rel.endsWith('labwired_wasm.js'));
   const bytes=readFileSync(join(path,entry.name));members[rel]={bytes:bytes.length,sha256:hash(bytes)};
  }
 }}walk(dir);
 await save(root+'/members-node-'+node+'.json',{node,artifact,members});
}
await save(root+'/pipeline.json',{schema:1,head,runId,frozenHarness:FROZEN_HARNESS,engines:SAME_HOST_ENGINES,captures,timingWindows:480,completedAt:new Date().toISOString(),localEngineDownloads:false,enginePromotion:false,physicalAcknowledgementChanges:false,limitations:['Small repeated order diagnostic, not statistical significance or all-target qualification','Each runtime uses its own hosted VM; CPU/load differences prohibit runtime causality claims']});
console.log('All eight pairs and 480 ordinary windows independently verified; no engine promotion.');
