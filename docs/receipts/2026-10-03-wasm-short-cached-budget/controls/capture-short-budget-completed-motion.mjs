import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync} from 'node:fs';
import {motionProbeResult} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/motion-ab-receipt.mjs';
const exec=promisify(execFile),repo='CrispStrobe/bw-board',runId='37136931155';
const root='/tmp/labwired-same-host-20261003.R0T0cC/short-cached-budget-20261003';
const gh=async args=>(await exec('gh',args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024})).stdout;
async function add(file,value){
 const text=JSON.stringify(value,null,2)+'\n';if(existsSync(file)){assert.equal(readFileSync(file,'utf8'),text);return;}
 const task=exec('apply_patch',[],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});task.child.stdin.end(`*** Begin Patch\n*** Add File: ${file}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`);await task;
}
const run=JSON.parse(await gh(['run','view',runId,'-R',repo,'--json','status,conclusion,headSha,jobs,url']));
assert.equal(run.headSha,'d1f2c8ebfc5e4e76d5fc81f930588c13de13e974');
const results={runId,toolHead:run.headSha,source:'565dce2b35c67c4661055443ce9bb5d47039249e',partialRun:true,publication:false,enginePromotion:false};
for(const name of ['motion']){
 const job=run.jobs.find(j=>j.name===name);assert.equal(job?.status,'completed');
 const log=await gh(['api',`repos/${repo}/actions/jobs/${job.databaseId}/logs`]);
 await add(root+'/completed-'+name+'-job-log.json',{job,log});
 const text=log.split('\n').map(l=>l.replace(/^\d{4}-\d\d-\d\dT\S+ /,'')).join('\n');
 if(name==='test'){
  assert.equal(job.conclusion,'success');for(const [key,value]of [['tests',108],['pass',108],['fail',0],['cancelled',0],['skipped',0],['todo',0]])assert.match(text,new RegExp(`^# ${key} ${value}$`,'m'));
  results.actualWasmIntegrations=108;
 }else{
  const parsed=motionProbeResult(text,job.conclusion==='success'?0:1);
  results.freshMotion=parsed;
 }
}
await add(root+'/completed-motion-observation.json',results);
console.log(JSON.stringify({actualWasmIntegrations:results.actualWasmIntegrations,freshMotionMedian:results.freshMotion.medianRtx,freshMotionMinimum:results.freshMotion.minimumRtx,allWindowsMeet1x:results.freshMotion.allWindowsMeet1x,pairedSpeedup:false}));
