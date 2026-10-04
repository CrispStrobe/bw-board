import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync} from 'node:fs';
const exec=promisify(execFile),repo='CrispStrobe/bw-board';
const head='ad05b8ec01309dba79e7cf9435c6b0b5424d50fc';
const root='/tmp/labwired-same-host-20261003.R0T0cC';
const receipt=root+'/pr320-landing.json';
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
const pipeline=JSON.parse(readFileSync(root+'/cpu-hotpath-inspection-r4-20261003/pipeline.json'));
assert(pipeline.completedAt&&!pipeline.error&&!pipeline.dispatchPending&&pipeline.targets.length===1);
assert.equal(pipeline.toolHead,head);
assert.equal(pipeline.targets[0].run,37142446921);
assert.equal(pipeline.targets[0].core,'43b2d62f5a0fa24ae0b38a645069f5aaa78af685');
for(const key of ['engineExecution','enginePromotion','localEngineDownloads'])assert.equal(pipeline[key],false);
assert(pipeline.targets[0].completedAt);
const inspection=JSON.parse(readFileSync(root+'/cpu-hotpath-inspection-r4-20261003/baseline-run.json'));
assert.equal(inspection.headSha,head);assert.equal(inspection.status,'completed');assert.equal(inspection.conclusion,'success');
const deadline=Date.now()+6*60*60*1000;
while(Date.now()<deadline){
 const pr=JSON.parse(await read(['pr','view','320','-R',repo,'--json','state,headRefOid,baseRefName,statusCheckRollup,mergeStateStatus,url,mergeCommit']));
 assert.equal(pr.headRefOid,head);assert.equal(pr.baseRefName,'master');
 if(pr.state==='MERGED'){await persist({verifiedAt:new Date().toISOString(),alreadyMerged:true,pr});console.log('PR320 already merged:',pr.mergeCommit);break;}
 assert.equal(pr.state,'OPEN');
 const checks=pr.statusCheckRollup;
 const failed=checks.filter(c=>c.status==='COMPLETED'&&!['SUCCESS','SKIPPED'].includes(c.conclusion));
 assert.equal(failed.length,0,JSON.stringify(failed));
 const ready=checks.length===13&&checks.every(c=>c.status==='COMPLETED')&&checks.filter(c=>c.conclusion==='SUCCESS').length===11
  &&checks.filter(c=>c.conclusion==='SKIPPED').every(c=>c.name==='vectors-full');
 if(ready){
  assert.equal(checks.filter(c=>c.conclusion==='SKIPPED').length,2);
  for(const name of ['test','vectors','corpus','vectors186','qualify'])assert.equal(checks.filter(c=>c.name===name&&c.conclusion==='SUCCESS').length,2,name);
  if(pr.mergeStateStatus==='UNKNOWN'){
   console.log('PR320: all checks passed; GitHub mergeability not yet computed, no merge write.');
   await new Promise(r=>setTimeout(r,45000));continue;
  }
  assert.equal(pr.mergeStateStatus,'CLEAN');
  const result={head,publication:false,engineMerge:false,physicalAcknowledgementChanges:false,mergeAttemptedAt:new Date().toISOString(),pr};
  await persist(result);
  await gh(['pr','merge','320','-R',repo,'--merge','--match-head-commit',head]);
  result.after=JSON.parse(await read(['pr','view','320','-R',repo,'--json','state,mergeCommit,url,headRefOid']));
  assert.equal(result.after.state,'MERGED');assert.equal(result.after.headRefOid,head);
  result.completedAt=new Date().toISOString();await persist(result);
  console.log('Static-tool-only PR320 merged after all eleven enabled checks passed:',result.after);break;
 }
 console.log(`PR320: ${checks.filter(c=>c.conclusion==='SUCCESS').length}/11 checks passed; waiting, no merge write.`);
 await new Promise(r=>setTimeout(r,45000));
}
if(!existsSync(receipt))throw Error('Read-only monitoring deadline; inspect current checks before resuming');
