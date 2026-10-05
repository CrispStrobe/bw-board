/** Closed source identity and deliberately unbuilt PF authority. No addon execution. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {regularBytes,sha} from '../bochs-cpu3-native-paged-int-iret/driver-auth.mjs';
import {nativePageFaultProfile} from './provider-profile.mjs';
export {regularBytes,sha};
// Declaration-only scanner also handles authentic held `}from` formatting and multiline imports.
export function relativeImports(bytes){const paths=[];for(const pattern of [/^\s*(?:import|export)\s+(?:(?:[\w$]+\s*,\s*)?\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s*from\s*['"](\.[^'"]+)['"]/gm,/^\s*import\s*['"](\.[^'"]+)['"]/gm])for(const m of bytes.toString().matchAll(pattern))paths.push(m[1]);return paths;}
export const compiledRevision=null; // No fresh PF build has been authenticated.
export const excludedHistoricalAddons=Object.freeze(['92a5121df194c6675303913ebd527e7d0253e29e686b2cbd8dd91fb579489b6f','f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7','4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439','98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e']);
export function validateBuildBinding(b){
 assert.deepEqual(Object.keys(b).sort(),['schema','status','profile','abiVersion','compiledRevision','compiledSourceSha256','compiledFiles','generated','addonSha256','buildRun','artifactId','staticAuthority'].sort());
 assert.equal(b.schema,'bw.paged-pagefault.driver-build-binding.v1');assert.equal(b.profile,nativePageFaultProfile.kind);assert.equal(b.abiVersion,4);assert.equal(b.status,'PENDING_NATIVE_FAULT_RUNTIME_BUILD_AND_EXECUTION','this source slice has no statically audited PF build');
 for(const key of ['compiledRevision','compiledSourceSha256','addonSha256','buildRun','artifactId','staticAuthority'])assert.equal(b[key],null,'pending '+key);assert.deepEqual(b.compiledFiles,{});assert.deepEqual(b.generated,{});return b;
}
export function ownedBuildBinding(){return validateBuildBinding(JSON.parse(regularBytes(fileURLToPath(new URL('./driver-build-binding.json',import.meta.url)),16384)));}
export function requireReadyBuild(){const b=ownedBuildBinding();assert.fail('native PF build is pending; no provider/oracle factory, addon or CPU admission');return b;}
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),git=(cwd,args)=>execFileSync('git',args,{cwd,timeout:10000,maxBuffer:32<<20});
export function driverSourceIdentity(){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean frozen PF driver');const revision=git(root,['rev-parse','HEAD']).toString().trim(),hashes={};
 function visit(p){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const b=regularBytes(resolve(root,p));hashes[p]=sha(b);assert.equal(hashes[p],sha(git(root,['show',revision+':'+p])),'current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const path of relativeImports(b))visit(resolve(root,dirname(p),path).slice(root.length+1));}
 for(const p of ['scripts/bochs-cpu3-native-paged-pagefault/runner.mjs','scripts/bochs-cpu3-native-paged-pagefault/NATIVE-DRIVER-SOURCE.md','scripts/bochs-cpu3-native-paged-pagefault/driver-build-binding.json','scripts/bochs-cpu3-native-paged-pagefault/runtime.mjs','scripts/bochs-cpu3-native-paged-pagefault/saved-js-fault-phases.json','test/i80386-paged-pagefault-native-runtime-driver.test.mjs','scripts/bochs-cpu3-native-paged-int-iret/runner.mjs','scripts/bochs-cpu3-native-cold-bios/board-provider.mjs','scripts/bochs-cpu3-native-direct-board/runtime.inc','scripts/bochs-cpu3-native-owned-clock/clock.inc','scripts/bochs-cpu3-native-owned-clock/abi.h','src/experimental/i80386.js','package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export function authenticatePageFaultCompiled(compiledRoot,m){
 const binding=requireReadyBuild();assert.equal(m.schema,'bw.paged-pagefault.prepared.v1');assert.equal(m.boardRevision,binding.compiledRevision);assert.equal(git(compiledRoot,['status','--porcelain']).toString().trim(),'');assert.equal(git(compiledRoot,['rev-parse','HEAD']).toString().trim(),binding.compiledRevision);
 assert.deepEqual(m.sourceHashes,binding.compiledFiles);assert.deepEqual(m.actualPreparedHashes,binding.generated);
 for(const [p,h]of Object.entries(m.sourceHashes)){assert.ok(!isAbsolute(p)&&resolve(compiledRoot,p).startsWith(compiledRoot+'/'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(sha(regularBytes(resolve(compiledRoot,p))),h);assert.equal(sha(git(compiledRoot,['show',binding.compiledRevision+':'+p])),h);}return {revision:binding.compiledRevision,hashes:m.sourceHashes};
}
