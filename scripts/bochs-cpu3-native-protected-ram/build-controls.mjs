import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {deriveProtectedAdmission,sourceIdentity,generatedHashes,validateBuildMetadata,validateBuildContext,canonicalConfiguration,authenticateConfiguration,boundedJson,buildReceiptSchema,requiredFeatures,requiredExports} from './build-identity.mjs';
import {finalizeRamPreparation} from '../prepare-bochs-cpu3-native-ram-bootstrap.mjs';
import {deriveProtectedPreparer,preparerParentSha256} from '../prepare-bochs-cpu3-native-protected-ram.mjs';
import {finalizeProtectedPreparation,generatedProtectedArtifacts,buildAssets} from './build-identity.mjs';
import {finalizePreparation} from '../prepare-bochs-cpu3-native-cold-bios.mjs';
import {protectedRamProfile,fixedProtectedRamRom} from './profile.mjs';
import {hotNativeProfile} from '../bochs-cpu3-native-hot-direct/profile.mjs';
import {upstreamHashes} from '../bochs-cpu3-native-direct-board/patch.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
// Manufactured metadata exercises pure guards; it is never a genuine build receipt.
function fixture(tree='/diagnostic-protected-prepared'){
 const source={revision:'a'.repeat(40),hashes:{'diagnostic-source':'b'.repeat(64)}};
 const h4={boardRevision:source.revision,bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',sourceHashes:{...source.hashes},profile:hotNativeProfile,generatedRuntimeSha256:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',preparedTree:tree,upstreamHashes,patchedHashes:Object.fromEntries(Object.keys(upstreamHashes).map(p=>[p,'c'.repeat(64)]))};
 const cold=finalizePreparation(h4,source),ram=finalizeRamPreparation(cold,source),manifest=finalizeProtectedPreparation(ram,source);
 const input={preparedManifest:'/diagnostic-manifest.json',preparedManifestSha256:'d'.repeat(64),addon:tree+'/bochs/bw_direct.node',sha256:'e'.repeat(64)};
 const receipt={schema:buildReceiptSchema,status:'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST',protectedProfile:protectedRamProfile,sourceRevision:source.revision,sourceHashes:source.hashes,preparedHashes:generatedHashes(),preparedTree:tree,preparedManifestPath:input.preparedManifest,preparedManifestSha256:input.preparedManifestSha256,addonPath:input.addon,addonSha256:input.sha256,requiredFeatures,requiredExports};
 return structuredClone({source,h4,cold,ram,manifest,input,receipt});
}
test('protected manifest/config uses new generated roles and preserves historical RAM/cold origins',()=>{
 const d=mkdtempSync(join(tmpdir(),'protected-build-config-'));try{mkdirSync(join(d,'bochs'));const f=fixture(d),p=join(d,'bochsrc'),rom=join(d,'bochs/owned-protected-ram-ROM.bin');writeFileSync(rom,fixedProtectedRamRom());const text=canonicalConfiguration(f.manifest,join(d,'run.log'));writeFileSync(p,text);assert.equal(authenticateConfiguration(p,f.manifest).romSha256,protectedRamProfile.romSha256);assert.deepEqual(f.manifest.originalRamProvenance,f.ram);assert.deepEqual(validateBuildMetadata(f.input,f.source,f.manifest,f.receipt),generatedHashes());
 for(const change of [s=>s.replace('guest=16','guest=32'),s=>s.replace('owned-protected-ram-ROM.bin','owned-ram-ROM.bin'),s=>s+'cpu: count=2\n']){writeFileSync(p,change(text));assert.throws(()=>authenticateConfiguration(p,f.manifest));}writeFileSync(p,text);const b=fixedProtectedRamRom();b[0x130]^=1;writeFileSync(rom,b);assert.throws(()=>authenticateConfiguration(p,f.manifest));assert.throws(()=>canonicalConfiguration(f.manifest,'/tmp/space log'));}finally{rmSync(d,{recursive:true,force:true});}
});
test('protected preparation derivative authenticates parent and output roles without materialization',()=>{
 const raw=readFileSync(new URL('../prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url)),d=deriveProtectedPreparer(raw);assert.equal(sha256(raw),preparerParentSha256);assert.ok(d.bytes.includes('prepareHeldRamSource(argv,env)'));assert.ok(d.bytes.includes('bochs/owned-protected-ram-provider.mjs'));assert.ok(d.bytes.includes('bochs/owned-protected-ram-ROM.bin'));assert.ok(d.bytes.includes('finalizeProtectedPreparation(intermediate,before)'));assert.throws(()=>deriveProtectedPreparer(Buffer.from('changed')));const f=fixture();assert.equal(f.manifest.protectedProfile.checkpointCs,0x18);assert.equal(f.manifest.profile.checkpointEip,0x7003);assert.equal(f.manifest.ramProfile,undefined);assert.equal(f.manifest.buildReceipt,undefined);assert.equal(f.manifest.reference,undefined);
});
test('protected builder definition-only import retains checked inverse and refuses wrong paths',()=>{
 const p=fileURLToPath(new URL('../ci-build-i80386-native-protected-ram.py',import.meta.url));const code=`import sys;sys.dont_write_bytecode=True
import runpy,tempfile,pathlib
m=runpy.run_path(${JSON.stringify(p)},run_name='source_control')
raw=m['held'].parent.read_bytes();s=m['derive_builder'](raw)
assert 'bw.native-protected-ram-build-receipt.v1' in s
assert 'prepare-bochs-cpu3-native-protected-ram.mjs' in s
assert 'bochs-cpu3-native-protected-ram/build-identity.mjs' in s
try:m['derive_builder'](b'changed')
except AssertionError:pass
else:raise AssertionError('unknown build parent admitted')
with tempfile.TemporaryDirectory() as d:
 w=pathlib.Path(d)/'source';u=pathlib.Path(d)/'upstream';w.mkdir();u.mkdir();r=pathlib.Path(d)/'evidence';t=pathlib.Path(d)/'prepared'
 assert m['validate_paths'](list(map(str,[w,r,t,u])))==(w,r,t,u)
 for args in [[w,r,t,w],[w,w/'nested',t,u],[w,r,t,'relative']]:
  try:m['validate_paths'](list(map(str,args)))
  except AssertionError:pass
  else:raise AssertionError('bad role admitted')
 r.symlink_to(pathlib.Path(d)/'missing')
 try:m['validate_paths'](list(map(str,[w,r,t,u])))
 except AssertionError:pass
 else:raise AssertionError('dangling role admitted')
print('DEFINITION_ONLY_PROTECTED_BUILDER_PASS')`;assert.equal(execFileSync('python3',['-c',code],{timeout:10000,encoding:'utf8'}).trim(),'DEFINITION_ONLY_PROTECTED_BUILDER_PASS');
});
test('protected build metadata and context deny old artifacts and execution claims',()=>{
 const f=fixture();f.manifest.configure=['diagnostic configure'];f.manifest.build=['diagnostic build'];f.receipt.configSha256='f'.repeat(64);const c={schema:'bw.native-protected-ram-build-context.v1',sourceRevision:f.source.revision,sourceHashes:f.source.hashes,bochsRevision:f.manifest.bochsRevision,preparedManifestSha256:f.receipt.preparedManifestSha256,preparedHashes:f.receipt.preparedHashes,configSha256:f.receipt.configSha256,configure:f.manifest.configure,build:f.manifest.build,nodeVersion:'v22.23.3',compilerVersion:'diagnostic compiler',platform:'diagnostic platform',architecture:'diagnostic arch',addonLoaded:false};validateBuildContext(c,f.receipt,f.manifest);
 for(const change of [{schema:'bw.native-ram-bootstrap-build-context.v1'},{addonLoaded:true},{nodeVersion:'v20'},{preparedHashes:{}},{sourceHashes:{}},{build:['other']}])assert.throws(()=>validateBuildContext({...c,...change},f.receipt,f.manifest));
 for(const mutate of [x=>x.receipt.schema='bw.native-ram-bootstrap-build-receipt.v1',x=>x.manifest.profile=x.ram.profile,x=>x.manifest.actualPreparedHashes=x.ram.actualPreparedHashes,x=>x.manifest.originalRamProvenance.generatedRuntimeSha256='0'.repeat(64)]){const v=fixture();mutate(v);assert.throws(()=>validateBuildMetadata(v.input,v.source,v.manifest,v.receipt));}
});
test('new manual workflow is fixed disabled/build-only with immutable checkout and always raw evidence',()=>{
 const s=readFileSync(new URL('../../.github/workflows/i80386-native-protected-ram-build.yml',import.meta.url),'utf8');for(const x of ['workflow_dispatch:','default: false','inputs.enable_build == true','ref: ${{ github.sha }}','BW_EXPECTED_HEAD: ${{ github.sha }}','contents: read','if: always()','include-hidden-files: true','node-version: 22.23.3','0e45b736ef9792eb9b752b0a35db49eaf2faea47','ci-build-i80386-native-protected-ram.py','held-ram-helper.py'])assert.ok(s.includes(x),x);for(const x of ['pull_request:','scripts/run-i80386','enable_guest'])assert.ok(!s.includes(x),x);
});
test('complete protected build identity authenticates current/Git closure and all generated roles',()=>{
 const source=sourceIdentity();for(const p of buildAssets)assert.ok(source.hashes[p],p);const g=generatedHashes(),a=generatedProtectedArtifacts();assert.equal(g['bochs/cpu/bw_slice_runtime.inc'],sha256(a.runtime.bytes));assert.equal(g['bochs/owned-protected-ram-provider.mjs'],sha256(a.provider.bytes));assert.equal(g['bochs/owned-protected-ram-ROM.bin'],protectedRamProfile.romSha256);assert.equal(g['bochs/owned-ram-ROM.bin'],undefined);assert.throws(()=>deriveProtectedAdmission(Buffer.from('changed')));assert.equal(source.hashes['roms/free-at-bios/LICENSE'],sha256(readFileSync(new URL('../../roms/free-at-bios/LICENSE',import.meta.url))));
});
