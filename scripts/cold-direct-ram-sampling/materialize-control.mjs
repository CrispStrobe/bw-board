import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {materialize} from './materialize.mjs';

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
 console.log('authenticated two-root inspector derivative controls PASS');
}finally{rmSync(temp,{recursive:true,force:true});}
