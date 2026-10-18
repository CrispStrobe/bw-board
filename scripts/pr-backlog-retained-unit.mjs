/** Run an obsolete source-bound unit at its original Git source, never HEAD. */
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const repository=fileURLToPath(new URL('../',import.meta.url));
const retained=Object.freeze({
 'paged-irq':Object.freeze({revision:'8f1be780b191176ff1d3789b38e2c73e48041198',file:'test/i80386-paged-irq-source.test.mjs'}),
 'cohort-planner':Object.freeze({revision:'c9a22a1b173aa5f2fc41f8edf4a97a8fbfab5cc2',file:'test/i80386-historical-cohorts-plan.test.mjs'})
});
const env={...process.env,GIT_NO_REPLACE_OBJECTS:'1'};
function git(args){return execFileSync('git',['-c','gc.auto=0','-c','maintenance.auto=false',...args],{cwd:repository,env,encoding:'utf8',timeout:120000,maxBuffer:4<<20});}
export function runRetainedUnit(name){
 assert.ok(Object.hasOwn(retained,name),'closed retained unit roster');
 const {revision,file}=retained[name];
 assert.equal(git(['rev-parse',revision+'^{commit}']).trim(),revision,'exact retained Git source');
 const directory=mkdtempSync(join(realpathSync(tmpdir()),'bw-backlog-held-'));
 const checkout=join(directory,'source');let added=false;
 try{
  git(['worktree','add','--detach',checkout,revision]);added=true;
  assert.equal(git(['-C',checkout,'rev-parse','HEAD']).trim(),revision);
  assert.equal(git(['-C',checkout,'status','--porcelain']).trim(),'','clean retained source');
  const result=spawnSync(process.execPath,['--test','--test-concurrency=1',file],{cwd:checkout,env,encoding:'utf8',timeout:180000,maxBuffer:4<<20});
  if(result.error)throw result.error;
  assert.equal(result.signal,null,'retained unit completed');
  assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
  assert.match(result.stdout,/# fail 0\b/);assert.match(result.stdout,/# skipped 0\b/);
  assert.equal(git(['-C',checkout,'status','--porcelain']).trim(),'','retained unit left source clean');
  return {revision,file,stdout:result.stdout};
 }finally{
  if(added)git(['worktree','remove',checkout]);
  rmSync(directory,{recursive:true,force:true});
 }
}
