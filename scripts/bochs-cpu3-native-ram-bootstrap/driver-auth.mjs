/** Separate driver source inventory and actual first-build artifact authority. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {regularBytes,sha} from '../bochs-cpu3-native-cold-bios/driver-auth.mjs';
export {regularBytes,sha};
export const compiledRevision='81694d0d19a86ded0449ab56b3554020ffc344ca';
export const addonSha256='9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873';
export const buildRun=37136096190;
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const git=(cwd,args)=>execFileSync('git',args,{cwd,timeout:10000,maxBuffer:32<<20});
export function driverSourceIdentity(){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean frozen driver');const revision=git(root,['rev-parse','HEAD']).toString().trim(),hashes={};
 function visit(p){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const b=regularBytes(resolve(root,p));hashes[p]=sha(b);assert.equal(hashes[p],sha(git(root,['show',revision+':'+p])),'current/Git '+p);
  if(/\.(mjs|js)$/.test(p))for(const m of b.toString().matchAll(/^\s*(?:import|export)\s+[^;\n]+?\s*from\s*['"](\.[^'"]+)['"]/gm))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));
 }
 for(const p of ['scripts/bochs-cpu3-native-ram-bootstrap/runner.mjs','scripts/bochs-cpu3-native-ram-bootstrap/DRIVER-SOURCE.md','scripts/bochs-cpu3-native-cold-bios/board-provider.mjs','test/i80386-ram-bootstrap-driver-source.test.mjs','package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export function authenticateRamCompiled(root,m){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean compiled source');assert.equal(git(root,['rev-parse','HEAD']).toString().trim(),compiledRevision);assert.equal(m.boardRevision,compiledRevision);
 assert.equal(Object.keys(m.sourceHashes).length,138,'actual first-build inventory');
 for(const [p,h]of Object.entries(m.sourceHashes)){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(sha(regularBytes(resolve(root,p))),h,'compiled current '+p);assert.equal(sha(git(root,['show',compiledRevision+':'+p])),h,'compiled Git '+p);}
 return {revision:compiledRevision,hashes:m.sourceHashes};
}
