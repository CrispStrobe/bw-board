/** Exact old admission derivative; FS/hash/Git only, never requires an addon. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {generatedRamArtifacts,sourceAssets} from './preparation.mjs';
import {ramBootstrapProfile} from './profile.mjs';
import {coldNativeProfile as originalColdProfile} from '../bochs-cpu3-native-cold-bios/runtime.mjs';
import {generatedHashes as originalGeneratedHashes} from '../bochs-cpu3-native-cold-bios/identity.mjs';
export const admissionParentSha256='1978141aec85057a17bde07ea62b4c2b54743d86eed4143f3fe4c56d22356c75';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const buildAssets=Object.freeze(['build-identity.mjs','build-controls.mjs','BUILD-SOURCE.md'].map(p=>'scripts/bochs-cpu3-native-ram-bootstrap/'+p).concat('scripts/prepare-bochs-cpu3-native-ram-bootstrap.mjs','scripts/ci-build-i80386-native-ram-bootstrap.py','.github/workflows/i80386-native-ram-bootstrap-build.yml','test/i80386-ram-bootstrap-build-source.test.mjs'));
export function deriveAdmissionSource(bytes){
 let s=authenticated(bytes,admissionParentSha256,'held cold build admission');const edits=[];
 function once(old,next,label){s=replacement(s,old,next,label);edits.push({old,next,label});}
 function many(old,next,count,label){assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});}
 once("import {deriveColdBiosRuntime,coldNativeProfile} from './runtime.mjs';",`import {deriveRamBootstrapRuntime as deriveColdBiosRuntime} from '${new URL('./runtime.mjs',import.meta.url).href}';\nimport {ramBootstrapProfile as coldNativeProfile} from '${new URL('./profile.mjs',import.meta.url).href}';`,'new RAM runtime/profile');
 once("const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));",'const root='+JSON.stringify(root)+';','owned root, not data URL');
 const assetEnd="'roms/free-at-bios/vgabios-lgpl.bin']));";
 once(assetEnd,"'roms/free-at-bios/vgabios-lgpl.bin'],"+JSON.stringify([...sourceAssets,...buildAssets])+'));','complete new build source seeds');
 const importScan=String.raw`if(/\.(mjs|js)$/.test(p))for(const m of b.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))`;
 once(importScan,String.raw`if(/\.(mjs|js)$/.test(p))for(const m of b.toString().matchAll(p.startsWith('scripts/bochs-cpu3-native-ram-bootstrap/')?/^\s*import\s+[^;\n]+?\s*from\s*['"](\.[^'"]+)['"]/gm:/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))`,'actual owned import declarations, not quoted transform needles');
 const oldGenerated="'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc':sha256(napi.bytes)};";
 once(oldGenerated,"'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc':sha256(napi.bytes),'bochs/owned-ram-provider.mjs':"+JSON.stringify(sha256(generatedRamArtifacts().provider.bytes))+",'bochs/owned-ram-ROM.bin':"+JSON.stringify(ramBootstrapProfile.romSha256)+"};",'generated provider/ROM roles');
 many('bw.native-cold-bios-build-','bw.native-ram-bootstrap-build-',2,'distinct receipt/context schemas');
 many('coldProfile','ramProfile',2,'distinct manifest/receipt profile fields');
 const tail=s.slice(s.indexOf('export function canonicalConfiguration('));assert.ok(tail.startsWith('export function canonicalConfiguration(')&&tail.includes('export function authenticateConfiguration(path)'));
 once(tail,'/* Generated-ROM configuration is verified by the owning wrapper. */\n','configuration has separate generated-ROM role proof');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 assert.equal(sha256(inverse),admissionParentSha256);return {bytes:Buffer.from(s),edits};
}
const original=new URL('../bochs-cpu3-native-cold-bios/identity.mjs',import.meta.url);
const source=deriveAdmissionSource(readFileSync(original)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,original).href}${q}`);
const admission=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {ownedAssets,sourceIdentity,regularBytes,boundedJson,authenticateEnvironment,generatedHashes,validateBuildContext,requiredFeatures,requiredExports,buildReceiptSchema}=admission;
export function validateBuildMetadata(input,source,manifest,receipt){validateRamManifest(manifest);return admission.validateBuildMetadata(input,source,manifest,receipt);}
export function authenticateBuild(input,source){validateRamManifest(boundedJson(input.preparedManifest,input.preparedManifestSha256));return admission.authenticateBuild(input,source);}
export function validateRamManifest(m){
 assert.deepEqual(m.ramProfile,ramBootstrapProfile);assert.deepEqual(m.profile,ramBootstrapProfile);
 assert.ok(m.originalColdProvenance&&m.originalColdProvenance.coldProfile,'genuine cold provenance required');assert.equal(m.originalColdProvenance.boardRevision,m.boardRevision);assert.equal(m.originalColdProvenance.bochsRevision,m.bochsRevision);assert.equal(m.originalColdProvenance.preparedTree,m.preparedTree);assert.deepEqual(m.originalColdProvenance.originalH4Provenance,m.originalH4Provenance);assert.equal(m.originalColdProvenance.ownedClock.abiVersion,4);
 assert.deepEqual(m.originalColdProvenance.profile,originalColdProfile);assert.deepEqual(m.originalColdProvenance.coldProfile,originalColdProfile);assert.deepEqual(m.originalColdProvenance.actualPreparedHashes,originalGeneratedHashes());
 assert.equal(m.originalColdProvenance.generatedRuntimeSha256,'6fdf5fccf797777acce655be2609cf58fb498d18ad6d0dd78fdef8e38a505643');
 assert.deepEqual(m.actualPreparedHashes,generatedHashes());
 assert.equal(m.actualPreparedHashes['bochs/owned-ram-ROM.bin'],ramBootstrapProfile.romSha256);
 assert.equal(typeof m.preparedTree,'string');assert.ok(isAbsolute(m.preparedTree)&&resolve(m.preparedTree)===m.preparedTree);
 for(const [p,h]of Object.entries(m.originalColdProvenance.sourceHashes))assert.equal(m.sourceHashes[p],h,'original source provenance '+p);
 return m;
}
export function canonicalConfiguration(manifest,logPath='/tmp/ram-bootstrap-bochs.log'){
 validateRamManifest(manifest);assert.ok(typeof logPath==='string'&&isAbsolute(logPath)&&resolve(logPath)===logPath&&logPath.length<=4096&&!/[\s,\0]/.test(logPath));
 const rom=resolve(manifest.preparedTree,'bochs/owned-ram-ROM.bin');assert.ok(!/[\s,\0]/.test(rom));
 return ['display_library: nogui','memory: guest=16, host=16',`romimage: file=${rom}`,`vgaromimage: file=${resolve(root,'roms/free-at-bios/vgabios-lgpl.bin')}`,'cpu: count=1, ips=10000000','clock: sync=none, time0=946684800','boot: disk','port_e9_hack: enabled=1',`log: ${logPath}`,'panic: action=fatal','error: action=report','info: action=report','debug: action=ignore','mouse: enabled=0',''].join('\n');
}
export function authenticateConfiguration(path,manifest){
 authenticateEnvironment();validateRamManifest(manifest);const b=regularBytes(path,16384),text=b.toString(),logs=[...text.matchAll(/^log: (.+)$/gm)];assert.equal(logs.length,1);assert.equal(text,canonicalConfiguration(manifest,logs[0][1]));
 const rom=regularBytes(resolve(manifest.preparedTree,'bochs/owned-ram-ROM.bin'),65536);assert.equal(rom.length,65536);assert.equal(sha256(rom),ramBootstrapProfile.romSha256);
 const vga='roms/free-at-bios/vgabios-lgpl.bin',source=sourceIdentity();assert.equal(sha256(regularBytes(resolve(root,vga))),source.hashes[vga]);assert.equal(source.hashes[vga],'76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1');
 return {text,sha256:sha256(b),romSha256:sha256(rom),vgaSha256:source.hashes[vga]};
}
