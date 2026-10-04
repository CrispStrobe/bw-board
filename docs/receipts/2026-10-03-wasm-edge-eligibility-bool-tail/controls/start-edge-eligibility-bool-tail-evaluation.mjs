import {readFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
const root='/tmp/labwired-same-host-20261003.R0T0cC/edge-eligibility-bool-tail-20261003';
const source='226fe97835bb5bed06cbb377b3d218c661937a49';
const marker=root+'/evaluation-launch.json';
if(existsSync(marker))throw Error('Evaluation launch already exists; inspect existing pipeline, do not duplicate');
function add(path,data){
 const text=JSON.stringify(data,null,2)+'\n';
 if(existsSync(path)){assert.equal(readFileSync(path,'utf8'),text);return;}
 execFileSync('apply_patch',[],{input:`*** Begin Patch\n*** Add File: ${path}\n${text.trimEnd().split('\n').map(l=>'+'+l).join('\n')}\n*** End Patch\n`});
}
const deadline=Date.now()+6*60*60*1000;
while(Date.now()<deadline){
 const p=root+'/verification.json',v=existsSync(p)?JSON.parse(readFileSync(p)):null;
 if(v){assert.equal(v.source,source);assert.equal(v.nativeRun,37122173204);}
 if(v?.buildRun){
  assert.equal(v.nativeCorrectness.conclusion,'success');
  assert.equal(v.buildRun.headSha,'d1f2c8ebfc5e4e76d5fc81f930588c13de13e974');
  add(root+'/config.json',{nativeRun:v.nativeRun,sources:{
   baseline:{run:36915940413,commit:'43b2d62f5a0fa24ae0b38a645069f5aaa78af685',toolHead:'1cac10ba28ddd5e71c5a7e32437a3b0080d47f14',integrationTests:101},
   candidate:{run:v.buildRun.databaseId,commit:source,toolHead:v.buildRun.headSha,integrationTests:108}
  }});
  execFileSync('node',[root+'/evaluate-hosted.mjs','--self-test'],{stdio:'inherit'});
  add(marker,{source,buildRun:v.buildRun.databaseId,launchAttemptedAt:new Date().toISOString(),hostedOnly:true,automaticMerge:false,publication:false});
  // Each hosted dispatch records intent first; no ambiguous write is retried.
  execFileSync('node',[root+'/evaluate-hosted.mjs'],{stdio:'inherit',timeout:24*60*60*1000});
  process.exit(0);
 }
 const native=JSON.parse(execFileSync('gh',['run','view','37122173204','-R','CrispStrobe/labwired-core','--json','status,conclusion,headSha'],{encoding:'utf8',timeout:30000}));
 assert.equal(native.headSha,source);
 if(native.status==='completed')assert.equal(native.conclusion,'success','Native verification failed; no evaluation');
 await new Promise(resolve=>setTimeout(resolve,45000));
}
throw Error('Verification/build-ID monitor limit reached; inspect existing runs before resuming');
