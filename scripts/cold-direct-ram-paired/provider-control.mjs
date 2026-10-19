/** Same qualified provider derivation under two distinct checkout locations. */
import assert from 'node:assert/strict';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,join} from 'node:path';
import {deriveDirectTimingProvider} from './direct-provider.mjs';

const source=resolve(import.meta.dirname,'../..');
const files=['scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs',
 'scripts/bochs-cpu3-native-cold-bios/board-provider.mjs',
 'scripts/bochs-cpu3-native-cold-bios/board-profile.mjs'];
const base=mkdtempSync(join(tmpdir(),'cold-direct-derivation-'));
try{
 const runs=[];
 for(const name of ['one','two']){
  const root=join(base,name);
  for(const relative of files){const target=join(root,relative);
   mkdirSync(dirname(target),{recursive:true});copyFileSync(join(source,relative),target);}
  runs.push(deriveDirectTimingProvider(root));
 }
 assert.equal(runs[0].qualifiedSha256,runs[1].qualifiedSha256);
 assert.equal(runs[0].derivedSha256,runs[1].derivedSha256);
 assert.notEqual(runs[0].loadedModuleSha256,runs[1].loadedModuleSha256);
 console.log(JSON.stringify({schema:'bw.cold-direct-ram.paired-provider-control.v1',
  status:'PASS',qualifiedSha256:runs[0].qualifiedSha256,
  normalizedDerivedSha256:runs[0].derivedSha256,
  coverage:'Distinct checkout paths alter loaded URL bytes but not authenticated normalized derivation'}));
}finally{rmSync(base,{recursive:true,force:true});}
