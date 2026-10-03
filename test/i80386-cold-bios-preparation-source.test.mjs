import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {boundedJson,regularBytes,canonicalConfiguration,authenticateConfiguration,validateBuildMetadata,generatedHashes,requiredFeatures,requiredExports,buildReceiptSchema,validateBuildContext} from '../scripts/bochs-cpu3-native-cold-bios/identity.mjs';
import {finalizePreparation,validatePreparationRequest} from '../scripts/prepare-bochs-cpu3-native-cold-bios.mjs';
import {coldNativeProfile} from '../scripts/bochs-cpu3-native-cold-bios/runtime.mjs';
import {hotNativeProfile} from '../scripts/bochs-cpu3-native-hot-direct/profile.mjs';
import {upstreamHashes} from '../scripts/bochs-cpu3-native-direct-board/patch.mjs';
import {sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';
function fixture(){
 const source={revision:'a'.repeat(40),hashes:{'diagnostic-source':'b'.repeat(64)}};
 const intermediate={boardRevision:source.revision,bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',sourceHashes:{...source.hashes},profile:hotNativeProfile,generatedRuntimeSha256:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',preparedTree:'/diagnostic-prepared',upstreamHashes,patchedHashes:Object.fromEntries(Object.keys(upstreamHashes).map(p=>[p,'c'.repeat(64)]))};
 const manifest=finalizePreparation(intermediate,source),input={preparedManifest:'/diagnostic-manifest.json',preparedManifestSha256:'d'.repeat(64),addon:'/diagnostic-prepared/bochs/bw_direct.node',sha256:'e'.repeat(64)};
 const receipt={schema:buildReceiptSchema,status:'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST',coldProfile:coldNativeProfile,sourceRevision:source.revision,sourceHashes:source.hashes,preparedHashes:generatedHashes(),preparedTree:manifest.preparedTree,preparedManifestPath:input.preparedManifest,preparedManifestSha256:input.preparedManifestSha256,addonPath:input.addon,addonSha256:input.sha256,requiredFeatures,requiredExports};
 return Object.fromEntries(Object.entries({source,intermediate,manifest,input,receipt}).map(([k,v])=>[k,structuredClone(v)]));
}
test('preparation preserves historical H4 object and admits no invented build/reference',()=>{
 const f=fixture();assert.deepEqual(f.manifest.originalH4Provenance,f.intermediate);assert.deepEqual(f.manifest.profile,coldNativeProfile);assert.equal(f.manifest.reference,undefined);assert.equal(f.manifest.buildReceipt,undefined);
 assert.deepEqual(validateBuildMetadata(f.input,f.source,f.manifest,f.receipt),generatedHashes());
 assert.throws(()=>finalizePreparation({...f.intermediate,boardRevision:'f'.repeat(40)},f.source));
 assert.throws(()=>finalizePreparation({...f.intermediate,sourceHashes:{unowned:'a'}},f.source));
});
test('old ABI4 receipts, profile/ROM/hash/source/role omissions deny before addon access',()=>{
 for(const mutate of [f=>f.receipt.schema='bw.owned-clock-build-receipt.v1',f=>f.manifest.coldProfile={...coldNativeProfile,romSha256:'0'.repeat(64)},f=>f.manifest.actualPreparedHashes['bochs/cpu/bw_slice_runtime.inc']='0'.repeat(64),f=>f.manifest.sourceHashes.extra='0'.repeat(64),f=>f.input.addon='/foreign/bw_direct.node',f=>f.receipt.requiredFeatures={...requiredFeatures,BX_CPU_LEVEL:4},f=>delete f.manifest.patchedHashes[Object.keys(upstreamHashes)[0]],f=>f.manifest.originalH4Provenance.profile=coldNativeProfile]){
 const f=structuredClone(fixture());mutate(f);assert.throws(()=>validateBuildMetadata(f.input,f.source,f.manifest,f.receipt));}
});
test('bounded JSON and regular role reject missing symlink wrong digest and oversized files',()=>{
 const d=mkdtempSync(join(tmpdir(),'cold-admission-'));try{const p=join(d,'record.json'),link=join(d,'link');writeFileSync(p,'{"ok":true}');const h=sha256(readFileSync(p));assert.deepEqual(boundedJson(p,h),{ok:true});symlinkSync(p,link);assert.throws(()=>boundedJson(link,h));assert.throws(()=>boundedJson(p,'0'.repeat(64)));assert.throws(()=>regularBytes(join(d,'missing')));assert.throws(()=>regularBytes(p,1));assert.throws(()=>regularBytes('relative'));}finally{rmSync(d,{recursive:true,force:true});}
});
test('fixed configuration permits only log path and authenticates actual BIOS/VGA current Git',()=>{
 const d=mkdtempSync(join(tmpdir(),'cold-config-'));try{const p=join(d,'bochsrc');writeFileSync(p,canonicalConfiguration(join(d,'run.log')));assert.equal(authenticateConfiguration(p).biosSha256,coldNativeProfile.romSha256);
 for(const edit of [s=>s.replace('guest=16','guest=32'),s=>s.replace('ips=10000000','ips=20000000'),s=>s+'cpu: count=2\n',s=>s.replace('BIOS-bochs-legacy','foreign-bios')]){writeFileSync(p,edit(canonicalConfiguration(join(d,'run.log'))));assert.throws(()=>authenticateConfiguration(p));}
 assert.throws(()=>canonicalConfiguration('/tmp/space log'));}finally{rmSync(d,{recursive:true,force:true});}
});
test('preparer rejects executable hooks and existing/symlinked target before any subprocess',()=>{
 const d=mkdtempSync(join(tmpdir(),'cold-prepare-'));try{const env={BOCHS_386_ROOT:d};assert.deepEqual(validatePreparationRequest(['--check'],env),{mode:'--check',target:undefined});
 for(const key of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'])assert.throws(()=>validatePreparationRequest(['--check'],{...env,[key]:'nonempty'}));
 assert.throws(()=>validatePreparationRequest(['--prepare',d],env));assert.throws(()=>validatePreparationRequest(['--check','extra'],env));assert.throws(()=>validatePreparationRequest(['--check',''],env));assert.throws(()=>validatePreparationRequest(['--prepare','relative'],env));const dangling=join(d,'dangling');symlinkSync(join(d,'missing-target'),dangling);assert.throws(()=>validatePreparationRequest(['--prepare',dangling],env));const link=join(d,'link');symlinkSync(d,link);assert.throws(()=>validatePreparationRequest(['--check'],{BOCHS_386_ROOT:link}));}finally{rmSync(d,{recursive:true,force:true});}
});

test('static build context is separately hashed and cannot claim an addon load or foreign source',()=>{
 const f=fixture();f.manifest.configure=['fixed-configure'];f.manifest.build=['fixed-build'];f.receipt.configSha256='f'.repeat(64);
 const c={schema:'bw.native-cold-bios-build-context.v1',sourceRevision:f.receipt.sourceRevision,sourceHashes:f.receipt.sourceHashes,bochsRevision:f.manifest.bochsRevision,preparedManifestSha256:f.receipt.preparedManifestSha256,preparedHashes:f.receipt.preparedHashes,configSha256:f.receipt.configSha256,configure:f.manifest.configure,build:f.manifest.build,nodeVersion:'v22.23.3',compilerVersion:'diagnostic compiler',platform:'diagnostic platform',architecture:'diagnostic architecture',addonLoaded:false};
 validateBuildContext(c,f.receipt,f.manifest);
 for(const change of [{addonLoaded:true},{sourceRevision:'0'.repeat(40)},{nodeVersion:'v20.0.0'},{configSha256:'0'.repeat(64)},{build:['other']},{compilerVersion:''}])assert.throws(()=>validateBuildContext({...c,...change},f.receipt,f.manifest));
});
