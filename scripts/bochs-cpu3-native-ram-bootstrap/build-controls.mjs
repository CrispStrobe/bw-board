import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {deriveAdmissionSource,admissionParentSha256,sourceIdentity,generatedHashes,validateBuildMetadata,validateBuildContext,canonicalConfiguration,authenticateConfiguration,boundedJson,buildReceiptSchema,requiredFeatures,requiredExports} from './build-identity.mjs';
import {finalizeRamPreparation,preparerParentSha256} from '../prepare-bochs-cpu3-native-ram-bootstrap.mjs';
import {finalizePreparation} from '../prepare-bochs-cpu3-native-cold-bios.mjs';
import {ramBootstrapProfile,fixedRamBootstrapRom} from './profile.mjs';
import {hotNativeProfile} from '../bochs-cpu3-native-hot-direct/profile.mjs';
import {upstreamHashes} from '../bochs-cpu3-native-direct-board/patch.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
// Manufactured metadata exercises pure guards; it is never a genuine build receipt.
function fixture(tree='/diagnostic-ram-prepared'){
 const source={revision:'a'.repeat(40),hashes:{'diagnostic-source':'b'.repeat(64)}};
 const h4={boardRevision:source.revision,bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',sourceHashes:{...source.hashes},profile:hotNativeProfile,generatedRuntimeSha256:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',preparedTree:tree,upstreamHashes,patchedHashes:Object.fromEntries(Object.keys(upstreamHashes).map(p=>[p,'c'.repeat(64)]))};
 const cold=finalizePreparation(h4,source),manifest=finalizeRamPreparation(cold,source);
 const input={preparedManifest:'/diagnostic-manifest.json',preparedManifestSha256:'d'.repeat(64),addon:tree+'/bochs/bw_direct.node',sha256:'e'.repeat(64)};
 const receipt={schema:buildReceiptSchema,status:'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST',ramProfile:ramBootstrapProfile,sourceRevision:source.revision,sourceHashes:source.hashes,preparedHashes:generatedHashes(),preparedTree:tree,preparedManifestPath:input.preparedManifest,preparedManifestSha256:input.preparedManifestSha256,addonPath:input.addon,addonSha256:input.sha256,requiredFeatures,requiredExports};
 return structuredClone({source,h4,cold,manifest,input,receipt});
}
test('RAM metadata keeps actual cold/H4 origin separate and requires new artifact identity',()=>{
 const f=fixture();assert.deepEqual(f.manifest.originalColdProvenance,f.cold);assert.deepEqual(f.manifest.originalH4Provenance,f.h4);assert.deepEqual(validateBuildMetadata(f.input,f.source,f.manifest,f.receipt),generatedHashes());assert.equal(f.manifest.reference,undefined);assert.equal(f.manifest.buildReceipt,undefined);assert.equal(f.manifest.coldProfile,undefined);
 for(const mutate of [x=>x.receipt.schema='bw.native-cold-bios-build-receipt.v1',x=>x.manifest.ramProfile={...ramBootstrapProfile,romSha256:'0'.repeat(64)},x=>x.manifest.actualPreparedHashes['bochs/owned-ram-ROM.bin']='0'.repeat(64),x=>x.manifest.actualPreparedHashes['bochs/owned-ram-provider.mjs']='0'.repeat(64),x=>delete x.manifest.originalColdProvenance,x=>x.manifest.originalColdProvenance.generatedRuntimeSha256='0'.repeat(64),x=>x.manifest.originalColdProvenance.sourceHashes.foreign='0'.repeat(64),x=>x.input.addon='/foreign/bw_direct.node',x=>x.manifest.sourceHashes.foreign='0'.repeat(64),x=>x.receipt.requiredFeatures={...requiredFeatures,BX_CPU_LEVEL:4},x=>x.manifest.originalH4Provenance.profile=ramBootstrapProfile]){const v=fixture();mutate(v);assert.throws(()=>validateBuildMetadata(v.input,v.source,v.manifest,v.receipt));}
});
test('configuration pins exact generated ROM role/content and authentic VGA, with no caller ROM',()=>{
 const d=mkdtempSync(join(tmpdir(),'ram-build-config-'));try{mkdirSync(join(d,'bochs'));const f=fixture(d),p=join(d,'bochsrc'),rom=join(d,'bochs/owned-ram-ROM.bin');writeFileSync(rom,fixedRamBootstrapRom());const text=canonicalConfiguration(f.manifest,join(d,'run.log'));writeFileSync(p,text);assert.equal(authenticateConfiguration(p,f.manifest).romSha256,ramBootstrapProfile.romSha256);
 for(const change of [s=>s.replace('guest=16','guest=32'),s=>s.replace('owned-ram-ROM.bin','foreign-ROM.bin'),s=>s+'cpu: count=2\n']){writeFileSync(p,change(text));assert.throws(()=>authenticateConfiguration(p,f.manifest));}writeFileSync(p,text);const b=fixedRamBootstrapRom();b[8]^=1;writeFileSync(rom,b);assert.throws(()=>authenticateConfiguration(p,f.manifest));assert.throws(()=>canonicalConfiguration(f.manifest,'/tmp/space log'));writeFileSync(rom,fixedRamBootstrapRom());symlinkSync(p,join(d,'link'));assert.throws(()=>boundedJson(join(d,'link'),sha256(readFileSync(p))));}finally{rmSync(d,{recursive:true,force:true});}
});
test('admission/preparer derivatives pin parents and new source closure is current/Git complete',()=>{
 const bytes=readFileSync(new URL('../bochs-cpu3-native-cold-bios/identity.mjs',import.meta.url)),derived=deriveAdmissionSource(bytes);assert.equal(sha256(bytes),admissionParentSha256);assert.ok(derived.bytes.includes('bw.native-ram-bootstrap-build-receipt.v1'));assert.ok(!derived.bytes.includes('export function canonicalConfiguration'));const wrong=Buffer.from(bytes);wrong[0]^=1;assert.throws(()=>deriveAdmissionSource(wrong));assert.equal(sha256(readFileSync(new URL('../prepare-bochs-cpu3-native-cold-bios.mjs',import.meta.url))),preparerParentSha256);const source=sourceIdentity();assert.ok(source.hashes['scripts/bochs-cpu3-native-ram-bootstrap/build-identity.mjs']);assert.ok(source.hashes['.github/workflows/i80386-native-ram-bootstrap-build.yml']);assert.ok(source.hashes['test/i80386-ram-bootstrap-build-source.test.mjs']);
});
test('build helper import performs no work and guards original hash/disjoint fresh paths',()=>{
 const helper=fileURLToPath(new URL('../ci-build-i80386-native-ram-bootstrap.py',import.meta.url));const code=`import sys;sys.dont_write_bytecode=True
import importlib.util,pathlib,tempfile
p=${JSON.stringify(helper)}
spec=importlib.util.spec_from_file_location('ram_builder',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
raw=m.parent.read_bytes();derived=m.derive_builder(raw);assert 'bochs-cpu3-native-ram-bootstrap/build-identity.mjs' in derived;assert 'bw.native-ram-bootstrap-build-receipt.v1' in derived
try:m.derive_builder(b'changed')
except AssertionError:pass
else:raise AssertionError('unknown helper accepted')
with tempfile.TemporaryDirectory() as d:
 w=pathlib.Path(d)/'source';u=pathlib.Path(d)/'upstream';w.mkdir();u.mkdir();r=pathlib.Path(d)/'evidence';t=pathlib.Path(d)/'prepared'
 assert m.validate_paths(list(map(str,[w,r,t,u])))==(w,r,t,u)
 for args in [[w,r,t,w],[w,w/'nested',t,u],[w,r,t,'relative']]:
  try:m.validate_paths(list(map(str,args)))
  except AssertionError:pass
  else:raise AssertionError('bad role accepted')
 r.symlink_to(pathlib.Path(d)/'missing')
 try:m.validate_paths(list(map(str,[w,r,t,u])))
 except AssertionError:pass
 else:raise AssertionError('dangling role accepted')
print('PURE_BUILD_HELPER_IMPORT_AND_REFUSALS_PASS')
`;assert.equal(execFileSync('python3',['-c',code],{timeout:10000,encoding:'utf8'}).trim(),'PURE_BUILD_HELPER_IMPORT_AND_REFUSALS_PASS');
});
test('build context cannot claim addon execution or alter static inputs',()=>{
 const f=fixture();f.manifest.configure=['fixed-configure'];f.manifest.build=['fixed-build'];f.receipt.configSha256='f'.repeat(64);const c={schema:'bw.native-ram-bootstrap-build-context.v1',sourceRevision:f.source.revision,sourceHashes:f.source.hashes,bochsRevision:f.manifest.bochsRevision,preparedManifestSha256:f.receipt.preparedManifestSha256,preparedHashes:f.receipt.preparedHashes,configSha256:f.receipt.configSha256,configure:f.manifest.configure,build:f.manifest.build,nodeVersion:'v22.23.3',compilerVersion:'diagnostic compiler',platform:'diagnostic host',architecture:'diagnostic arch',addonLoaded:false};validateBuildContext(c,f.receipt,f.manifest);for(const change of [{addonLoaded:true},{sourceRevision:'0'.repeat(40)},{nodeVersion:'v20'},{preparedHashes:{}},{configSha256:'0'.repeat(64)},{build:['other']}])assert.throws(()=>validateBuildContext({...c,...change},f.receipt,f.manifest));
});
test('manual build workflow remains disabled/read-only/exact commit with always evidence',()=>{
 const s=readFileSync(new URL('../../.github/workflows/i80386-native-ram-bootstrap-build.yml',import.meta.url),'utf8');assert.ok(s.includes('workflow_dispatch:'));assert.ok(!s.includes('pull_request:'));assert.ok(s.includes('default: false'));assert.ok(s.includes('inputs.enable_build == true'));assert.ok(s.includes('ref: ${{ github.sha }}'));assert.ok(s.includes('BW_EXPECTED_HEAD: ${{ github.sha }}'));assert.ok(s.includes('contents: read'));assert.ok(s.includes('if: always()'));assert.ok(s.includes('include-hidden-files: true'));assert.ok(s.includes('node-version: 22.23.3'));assert.ok(!s.includes('scripts/run-i80386'));assert.ok(!s.includes('enable_guest'));assert.ok(s.includes('0e45b736ef9792eb9b752b0a35db49eaf2faea47'));
});
