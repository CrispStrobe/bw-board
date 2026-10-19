import {selectCpuWat} from "/tmp/labwired-same-host-20261003.R0T0cC/bw-board-docs/scripts/lib/wasm-cpu-inspection.mjs";
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,existsSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),repo='CrispStrobe/bw-board';
const parent='/tmp/labwired-same-host-20261003.R0T0cC',root=parent+'/cpu-hotpath-inspection-r3-20261003';
const toolRef='perf/wasm-cpu-hotpath-inspection-20261003',toolHead='02c6e40b5cfc3388b86077ffeb4e2d4d643026f3';
const workflow='labwired-cpu-inspection.yml',path=root+'/pipeline.json';
assert(!existsSync(path),'Existing controller state: inspect, do not duplicate dispatches');
const gh=async args=>(await exec('gh',args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024})).stdout;
const read=async args=>{for(let i=0;;i++){try{return await gh(args);}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,2000));}}};
const state={schema:1,toolHead,toolRef,hostedOnly:true,diagnosticOnly:true,engineExecution:false,enginePromotion:false,localEngineDownloads:false,targets:[],startedAt:new Date().toISOString()};
async function save(file,value){
 const text=JSON.stringify(value,null,2)+'\n';
 const patch=existsSync(file)?`*** Update File: ${file}\n@@\n${readFileSync(file,'utf8').trimEnd().split('\n').map(l=>'-'+l).join('\n')}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}`:`*** Add File: ${file}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}`;
 const task=exec('apply_patch',[],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});task.child.stdin.end('*** Begin Patch\n'+patch+'\n*** End Patch\n');await task;
}
const persist=()=>save(path,state),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
await persist();
async function capture(t){
 let run;const deadline=Date.now()+6*60*60*1000;
 while(Date.now()<deadline){
  run=JSON.parse(await read(['run','view',String(t.run),'-R',repo,'--json','headSha,status,conclusion,jobs,url']));assert.equal(run.headSha,toolHead);
  if(run.status==='completed')break;
  console.log(t.label,run.status);await new Promise(r=>setTimeout(r,45000));
 }
 assert.equal(run.status,'completed');await save(root+'/'+t.label+'-run.json',run);
 for(const j of run.jobs)await save(root+`/${t.label}-job-${j.databaseId}-log.json`,{job:j,log:await read(['api',`repos/${repo}/actions/jobs/${j.databaseId}/logs`])});
 const listing=JSON.parse(await read(['api',`repos/${repo}/actions/runs/${t.run}/artifacts`]));await save(root+'/'+t.label+'-artifacts.json',listing);
 const found=listing.artifacts.filter(a=>a.name==='compiled-cpu-hotpath-inspection');assert(found.length<=1);
 let dir;
 if(found.length){
  const a=found[0];assert(!a.expired&&a.size_in_bytes>0&&a.size_in_bytes<4*1024*1024);
  const disk=statfsSync(root);assert(disk.bavail*disk.bsize>=128*1024*1024,'Receipt disk reserve');
  dir=root+'/'+t.label;assert(!existsSync(dir),'Never overwrite partial download');
  await gh(['run','download',String(t.run),'-R',repo,'--name',a.name,'--dir',dir]);t.artifact=a;await persist();
 }
 // Raw failed outputs are preserved before success is required.
 assert.equal(run.conclusion,'success','Original failure retained; no automatic retry');assert(dir);
 const info=JSON.parse(readFileSync(dir+'/build-info.json')),provenance=JSON.parse(readFileSync(dir+'/provenance.json'));
 assert.equal(info.ref,t.core);assert.equal(info.targets.nodejs['labwired_wasm_bg.wasm'].sha256,t.wasm);assert.equal(info.targets.nodejs['labwired_wasm.js'].sha256,t.glue);
 assert.deepEqual(provenance,{buildRun:String(t.buildRun),coreCommit:t.core,wasmSha256:t.wasm,glueSha256:t.glue,toolCommit:toolHead,diagnosticOnly:true,engineExecution:false});
 if(t.buildInfo)assert.deepEqual(info,t.buildInfo);
 const selected=JSON.parse(readFileSync(dir+"/selected-cpu.json"));
 for(const [k,v]of Object.entries(provenance))assert.deepEqual(selected[k],v);
 assert.deepEqual(selected.fullWat,JSON.parse(readFileSync(dir+"/disassembly-provenance.json")));
 assert(selected.fullWat.bytes>0);assert.match(selected.fullWat.sha256,/^[a-f0-9]{64}$/);
 assert(selected.totalBodyBytes>0&&selected.totalBodyBytes<=16*1024*1024);
 assert.equal(selected.bodyFiles.length,selected.functions.length);
 const bodies=selected.bodyFiles.map((entry,index)=>{
  assert.equal(entry.name,selected.functions[index].name);
  const parts=entry.chunks.map((chunk)=>{
   assert.match(chunk.path,/^body-[0-9]+-[0-9]+\.txt$/);
   const raw=readFileSync(dir+"/"+chunk.path);
   assert(raw.length>0&&raw.length<=512*1024);assert.equal(raw.length,chunk.bytes);assert.equal(hash(raw),chunk.sha256);
   return raw;
  });
  const raw=Buffer.concat(parts);assert.equal(raw.length,selected.functions[index].watBytes);assert.equal(hash(raw),selected.functions[index].watSha256);
  const text=raw.toString("utf8");assert(Buffer.from(text).equals(raw));assert(text.startsWith(selected.functions[index].header));return text;
 });
 assert.equal(bodies.reduce((n,b)=>n+Buffer.byteLength(b),0),selected.totalBodyBytes);
 const reparsed=selectCpuWat([...selected.types,...bodies].join("\n"),{metadataOnly:true});
 for(const key of ["functions","types","absentLabels","limitations"])assert.deepEqual(selected[key],reparsed[key]);
 assert(readFileSync(dir+"/selected-cpu.json").length<2*1024*1024);
 t.fullWat=selected.fullWat;t.selectedSha256=hash(readFileSync(dir+"/selected-cpu.json"));t.completedAt=new Date().toISOString();await persist();
 console.log(JSON.stringify({run:t.run,functions:selected.functions.map(f=>({name:f.name,watBytes:f.watBytes,memoryOps:f.memoryOps,directCalls:f.directCalls})),absentLabels:selected.absentLabels}));
}
try{
 const baseline={label:"baseline",run:37142255303,buildRun:36915940413,core:"43b2d62f5a0fa24ae0b38a645069f5aaa78af685",wasm:"7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d",glue:"b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73"};
 state.targets.push(baseline);await persist();await capture(baseline);
 state.completedAt=new Date().toISOString();await persist();console.log("Original production CPU inspection verified; not execution or performance evidence.");
}catch(e){state.error=e.message;state.stoppedAt=new Date().toISOString();await persist();throw e;}
