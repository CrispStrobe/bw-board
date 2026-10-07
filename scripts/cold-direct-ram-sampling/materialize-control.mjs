import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {materialize,profilePrelude} from './materialize.mjs';
import {writeAuthenticatedProvider,profileProviderPath} from './file-provider.mjs';

assert.equal(process.argv.length,3);
const original=resolve(process.argv[2]);
const temp=mkdtempSync(join(tmpdir(),'cold-sampling-materialize-control-'));
try{
 const roots=[join(temp,'a'),join(temp,'b')],reports=[];
 for(const root of roots){
  const paired=join(root,'scripts/cold-direct-ram-paired');mkdirSync(paired,{recursive:true});
  const adapter=join(root,'scripts/cold-direct-ram-sampling');mkdirSync(adapter,{recursive:true});
  writeFileSync(join(adapter,'file-provider.mjs'),readFileSync(join(original,'scripts/cold-direct-ram-sampling/file-provider.mjs')));
  for(const name of ['native.mjs','plain.mjs','plain-child.mjs','direct-provider.mjs'])
   writeFileSync(join(paired,name),readFileSync(join(original,'scripts/cold-direct-ram-paired',name)));
  reports.push(materialize(root,join(root,'derived')));
 }
 assert.deepEqual(reports[0].held,reports[1].held);
 assert.equal(reports[0].adapterSha256,reports[1].adapterSha256);
 assert.deepEqual(reports[0].normalized,reports[1].normalized);
 assert.notEqual(reports[0].loaded['native.mjs'],reports[1].loaded['native.mjs'],
                 'path-specific import URL has a distinct loaded digest');
 assert.equal(reports[0].loaded['plain.mjs'],reports[1].loaded['plain.mjs']);
 const mutated=join(roots[0],'scripts/cold-direct-ram-paired/native.mjs');
 writeFileSync(mutated,readFileSync(mutated,'utf8')+'\n');
 assert.throws(()=>materialize(roots[0],join(temp,'mutated')),/held native.mjs/);
 const receipt=join(temp,'receipt');mkdirSync(receipt);const profile=join(receipt,'profile.cpuprofile');
 const provider=Buffer.from('export const example=1;\n');
 const digest=createHash('sha256').update(provider).digest('hex');
 assert.throws(()=>writeAuthenticatedProvider(profile,provider,'0'.repeat(64)),/provider hash/);
 assert.equal(readFileSync(writeAuthenticatedProvider(profile,provider,digest),'utf8'),provider.toString());
 assert.equal(profileProviderPath(profile),join(receipt,'profiled-direct-provider.mjs'));
 const linked=join(temp,'linked-receipt');symlinkSync(receipt,linked);
 assert.throws(()=>profileProviderPath(join(linked,'profile.cpuprofile')),/ordinary canonical/);
 const hostile=join(temp,'hostile');mkdirSync(hostile);const target=join(temp,'target.mjs');writeFileSync(target,'untouched');
 symlinkSync(target,join(hostile,'profiled-direct-provider.mjs'));
 assert.throws(()=>writeAuthenticatedProvider(join(hostile,'profile.cpuprofile'),provider,digest));
 assert.equal(readFileSync(target,'utf8'),'untouched','symlink target unchanged');
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
