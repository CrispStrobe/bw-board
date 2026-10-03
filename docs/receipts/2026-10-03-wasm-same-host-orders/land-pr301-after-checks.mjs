import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {existsSync,readFileSync} from 'node:fs';
const exec=promisify(execFile),repo='CrispStrobe/bw-board';
const head='b00bff0b266eacb7dc975225cf23120fb931ccac';
const root='/tmp/labwired-same-host-20261003.R0T0cC';
const receipt=root+'/pr301-landing.json';
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
const capture=root+'/same-host-orders-20261003/pipeline.json';
const captureDeadline=Date.now()+6*60*60*1000;
while(!existsSync(capture)&&Date.now()<captureDeadline){
 console.log('PR301 awaiting independently verified hosted capture; no merge write.');
 await new Promise(r=>setTimeout(r,45000));
}
assert(existsSync(capture),'Capture incomplete; do not merge');
const pipeline=JSON.parse(readFileSync(capture));
assert(pipeline.completedAt&&pipeline.timingWindows===480&&pipeline.captures.length===8);
assert.equal(pipeline.head,head);
const deadline=Date.now()+6*60*60*1000;
while(Date.now()<deadline){
 const pr=JSON.parse(await read(['pr','view','301','-R',repo,'--json','state,headRefOid,baseRefName,statusCheckRollup,mergeStateStatus,url,mergeCommit']));
 assert.equal(pr.headRefOid,head);assert.equal(pr.baseRefName,'master');
 if(pr.state==='MERGED'){await persist({verifiedAt:new Date().toISOString(),alreadyMerged:true,pr});console.log('PR301 already merged:',pr.mergeCommit);break;}
 assert.equal(pr.state,'OPEN');
 const checks=pr.statusCheckRollup;
 const failed=checks.filter(c=>c.status==='COMPLETED'&&!['SUCCESS','SKIPPED'].includes(c.conclusion));
 assert.equal(failed.length,0,JSON.stringify(failed));
 const ready=checks.length===14&&checks.every(c=>c.status==='COMPLETED')&&checks.filter(c=>c.conclusion==='SUCCESS').length===12
  &&checks.filter(c=>c.conclusion==='SKIPPED').every(c=>c.name==='vectors-full');
 if(ready){
  for(const node of ['20.20.2','22.23.3'])assert.equal(checks.filter(c=>c.name==='Repeated ordinary orders Node '+node&&c.conclusion==='SUCCESS').length,1);
  assert.equal(checks.filter(c=>c.conclusion==='SKIPPED').length,2);
  for(const name of ['test','vectors','corpus','vectors186','qualify'])assert.equal(checks.filter(c=>c.name===name&&c.conclusion==='SUCCESS').length,2,name);
  if(pr.mergeStateStatus==='UNKNOWN'){
   console.log('PR301: all checks passed; GitHub mergeability not yet computed, no merge write.');
   await new Promise(r=>setTimeout(r,45000));continue;
  }
  assert.equal(pr.mergeStateStatus,'CLEAN');
  const result={head,publication:false,engineMerge:false,physicalAcknowledgementChanges:false,mergeAttemptedAt:new Date().toISOString(),pr};
  await persist(result);
  await gh(['pr','merge','301','-R',repo,'--merge','--match-head-commit',head]);
  result.after=JSON.parse(await read(['pr','view','301','-R',repo,'--json','state,mergeCommit,url,headRefOid']));
  assert.equal(result.after.state,'MERGED');assert.equal(result.after.headRefOid,head);
  result.completedAt=new Date().toISOString();await persist(result);
  console.log('Diagnostic tooling PR301 merged after all twelve enabled checks passed:',result.after);break;
 }
 console.log(`PR301: ${checks.filter(c=>c.conclusion==='SUCCESS').length}/12 checks passed; waiting, no merge write.`);
 await new Promise(r=>setTimeout(r,45000));
}
if(!existsSync(receipt))throw Error('Read-only monitoring deadline; inspect current checks before resuming');
