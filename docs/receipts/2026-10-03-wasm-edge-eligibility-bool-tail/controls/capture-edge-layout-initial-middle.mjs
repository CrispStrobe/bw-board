import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync,statfsSync} from 'node:fs';
const exec=promisify(execFile),repo='CrispStrobe/bw-board',runId='37123517754';
const root='/tmp/labwired-same-host-20261003.R0T0cC/edge-layout-inspection-20261003';
const gh=async args=>(await exec('gh',args,{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024})).stdout;
async function save(path,value){
 const text=JSON.stringify(value,null,2)+'\n';
 if(existsSync(path)){assert.equal(readFileSync(path,'utf8'),text);return;}
 const task=exec('apply_patch',[],{encoding:'utf8',timeout:30000,maxBuffer:8*1024*1024});task.child.stdin.end(`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`);await task;
}
const run=JSON.parse(await gh(['run','view',runId,'-R',repo,'--json','headSha,status,conclusion,jobs,url']));
assert.equal(run.headSha,'43b82467b25b7913df46dab4c15d177b7e0c3281');assert.equal(run.status,'completed');
await save(root+'/middle-run.json',run);
for(const j of run.jobs)await save(root+`/middle-job-${j.databaseId}-log.json`,{job:j,log:await gh(['api',`repos/${repo}/actions/jobs/${j.databaseId}/logs`])});
const listing=JSON.parse(await gh(['api',`repos/${repo}/actions/runs/${runId}/artifacts`]));await save(root+'/middle-artifacts.json',listing);
const [artifact]=listing.artifacts;assert.equal(listing.artifacts.length,1);assert.equal(artifact.name,'compiled-edge-layout-inspection');assert(!artifact.expired&&artifact.size_in_bytes<4*1024*1024);
const disk=statfsSync(root);assert(disk.bavail*disk.bsize>=128*1024*1024);assert(!existsSync(root+'/middle'));
await gh(['run','download',runId,'-R',repo,'--name',artifact.name,'--dir',root+'/middle']);
await save(root+'/original-middle-capture.json',{run,artifact,rawPreserved:true,looseIdentityUnqualified:true,noPerformanceOrAbiClaim:true});
console.log('Preserved original middle capture and full job log without redispatch or reinterpretation.');
