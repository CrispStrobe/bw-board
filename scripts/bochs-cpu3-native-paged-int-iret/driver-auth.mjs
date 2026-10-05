/** Separate driver source inventory and source-owned pending build authority. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {regularBytes,sha} from '../bochs-cpu3-native-cold-bios/driver-auth.mjs';
export {regularBytes,sha};
export const compiledRevision='4a4ec3c92a67c4db6d3bd361f9456d2be144a13c';
export const excludedHistoricalAddons=Object.freeze(['f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7','4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439','98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e','9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873','40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0']);
export const fixedGeneratedRoles=Object.freeze({"bochs/cpu/bw_slice_runtime.inc":"44d6166807419eebc02f6e69f767e22fed21ead738b2a10e71d87791c364b796","bochs/cpu/bw_slice_abi.h":"3cb214dfa1a1cf74c5aea4ef3642d73d8ca1cc9e9c8362d2513dc3483f284990","bochs/bochs-cpu3-native-direct-board/abi.h":"3cb214dfa1a1cf74c5aea4ef3642d73d8ca1cc9e9c8362d2513dc3483f284990","bochs/bochs-cpu3-native-direct-board-adapter/napi.cc":"e4f4e55d139971ba073aa0ff422a6f6f1206587b80fccc88e5f6aba10f8cf1a7","bochs/owned-paged-int-iret-provider.mjs":"afc02de595449021f64cfa74cb0004ae71028e57596195769563439b5d0f005f","bochs/owned-paged-int-iret-ROM.bin":"b8b3525d4299ba14dc467144fc743a39f1c04d1a7d92ea3b34da6f4ee601cd30"});
export function validateBuildBinding(b){
 assert.deepEqual(Object.keys(b).sort(),['schema','status','compiledRevision','compiledSourceSha256','compiledFiles','generated','addonSha256','buildRun','artifactId','staticAuthority'].sort());assert.equal(b.schema,'bw.paged-int-iret.driver-build-binding.v1');assert.equal(b.compiledRevision,compiledRevision);assert.match(b.compiledSourceSha256,/^[a-f0-9]{64}$/);assert.equal(Object.keys(b.compiledFiles).length,208);
 for(const [p,h]of Object.entries(b.compiledFiles)){assert.ok(!isAbsolute(p)&&!p.split('/').includes('..'));assert.match(h,/^[a-f0-9]{64}$/);}
 const canonical=JSON.stringify({hashes:Object.fromEntries(Object.entries(b.compiledFiles).sort(([a],[c])=>a<c?-1:a>c?1:0)),revision:b.compiledRevision});assert.equal(sha(Buffer.from(canonical)),b.compiledSourceSha256);
 assert.ok(['PENDING_PAGED_INT_IRET_NATIVE_BUILD','ROOT_REVIEWED_PAGED_INT_IRET_NATIVE_BUILD'].includes(b.status));
 if(b.status==='PENDING_PAGED_INT_IRET_NATIVE_BUILD'){assert.equal(b.addonSha256,null);assert.equal(b.buildRun,null);assert.equal(b.artifactId,null);assert.equal(b.staticAuthority,null);}else{assert.match(b.addonSha256,/^[a-f0-9]{64}$/);assert.ok(!excludedHistoricalAddons.includes(b.addonSha256),'old DSO is not a paging build');for(const k of ['buildRun','artifactId'])assert.ok(Number.isSafeInteger(b[k])&&b[k]>0);assert.deepEqual(Object.keys(b.staticAuthority).sort(),['artifactZipSha256','artifactZipBytes','independentAuditSha256','preparedManifestSha256','buildReceiptSha256'].sort());for(const [k,v]of Object.entries(b.staticAuthority))if(k==='artifactZipBytes')assert.ok(Number.isSafeInteger(v)&&v>0&&v<=(16<<20));else assert.match(v,/^[a-f0-9]{64}$/);}
 assert.deepEqual(b.generated,fixedGeneratedRoles,'exact distinct paging generated roles');
 return b;
}
export function ownedBuildBinding(){return validateBuildBinding(JSON.parse(regularBytes(fileURLToPath(new URL('./driver-build-binding.json',import.meta.url)),1<<20)));}
export function requireReadyBinding(b){validateBuildBinding(b);assert.equal(b.status,'ROOT_REVIEWED_PAGED_INT_IRET_NATIVE_BUILD','paged INT/IRET native build is pending; no addon or CPU admission');return b;}
export function requireReadyBuild(){return requireReadyBinding(ownedBuildBinding());}

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
 for(const p of ['scripts/bochs-cpu3-native-paged-int-iret/runner.mjs','scripts/bochs-cpu3-native-paged-int-iret/DRIVER-SOURCE.md','scripts/bochs-cpu3-native-cold-bios/board-provider.mjs','test/i80386-paged-int-iret-driver-source.test.mjs','scripts/bochs-cpu3-native-paged-int-iret/driver-build-binding.json','scripts/bochs-cpu3-native-nonidentity-paging/runner.mjs','src/experimental/i80386.js','scripts/bochs-cpu3-native-paged-int-iret/actual-first-build-prepare.json.gz','package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export function authenticateIntIretCompiled(root,m){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean compiled source');assert.equal(git(root,['rev-parse','HEAD']).toString().trim(),compiledRevision);assert.equal(m.boardRevision,compiledRevision);
 const binding=requireReadyBuild();assert.deepEqual(m.sourceHashes,binding.compiledFiles,'exact frozen paging build source map');assert.deepEqual(m.actualPreparedHashes,binding.generated,'exact generated paging roles');
 for(const [p,h]of Object.entries(m.sourceHashes)){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(sha(regularBytes(resolve(root,p))),h,'compiled current '+p);assert.equal(sha(git(root,['show',compiledRevision+':'+p])),h,'compiled Git '+p);}
 return {revision:compiledRevision,hashes:m.sourceHashes};
}
