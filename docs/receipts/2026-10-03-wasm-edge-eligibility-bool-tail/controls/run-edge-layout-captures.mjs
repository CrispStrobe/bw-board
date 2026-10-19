import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,existsSync,statfsSync} from 'node:fs';
import {createHash} from 'node:crypto';
const exec=promisify(execFile),repo='CrispStrobe/bw-board';
const parent='/tmp/labwired-same-host-20261003.R0T0cC',root=parent+'/edge-layout-inspection-20261003';
const toolRef='perf/wasm-edge-layout-inspection-20261003',toolHead='43b82467b25b7913df46dab4c15d177b7e0c3281';
const workflow='labwired-edge-layout.yml',path=root+'/pipeline.json';
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
async function dispatch(target){
 assert.equal((await read(['api',`repos/${repo}/git/ref/heads/${toolRef}`,'--jq','.object.sha'])).trim(),toolHead);
 state.targets.push(target);target.dispatchAttemptedAt=new Date().toISOString();state.dispatchPending=target.label;await persist();
 // No retry of writes: ambiguous outcomes must be inspected, never redispatched.
 await gh(['workflow','run',workflow,'-R',repo,'--ref',toolRef,'-f','build_run='+target.buildRun,'-f','core_ref='+target.core,'-f','wasm_sha='+target.wasm,'-f','glue_sha='+target.glue,'-f','vtable_words='+target.words]);
 target.dispatchReturnedAt=new Date().toISOString();await persist();
 for(let i=0;i<12;i++){
  const runs=JSON.parse(await read(['run','list','-R',repo,'--workflow',workflow,'--branch',toolRef,'--event','workflow_dispatch','--limit','20','--json','databaseId,headSha,createdAt,url,status']));
  const matches=runs.filter(r=>r.headSha===toolHead&&Date.parse(r.createdAt)>=Date.parse(target.dispatchAttemptedAt)-1000);
  assert(matches.length<=1,'Ambiguous inspection dispatch');
  if(matches.length){target.run=matches[0].databaseId;delete state.dispatchPending;await persist();return;}
  await new Promise(r=>setTimeout(r,5000));
 }
 throw Error('Dispatch returned without visible run ID; inspect existing remote, no redispatch');
}
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
 const found=listing.artifacts.filter(a=>a.name==='compiled-edge-layout-inspection');assert(found.length<=1);
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
 assert.deepEqual(provenance,{buildRun:String(t.buildRun),coreCommit:t.core,wasmSha256:t.wasm,glueSha256:t.glue,vtableWords:t.words,toolCommit:toolHead,diagnosticOnly:true,engineExecution:false});
 if(t.buildInfo)assert.deepEqual(info,t.buildInfo);
 const selected=JSON.parse(readFileSync(dir+'/selected-layout.json')),prefix=JSON.parse(readFileSync(dir+'/selected-prefix.json'));
 for(const [k,v]of Object.entries(provenance))assert.deepEqual(selected[k],v);
 assert.deepEqual(selected.fullWat,JSON.parse(readFileSync(dir+'/disassembly-provenance.json')));
 assert(selected.fullWat.bytes>0);assert.match(selected.fullWat.sha256,/^[a-f0-9]{64}$/);
 const table=new Map();
 for(const line of selected.elements){const m=line.match(/^  \(elem .*?\(i32.const (\d+)\) func (.*)\)$/);assert(m);m[2].split(/\s+/).forEach((name,i)=>table.set(Number(m[1])+i,name));}
 const bodies=new Map(selected.functions.map(f=>[f.header.match(/^  \(func (\S+)/)?.[1],f]));
 for(const v of selected.vtableCandidates){
  assert.equal(v.address,v.segmentAddress+v.segmentByteOffset);assert.match(v.rawBytesHex,/^[a-f0-9]+$/);
  const bytes=Buffer.from(v.rawBytesHex,'hex');assert.equal(bytes.length,t.words*4);
  const words=Array.from({length:t.words},(_,i)=>bytes.readUInt32LE(i*4));assert.deepEqual(words,v.words);
  assert.deepEqual(v.slots,words.map((value,i)=>({offset:i*4,value,symbol:i===1||i===2?null:table.get(value)||null})));
  assert(prefix.vtableCandidates.some(p=>p.address===v.address&&JSON.stringify(p.words)===JSON.stringify(v.words.slice(0,14))));
 }
 const buttons=selected.vtableCandidates.filter(v=>v.slots.some(s=>/Button.*as_sim_input/.test(s.symbol||'')));assert(buttons.length);
 for(const v of buttons)for(const s of v.slots)if(s.symbol){const body=bodies.get(s.symbol);assert(body,'Missing bound original body');assert(body.wat.startsWith(body.header));}
 for(const f of prefix.functions)assert.deepEqual(bodies.get(f.header.match(/^  \(func (\S+)/)?.[1]),f);
 t.buttons=buttons;t.fullWat=selected.fullWat;t.selectedSha256=hash(readFileSync(dir+'/selected-layout.json'));t.completedAt=new Date().toISOString();await persist();
 console.log(JSON.stringify({label:t.label,run:t.run,buttons:buttons.map(v=>({address:v.address,slots:v.slots}))}));
}
try{
 const baseline={label:'baseline',run:37123288945,buildRun:36915940413,core:'43b2d62f5a0fa24ae0b38a645069f5aaa78af685',wasm:'7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d',glue:'b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73',words:18};
 state.targets.push(baseline);await persist();
 const middle={label:'middle',buildRun:37117416202,core:'14a275f63daaf3cd4af4b1845e52678032553522',wasm:'7311d6240fc5ea92489adbcd5d396e13f30113652f70bb0515825fb7ef46d07d',glue:'aa623d1543276fb7ea3dc4bd4efe66bc109202e8d863737c6ac5106313560351',words:19};
 await dispatch(middle);
 await capture(baseline);await capture(middle);
 const pipelinePath=parent+'/edge-eligibility-bool-tail-20261003/pipeline.json',deadline=Date.now()+6*60*60*1000;
 let p;
 while(Date.now()<deadline){
  if(existsSync(pipelinePath)){try{p=JSON.parse(readFileSync(pipelinePath));}catch(e){if(!(e instanceof SyntaxError))throw e;}}
  if(p?.error)throw Error('Engine evaluation failed: '+p.error);
  if(p?.verifications?.candidate)break;
  console.log('Awaiting independently verified tail module/glue; no dispatch');await new Promise(r=>setTimeout(r,45000));
 }
 assert(p?.verifications?.candidate);const c=p.sources.candidate,v=p.verifications.candidate;
 assert.equal(c.commit,'226fe97835bb5bed06cbb377b3d218c661937a49');assert.equal(v.integrationTests,108);assert.equal(v.buildInfo.ref,c.commit);
 const tail={label:'tail',buildRun:c.run,core:c.commit,wasm:v.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256,glue:v.buildInfo.targets.nodejs['labwired_wasm.js'].sha256,words:19,buildInfo:v.buildInfo};
 await dispatch(tail);await capture(tail);
 state.completedAt=new Date().toISOString();await persist();console.log('All three actual compiled inspections verified; not execution, causality or performance evidence.');
}catch(e){state.error=e.message;state.stoppedAt=new Date().toISOString();await persist();throw e;}
