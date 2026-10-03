/** Separate driver source inventory and source-owned pending build authority. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {regularBytes,sha} from '../bochs-cpu3-native-cold-bios/driver-auth.mjs';
export {regularBytes,sha};
export const compiledRevision='be1b40aa0d9e1c3f29cf450db7a023e987b2d1c7';
export const excludedHistoricalAddons=Object.freeze(['9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873','40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0']);
export function validateBuildBinding(b){
 assert.deepEqual(Object.keys(b).sort(),['schema','status','compiledRevision','compiledSourceSha256','compiledFiles','generated','addonSha256','buildRun','artifactId'].sort());assert.equal(b.schema,'bw.protected-ram.driver-build-binding.v1');assert.equal(b.compiledRevision,compiledRevision);assert.match(b.compiledSourceSha256,/^[a-f0-9]{64}$/);assert.equal(Object.keys(b.compiledFiles).length,158);
 for(const [p,h]of Object.entries(b.compiledFiles)){assert.ok(!isAbsolute(p)&&!p.split('/').includes('..'));assert.match(h,/^[a-f0-9]{64}$/);}
 const canonical=JSON.stringify({hashes:Object.fromEntries(Object.entries(b.compiledFiles).sort(([a],[c])=>a<c?-1:a>c?1:0)),revision:b.compiledRevision});assert.equal(sha(Buffer.from(canonical)),b.compiledSourceSha256);
 assert.ok(['PENDING_PROTECTED_NATIVE_BUILD','ROOT_REVIEWED_PROTECTED_NATIVE_BUILD'].includes(b.status));
 if(b.status==='PENDING_PROTECTED_NATIVE_BUILD'){assert.equal(b.addonSha256,null);assert.equal(b.buildRun,null);assert.equal(b.artifactId,null);}else{assert.match(b.addonSha256,/^[a-f0-9]{64}$/);assert.ok(!excludedHistoricalAddons.includes(b.addonSha256),'old DSO is not a protected build');for(const k of ['buildRun','artifactId'])assert.ok(Number.isSafeInteger(b[k])&&b[k]>0);}
 return b;
}
export function ownedBuildBinding(){return validateBuildBinding(JSON.parse(regularBytes(fileURLToPath(new URL('./driver-build-binding.json',import.meta.url)),1<<20)));}
export function requireReadyBuild(){const b=ownedBuildBinding();assert.equal(b.status,'ROOT_REVIEWED_PROTECTED_NATIVE_BUILD','protected native build is pending; no addon or CPU admission');return b;}

const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
const git=(cwd,args)=>execFileSync('git',args,{cwd,timeout:10000,maxBuffer:32<<20});
export function relativeImports(bytes){
 const paths=[];for(const pattern of [/^\s*(?:import|export)\s+(?:(?:[\w$]+\s*,\s*)?\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s+from\s*['"](\.[^'"]+)['"]/gm,/^\s*import\s*['"](\.[^'"]+)['"]/gm])for(const m of bytes.toString().matchAll(pattern))paths.push(m[1]);return paths;
}
export function driverSourceIdentity(){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean frozen driver');const revision=git(root,['rev-parse','HEAD']).toString().trim(),hashes={};
 function visit(p){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const b=regularBytes(resolve(root,p));hashes[p]=sha(b);assert.equal(hashes[p],sha(git(root,['show',revision+':'+p])),'current/Git '+p);
  if(/\.(mjs|js)$/.test(p))for(const path of relativeImports(b))visit(resolve(root,dirname(p),path).slice(root.length+1));
 }
 for(const p of ['scripts/bochs-cpu3-native-protected-ram/runner.mjs','scripts/bochs-cpu3-native-protected-ram/DRIVER-SOURCE.md','scripts/bochs-cpu3-native-cold-bios/board-provider.mjs','test/i80386-protected-ram-driver-source.test.mjs','scripts/bochs-cpu3-native-protected-ram/driver-build-binding.json','package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export function authenticateProtectedCompiled(root,m){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean compiled source');assert.equal(git(root,['rev-parse','HEAD']).toString().trim(),compiledRevision);assert.equal(m.boardRevision,compiledRevision);
 const binding=requireReadyBuild();assert.deepEqual(m.sourceHashes,binding.compiledFiles,'exact frozen protected build source map');assert.deepEqual(m.actualPreparedHashes,binding.generated,'exact generated protected roles');
 for(const [p,h]of Object.entries(m.sourceHashes)){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(sha(regularBytes(resolve(root,p))),h,'compiled current '+p);assert.equal(sha(git(root,['show',compiledRevision+':'+p])),h,'compiled Git '+p);}
 return {revision:compiledRevision,hashes:m.sourceHashes};
}
