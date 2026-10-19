/** Source/build-profile plan only: never creates native files, loads an addon or runs a guest. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sourceIdentity as coldSourceIdentity} from '../bochs-cpu3-native-cold-bios/identity.mjs';
import {deriveColdBiosNapi} from '../bochs-cpu3-native-cold-bios/napi.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveRamBootstrapRuntime} from './runtime.mjs';
import {deriveRamProvider} from './provider-derivation.mjs';
import {fixedRamBootstrapRom,ramBootstrapProfile} from './profile.mjs';
const root=fileURLToPath(new URL('../../',import.meta.url));
export const sourceAssets=Object.freeze(['profile.mjs','runtime.mjs','provider-derivation.mjs','preparation.mjs','README.md'].map(p=>'scripts/bochs-cpu3-native-ram-bootstrap/'+p).concat('test/i80386-ram-bootstrap-source.test.mjs'));
export function ramSourceIdentity(...args){
 assert.equal(args.length,0);const held=coldSourceIdentity(),hashes={...held.hashes};
 for(const p of sourceAssets){const bytes=readFileSync(new URL('../../'+p,import.meta.url));const git=execFileSync('git',['show',held.revision+':'+p],{cwd:root,timeout:10000,maxBuffer:1<<20});assert.equal(sha256(bytes),sha256(git),'current/Git '+p);hashes[p]=sha256(bytes);}
 return {revision:held.revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export function generatedRamArtifacts(){
 const runtime=deriveRamBootstrapRuntime(),provider=deriveRamProvider(),napi=deriveColdBiosNapi(),rom=fixedRamBootstrapRom();
 return {runtime,provider,napi,rom,hashes:{'bochs/cpu/bw_slice_runtime.inc':sha256(runtime.bytes),'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc':sha256(napi.bytes),'owned-ram-provider.mjs':sha256(provider.bytes),'owned-ram-ROM.bin':sha256(rom)}};
}
export function ramBuildProfilePlan(...args){
 assert.equal(args.length,0);const source=ramSourceIdentity(),a=generatedRamArtifacts();assert.equal(a.hashes['owned-ram-ROM.bin'],ramBootstrapProfile.romSha256);
 return {schema:'bw.ram-bootstrap.build-profile-plan.v1',status:'SOURCE_ONLY_REQUIRES_SEPARATE_BUILD_AND_ADMISSION',source,profile:ramBootstrapProfile,generatedHashes:a.hashes,originalCompiledRevision:'7632e6a0995ceaab88bc8cede91506a5330d2e1c',originalAddonNotAdmitted:'40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0',runtimeInverseBaseSha256:a.runtime.baseSha256,providerInverseBaseSha256:a.provider.baseSha256,abiVersion:4,remaining:'Reviewed preparation materializer/config/build receipt admission, fresh hosted build, dynamic Bochs-reset JS oracle and native correctness driver. No built/executed success is represented.'};
}
