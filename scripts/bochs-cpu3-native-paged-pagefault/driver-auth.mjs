/** Closed source identity and fresh static-only PF authority. No addon execution. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {regularBytes,sha} from '../bochs-cpu3-native-paged-int-iret/driver-auth.mjs';
import {nativePageFaultProfile} from './provider-profile.mjs';
export {regularBytes,sha};
// Declaration-only scanner also handles authentic held `}from` formatting and multiline imports.
export function relativeImports(bytes){const paths=[];for(const pattern of [/^\s*(?:import|export)\s+(?:(?:[\w$]+\s*,\s*)?\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?|[\w$]+)\s*from\s*['"](\.[^'"]+)['"]/gm,/^\s*import\s*['"](\.[^'"]+)['"]/gm])for(const m of bytes.toString().matchAll(pattern))paths.push(m[1]);return paths;}
export const compiledRevision="5df525f72790876d35e49d936bac1f1284fa81e7"; // Genuine fresh static PF build; no execution qualification.
export const excludedHistoricalAddons=Object.freeze(['92a5121df194c6675303913ebd527e7d0253e29e686b2cbd8dd91fb579489b6f','f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7','4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439','98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e']);
export const fixedGeneratedRoles=Object.freeze({"bochs/cpu/bw_slice_runtime.inc":"1e632f2d639f47c5f3e4b33d3c945fb142fa3364f6e383b8959d5ab705f96369","bochs/cpu/bw_slice_abi.h":"3cb214dfa1a1cf74c5aea4ef3642d73d8ca1cc9e9c8362d2513dc3483f284990","bochs/bochs-cpu3-native-direct-board/abi.h":"3cb214dfa1a1cf74c5aea4ef3642d73d8ca1cc9e9c8362d2513dc3483f284990","bochs/bochs-cpu3-native-direct-board-adapter/napi.cc":"e4f4e55d139971ba073aa0ff422a6f6f1206587b80fccc88e5f6aba10f8cf1a7","bochs/owned-paged-pagefault-provider.mjs":"55acb3bccfb95c60e9818c7be9a45d78918a7b7cec2d8ec5a4fef7064117e53e","bochs/owned-paged-pagefault-ROM.bin":"50d473eae24ad9b71630731ed5cc02db97055df46f692dce49e7f2de04565172"});
export const fixedStaticAuthority=Object.freeze({"artifactZipSha256":"c74915df6046cb6c6a92b4830dfe9b6cf8b2110f57717d8a9142bee99c6bbac8","artifactZipBytes":8578008,"preparedManifestSha256":"b1268ecffc11ae4704f3df95bb92fa3bbf60a18111e74383f99ff8ce58503d53","buildReceiptSha256":"ab8f0ea6a07ca27508413dd01932b4ae7c88bdca22db17670e2dcc42fd31dd2c","independentAuditSha256":"855dc0b9a95a3f803b798d166705c9894da4a65dcfa40f28bd3612f931ff8ab2","rootAuditSha256":"1edc6c22c9225241be5555c298d8eb5d117251f92a5cb03f52d73d7e1abf1b7e"});
export function validateBuildBinding(b){
 assert.deepEqual(Object.keys(b).sort(),['schema','status','profile','abiVersion','compiledRevision','compiledSourceSha256','compiledFiles','generated','addonSha256','buildRun','artifactId','staticAuthority'].sort());
 assert.equal(b.schema,'bw.paged-pagefault.driver-build-binding.v1');assert.equal(b.profile,nativePageFaultProfile.kind);assert.equal(b.abiVersion,4);
 if(b.status==='PENDING_NATIVE_FAULT_RUNTIME_BUILD_AND_EXECUTION'){
  for(const key of ['compiledRevision','compiledSourceSha256','addonSha256','buildRun','artifactId','staticAuthority'])assert.equal(b[key],null,'pending '+key);assert.deepEqual(b.compiledFiles,{});assert.deepEqual(b.generated,{});return b;
 }
 assert.equal(b.status,'ROOT_REVIEWED_PAGED_PAGEFAULT_NATIVE_BUILD','fresh static authority');assert.equal(b.compiledRevision,compiledRevision);assert.equal(Object.keys(b.compiledFiles).length,243);
 for(const [p,h]of Object.entries(b.compiledFiles)){assert.ok(!isAbsolute(p)&&!p.split('/').includes('..'));assert.match(h,/^[a-f0-9]{64}$/);}
 const canonical=JSON.stringify({hashes:Object.fromEntries(Object.entries(b.compiledFiles).sort(([a],[c])=>a<c?-1:a>c?1:0)),revision:b.compiledRevision});assert.equal(sha(Buffer.from(canonical)),b.compiledSourceSha256);
 assert.equal(b.compiledSourceSha256,"73b16ea6d2f49f55d30c513ba033b272a40a76bfa4f94e34c2ceee3266046993");assert.deepEqual(b.generated,fixedGeneratedRoles);assert.equal(b.addonSha256,"14bc8ef0e06030203ec642537846eb78388f857f8728cb201942f6eb9daf35c0");assert.ok(!excludedHistoricalAddons.includes(b.addonSha256));
 assert.equal(b.buildRun,37262460989);assert.equal(b.artifactId,11324707742);assert.deepEqual(b.staticAuthority,fixedStaticAuthority);return b;
}
export function ownedBuildBinding(){return validateBuildBinding(JSON.parse(regularBytes(fileURLToPath(new URL('./driver-build-binding.json',import.meta.url)),1<<20)));}
export function requireReadyBinding(b){validateBuildBinding(b);assert.equal(b.status,'ROOT_REVIEWED_PAGED_PAGEFAULT_NATIVE_BUILD','native PF build is pending; no provider/oracle factory, addon or CPU admission');return b;}
export function requireReadyBuild(){return requireReadyBinding(ownedBuildBinding());}
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),git=(cwd,args)=>execFileSync('git',args,{cwd,timeout:10000,maxBuffer:32<<20});
export function driverSourceIdentity(){
 assert.equal(git(root,['status','--porcelain']).toString().trim(),'','clean frozen PF driver');const revision=git(root,['rev-parse','HEAD']).toString().trim(),hashes={};
 function visit(p){assert.ok(!isAbsolute(p)&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const b=regularBytes(resolve(root,p));hashes[p]=sha(b);assert.equal(hashes[p],sha(git(root,['show',revision+':'+p])),'current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const path of relativeImports(b))visit(resolve(root,dirname(p),path).slice(root.length+1));}
 for(const p of ['scripts/bochs-cpu3-native-paged-pagefault/runner.mjs','scripts/bochs-cpu3-native-paged-pagefault/NATIVE-DRIVER-SOURCE.md','scripts/bochs-cpu3-native-paged-pagefault/driver-build-binding.json','scripts/bochs-cpu3-native-paged-pagefault/runtime.mjs','scripts/bochs-cpu3-native-paged-pagefault/saved-js-fault-phases.json','scripts/bochs-cpu3-native-paged-pagefault/actual-first-pf-build-prepare.json.gz','scripts/bochs-cpu3-native-paged-pagefault/actual-first-pf-reset-failure.json.gz','test/i80386-paged-pagefault-native-runtime-driver.test.mjs','scripts/bochs-cpu3-native-paged-int-iret/runner.mjs','scripts/bochs-cpu3-native-cold-bios/board-provider.mjs','scripts/bochs-cpu3-native-direct-board/runtime.inc','scripts/bochs-cpu3-native-owned-clock/clock.inc','scripts/bochs-cpu3-native-owned-clock/abi.h','src/experimental/i80386.js','package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export function authenticatePageFaultCompiled(compiledRoot,m){
 const binding=requireReadyBuild();assert.equal(m.schema,'bw.paged-pagefault.prepared.v1');assert.equal(m.boardRevision,binding.compiledRevision);assert.equal(git(compiledRoot,['status','--porcelain']).toString().trim(),'');assert.equal(git(compiledRoot,['rev-parse','HEAD']).toString().trim(),binding.compiledRevision);
 assert.deepEqual(m.sourceHashes,binding.compiledFiles);assert.deepEqual(m.actualPreparedHashes,binding.generated);
 for(const [p,h]of Object.entries(m.sourceHashes)){assert.ok(!isAbsolute(p)&&resolve(compiledRoot,p).startsWith(compiledRoot+'/'));assert.match(h,/^[a-f0-9]{64}$/);assert.equal(sha(regularBytes(resolve(compiledRoot,p))),h);assert.equal(sha(git(compiledRoot,['show',binding.compiledRevision+':'+p])),h);}return {revision:binding.compiledRevision,hashes:m.sourceHashes};
}
