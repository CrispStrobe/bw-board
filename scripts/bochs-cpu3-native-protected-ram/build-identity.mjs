/** New protected profile build admission. FS/Git/hash only; no native load. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveAdmissionSource as deriveHeldAdmission,validateRamManifest,generatedHashes as heldGenerated} from '../bochs-cpu3-native-ram-bootstrap/build-identity.mjs';
import {sourceAssets as heldSourceAssets} from '../bochs-cpu3-native-ram-bootstrap/preparation.mjs';
import {buildAssets as heldBuildAssets} from '../bochs-cpu3-native-ram-bootstrap/build-identity.mjs';
import {deriveProtectedRamRuntime} from './runtime.mjs';
import {deriveProtectedRamProvider} from './provider-derivation.mjs';
import {fixedProtectedRamRom,protectedRamProfile} from './profile.mjs';
export const admissionModuleSha256='a1c47c70718ac0dc51c59e8120ff090dfe7e1c2867fc1dc7d48f927c1922fe46';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const sourceAssets=Object.freeze(['profile.mjs','cpu-profile.mjs','reference.mjs','SOURCE.md','runtime.mjs','provider-profile.mjs','provider-derivation.mjs','build-identity.mjs','NATIVE-SOURCE.md'].map(p=>'scripts/bochs-cpu3-native-protected-ram/'+p).concat('test/i80386-protected-ram-source.test.mjs','test/i80386-protected-ram-native-source.test.mjs'));
export const buildAssets=Object.freeze(['BUILD-SOURCE.md','build-controls.mjs'].map(p=>'scripts/bochs-cpu3-native-protected-ram/'+p).concat('scripts/prepare-bochs-cpu3-native-protected-ram.mjs','scripts/ci-build-i80386-native-protected-ram.py','.github/workflows/i80386-native-protected-ram-build.yml','test/i80386-protected-ram-build-source.test.mjs'));
export function generatedProtectedArtifacts(){return {runtime:deriveProtectedRamRuntime(),provider:deriveProtectedRamProvider(),rom:fixedProtectedRamRom()};}
export function deriveProtectedAdmission(bytes){
 authenticated(readFileSync(new URL('../bochs-cpu3-native-ram-bootstrap/build-identity.mjs',import.meta.url)),admissionModuleSha256,'held RAM build admission module');
 const held=deriveHeldAdmission(bytes),baseSha256=sha256(held.bytes);let s=held.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 once(`import {deriveRamBootstrapRuntime as deriveColdBiosRuntime} from '${new URL('../bochs-cpu3-native-ram-bootstrap/runtime.mjs',import.meta.url).href}';`,`import {deriveProtectedRamRuntime as deriveColdBiosRuntime} from '${new URL('./runtime.mjs',import.meta.url).href}';`,'protected native runtime');
 once(`import {ramBootstrapProfile as coldNativeProfile} from '${new URL('../bochs-cpu3-native-ram-bootstrap/profile.mjs',import.meta.url).href}';`,`import {protectedRamProfile as coldNativeProfile} from '${new URL('./profile.mjs',import.meta.url).href}';`,'protected profile');
 once(JSON.stringify([...heldSourceAssets,...heldBuildAssets]),JSON.stringify([...heldSourceAssets,...heldBuildAssets,...sourceAssets,...buildAssets]),'complete inherited and protected source seeds');
 once("p.startsWith('scripts/bochs-cpu3-native-ram-bootstrap/')?","(p.startsWith('scripts/bochs-cpu3-native-ram-bootstrap/')||p.startsWith('scripts/bochs-cpu3-native-protected-ram/')||p==='test/i80386-protected-ram-native-source.test.mjs'||p==='scripts/prepare-bochs-cpu3-native-protected-ram.mjs')?",'quoted-transform needles are not imports');
 many('bw.native-ram-bootstrap-build-','bw.native-protected-ram-build-',2,'distinct build schemas');
 many('ramProfile','protectedProfile',2,'distinct receipt and manifest profile');
 const heldHashes=heldGenerated(),generated=generatedProtectedArtifacts();
 once("'bochs/owned-ram-provider.mjs':"+JSON.stringify(heldHashes['bochs/owned-ram-provider.mjs']),"'bochs/owned-protected-ram-provider.mjs':"+JSON.stringify(sha256(generated.provider.bytes)),'new generated provider role');
 once("'bochs/owned-ram-ROM.bin':"+JSON.stringify(heldHashes['bochs/owned-ram-ROM.bin']),"'bochs/owned-protected-ram-ROM.bin':"+JSON.stringify(protectedRamProfile.romSha256),'new generated ROM role');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'protected admission inverse '+e.label);
 assert.equal(sha256(inverse),baseSha256);return {bytes:Buffer.from(s),baseSha256,edits};
}
const original=new URL('../bochs-cpu3-native-cold-bios/identity.mjs',import.meta.url);
const source=deriveProtectedAdmission(readFileSync(original)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,original).href}${q}`);
const admission=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {ownedAssets,sourceIdentity,regularBytes,boundedJson,authenticateEnvironment,generatedHashes,validateBuildContext,requiredFeatures,requiredExports,buildReceiptSchema}=admission;
export function validateProtectedManifest(m){
 assert.deepEqual(m.profile,protectedRamProfile);assert.deepEqual(m.protectedProfile,protectedRamProfile);assert.equal(m.ramProfile,undefined,'real-mode profile is historical only');
 assert.ok(m.originalRamProvenance,'held RAM derivation provenance');validateRamManifest(m.originalRamProvenance);
 const held=m.originalRamProvenance;assert.equal(held.generatedRuntimeSha256,'56d64c8664b1edaeadd28944484ec53df111357acada96a83fca11245629ca7e','exact held RAM generation');assert.equal(held.ownedClock.runtimeSha256,held.generatedRuntimeSha256);assert.equal(held.boardRevision,m.boardRevision);assert.equal(held.preparedTree,m.preparedTree);assert.equal(held.bochsRevision,m.bochsRevision);assert.deepEqual(held.originalColdProvenance,m.originalColdProvenance);assert.deepEqual(held.originalH4Provenance,m.originalH4Provenance);
 for(const [p,h]of Object.entries(held.sourceHashes))assert.equal(m.sourceHashes[p],h);
 assert.deepEqual(m.actualPreparedHashes,generatedHashes());assert.equal(m.generatedRuntimeSha256,generatedHashes()['bochs/cpu/bw_slice_runtime.inc']);assert.ok(isAbsolute(m.preparedTree)&&resolve(m.preparedTree)===m.preparedTree);return m;
}
export function finalizeProtectedPreparation(held,source){
 validateRamManifest(held);assert.equal(held.boardRevision,source.revision);for(const [p,h]of Object.entries(held.sourceHashes))assert.equal(source.hashes[p],h);
 const m=structuredClone(held),h=generatedHashes();m.originalRamProvenance=structuredClone(held);delete m.ramProfile;m.profile=protectedRamProfile;m.protectedProfile=protectedRamProfile;m.sourceHashes={...source.hashes};m.actualPreparedHashes=h;m.generatedRuntimeSha256=h['bochs/cpu/bw_slice_runtime.inc'];m.ownedClock={...m.ownedClock,runtimeSha256:m.generatedRuntimeSha256,napiSha256:h['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc'],heldRuntimeSha256:held.generatedRuntimeSha256,status:'SOURCE_ONLY_NO_PROTECTED_NATIVE_BUILD_OR_EXECUTION'};return validateProtectedManifest(m);
}
export function validateBuildMetadata(input,source,manifest,receipt){validateProtectedManifest(manifest);return admission.validateBuildMetadata(input,source,manifest,receipt);}
export function authenticateBuild(input,source){validateProtectedManifest(boundedJson(input.preparedManifest,input.preparedManifestSha256));return admission.authenticateBuild(input,source);}
export function canonicalConfiguration(manifest,logPath='/tmp/protected-ram-bochs.log'){
 validateProtectedManifest(manifest);assert.ok(typeof logPath==='string'&&isAbsolute(logPath)&&resolve(logPath)===logPath&&logPath.length<=4096&&!/[\s,\0]/.test(logPath));const rom=resolve(manifest.preparedTree,'bochs/owned-protected-ram-ROM.bin');assert.ok(!/[\s,\0]/.test(rom));
 return ['display_library: nogui','memory: guest=16, host=16',`romimage: file=${rom}`,`vgaromimage: file=${resolve(root,'roms/free-at-bios/vgabios-lgpl.bin')}`,'cpu: count=1, ips=10000000','clock: sync=none, time0=946684800','boot: disk','port_e9_hack: enabled=1',`log: ${logPath}`,'panic: action=fatal','error: action=report','info: action=report','debug: action=ignore','mouse: enabled=0',''].join('\n');
}
export function authenticateConfiguration(path,manifest){
 authenticateEnvironment();const b=regularBytes(path,16384),text=b.toString(),logs=[...text.matchAll(/^log: (.+)$/gm)];assert.equal(logs.length,1);assert.equal(text,canonicalConfiguration(manifest,logs[0][1]));const rom=regularBytes(resolve(manifest.preparedTree,'bochs/owned-protected-ram-ROM.bin'),65536);assert.equal(rom.length,65536);assert.equal(sha256(rom),protectedRamProfile.romSha256);const source=sourceIdentity(),vga='roms/free-at-bios/vgabios-lgpl.bin';assert.equal(sha256(regularBytes(resolve(root,vga))),source.hashes[vga]);assert.equal(source.hashes[vga],'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1');return {text,sha256:sha256(b),romSha256:sha256(rom)};
}
export function protectedBuildPlan(){return {schema:'bw.protected-ram.source-build-plan.v1',status:'SOURCE_ONLY_REQUIRES_NEW_PREPARATION_AND_BUILD',source:sourceIdentity(),profile:protectedRamProfile,generated:generatedHashes(),abiVersion:4,heldRamRuntimeSha256:'56d64c8664b1edaeadd28944484ec53df111357acada96a83fca11245629ca7e',oldAddonsNotAdmitted:['9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873','40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0'],remaining:'Materialization/build workflow source is prepared; actual protected native build and separately reviewed differential driver remain pending. No measured native instruction total or execution success.'};}
