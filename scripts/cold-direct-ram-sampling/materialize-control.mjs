import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {materialize,profilePrelude} from './materialize.mjs';

assert.equal(process.argv.length,3);
const original=resolve(process.argv[2]);
const temp=mkdtempSync(join(tmpdir(),'cold-sampling-materialize-control-'));
try{
 const roots=[join(temp,'a'),join(temp,'b')],reports=[];
 for(const root of roots){
  const paired=join(root,'scripts/cold-direct-ram-paired');mkdirSync(paired,{recursive:true});
  for(const name of ['native.mjs','plain.mjs','plain-child.mjs','direct-provider.mjs'])
   writeFileSync(join(paired,name),readFileSync(join(original,'scripts/cold-direct-ram-paired',name)));
  reports.push(materialize(root,join(root,'derived')));
 }
 assert.deepEqual(reports[0].held,reports[1].held);
 assert.deepEqual(reports[0].normalized,reports[1].normalized);
 assert.notEqual(reports[0].loaded['native.mjs'],reports[1].loaded['native.mjs'],
                 'path-specific import URL has a distinct loaded digest');
 assert.equal(reports[0].loaded['plain.mjs'],reports[1].loaded['plain.mjs']);
 const mutated=join(roots[0],'scripts/cold-direct-ram-paired/native.mjs');
 writeFileSync(mutated,readFileSync(mutated,'utf8')+'\n');
 assert.throws(()=>materialize(roots[0],join(temp,'mutated')),/held native.mjs/);
 const synthetic=join(temp,'synthetic.mjs');
 writeFileSync(synthetic,profilePrelude+String.raw`
const state=await bwStartProfile();
try{let n=0;for(let i=0;i<2000000;i++)n+=Math.sqrt(i);
 if(process.env.BW_SYNTHETIC_THROW==='1')throw Error('synthetic workload failure');
 if(!Number.isFinite(n))throw Error('synthetic arithmetic');
}finally{await bwStopProfile(state);}
`);
 for(const shouldThrow of [false,true]){
  const profile=join(temp,shouldThrow?'failure.cpuprofile':'success.cpuprofile');
  const run=spawnSync(process.execPath,[synthetic],{timeout:15000,
   env:{...process.env,BW_CPU_PROFILE_PATH:profile,BW_SYNTHETIC_THROW:shouldThrow?'1':'0'},
   encoding:'utf8'});
  assert.equal(run.status,shouldThrow?1:0,'synthetic guard result');
  assert.ok(readFileSync(profile).length>0,'profile retained on success or thrown workload');
 }
 console.log('authenticated two-root inspector derivative controls PASS');
}finally{rmSync(temp,{recursive:true,force:true});}
