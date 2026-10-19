import assert from 'node:assert/strict';
import {readyVisibleChecks} from './pr303-visible-check-gate.mjs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync} from 'node:fs';
const exec=promisify(execFile),repo='CrispStrobe/bw-board';
const head='457980b9c84a7e7da95be165160b3e5e8f3198cc';
const root='/tmp/labwired-same-host-20261003.R0T0cC';
const receipt=root+'/pr303-landing.json';
assert(!existsSync(receipt),'Existing landing receipt; inspect instead of duplicating writes');
const gh=async args=>(await exec('gh',args,{encoding:'utf8',timeout:30000,maxBuffer:2*1024*1024})).stdout;
const read=async args=>{for(let i=0;;i++){try{return await gh(args);}catch(e){if(i===2)throw e;await new Promise(r=>setTimeout(r,2000));}}};
async function persist(value){
 const text=JSON.stringify(value,null,2)+'\n';
 let patch;
 if(existsSync(receipt)){
  const old=readFileSync(receipt,'utf8');
  patch=`*** Begin Patch\n*** Update File: ${receipt}\n@@\n${old.slice(0,-1).split('\n').map(l=>'-'+l).join('\n')}\n${text.slice(0,-1).split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`;
 }else patch=`*** Begin Patch\n*** Add File: ${receipt}\n${text.slice(0,-1).split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`;
 const child=exec('apply_patch',[],{encoding:'utf8',timeout:30000});
 child.child.stdin.end(patch);await child;
}
const capture=root+'/edge-layout-r2-20261003/pipeline.json';
const captureDeadline=Date.now()+6*60*60*1000;
let pipeline;
while(Date.now()<captureDeadline){
 if(existsSync(capture)){try{pipeline=JSON.parse(readFileSync(capture));}catch(e){if(!(e instanceof SyntaxError))throw e;}}
 assert(!pipeline?.error,'Compiled inspection failed; no merge');
 if(pipeline?.completedAt)break;
 console.log('PR303 waiting for all three verified actual compiled captures; no merge write.');
 await new Promise(r=>setTimeout(r,45000));
}
assert(pipeline?.completedAt);
assert.equal(pipeline.toolHead,head);assert.equal(pipeline.targets.length,3);
assert.deepEqual(pipeline.targets.map(t=>t.label),['baseline','middle','tail']);
assert(pipeline.targets.every(t=>t.completedAt&&t.buttons.length));
assert.equal(pipeline.enginePromotion,false);assert.equal(pipeline.engineExecution,false);
const deadline=Date.now()+6*60*60*1000;
while(Date.now()<deadline){
 const pr=JSON.parse(await read(['pr','view','303','-R',repo,'--json','state,headRefOid,baseRefName,statusCheckRollup,mergeStateStatus,url,mergeCommit']));
 assert.equal(pr.headRefOid,head);assert.equal(pr.baseRefName,'master');
 if(pr.state==='MERGED'){await persist({verifiedAt:new Date().toISOString(),alreadyMerged:true,pr});console.log('PR303 already merged:',pr.mergeCommit);break;}
 assert.equal(pr.state,'OPEN');
 const checks=pr.statusCheckRollup;
 const failed=checks.filter(c=>c.status==='COMPLETED'&&!['SUCCESS','SKIPPED'].includes(c.conclusion));
 assert.equal(failed.length,0,JSON.stringify(failed));
 const ready=readyVisibleChecks(checks,pipeline.targets[0].core);
 if(ready){
  assert.equal(checks.filter(c=>c.name==='Inspect edge layout '+pipeline.targets[0].core&&c.conclusion==='SUCCESS').length,1);
  const inspectionRuns=[];
  // PR rollup includes push/PR checks, not these separate manual dispatches.
  // Require every actual exact-head inspection independently before merging.
  for(const t of pipeline.targets){
   const run=JSON.parse(await read(['run','view',String(t.run),'-R',repo,'--json','status,conclusion,headSha,jobs,url']));
   assert.equal(run.headSha,head);assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
   assert.equal(run.jobs.length,1);assert.equal(run.jobs[0].name,'Inspect edge layout '+t.core);assert.equal(run.jobs[0].conclusion,'success');
   inspectionRuns.push(run);
  }
  assert.equal(checks.filter(c=>c.conclusion==='SKIPPED').length,2);
  for(const name of ['test','vectors','corpus','vectors186','qualify'])assert.equal(checks.filter(c=>c.name===name&&c.conclusion==='SUCCESS').length,2,name);
  if(pr.mergeStateStatus==='UNKNOWN'){
   console.log('PR303: all checks passed; GitHub mergeability not yet computed, no merge write.');
   await new Promise(r=>setTimeout(r,45000));continue;
  }
  assert.equal(pr.mergeStateStatus,'CLEAN');
  const result={head,inspectionRuns,rollupScope:'11 enabled push/PR checks plus independent verification of all three exact-head inspection runs',publication:false,engineMerge:false,physicalAcknowledgementChanges:false,mergeAttemptedAt:new Date().toISOString(),pr};
  await persist(result);
  await gh(['pr','merge','303','-R',repo,'--merge','--match-head-commit',head]);
  result.after=JSON.parse(await read(['pr','view','303','-R',repo,'--json','state,mergeCommit,url,headRefOid']));
  assert.equal(result.after.state,'MERGED');assert.equal(result.after.headRefOid,head);
  result.completedAt=new Date().toISOString();await persist(result);
  console.log('Diagnostic tooling PR303 merged after all eleven visible enabled checks and all three actual inspections passed:',result.after);break;
 }
 console.log(`PR303: ${checks.filter(c=>c.conclusion==='SUCCESS').length}/11 visible checks passed; waiting, no merge write.`);
 await new Promise(r=>setTimeout(r,45000));
}
if(!existsSync(receipt))throw Error('Read-only monitoring deadline; inspect current checks before resuming');
