import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {deriveIntIretAdmission,sourceIdentity,generatedHashes,validateBuildMetadata,validateBuildContext,canonicalConfiguration,authenticateConfiguration,boundedJson,buildReceiptSchema,requiredFeatures,requiredExports} from './build-identity.mjs';
import {finalizePagingPreparation as finalizeHeldPagingPreparation} from '../bochs-cpu3-native-nonidentity-paging/build-identity.mjs';
import {finalizeStackPreparation as finalizeHeldStackPreparation} from '../bochs-cpu3-native-protected-stack/build-identity.mjs';
import {finalizeProtectedPreparation} from '../bochs-cpu3-native-protected-ram/build-identity.mjs';
import {finalizeRamPreparation} from '../prepare-bochs-cpu3-native-ram-bootstrap.mjs';
import {deriveIntIretPreparer,preparerParentSha256} from '../prepare-bochs-cpu3-native-paged-int-iret.mjs';
import {finalizeIntIretPreparation,generatedIntIretArtifacts,buildAssets} from './build-identity.mjs';
import {finalizePreparation} from '../prepare-bochs-cpu3-native-cold-bios.mjs';
import {nativeIntIretProfile} from './provider-profile.mjs';
import {fixedIntIretRom,terminalEip} from './profile.mjs';
import {hotNativeProfile} from '../bochs-cpu3-native-hot-direct/profile.mjs';
import {upstreamHashes} from '../bochs-cpu3-native-direct-board/patch.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
// Manufactured metadata exercises pure guards; it is never a genuine build receipt.
function fixture(tree='/diagnostic-protected-prepared'){
 const source={revision:'a'.repeat(40),hashes:{'diagnostic-source':'b'.repeat(64)}};
 const h4={boardRevision:source.revision,bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',sourceHashes:{...source.hashes},profile:hotNativeProfile,generatedRuntimeSha256:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',preparedTree:tree,upstreamHashes,patchedHashes:Object.fromEntries(Object.keys(upstreamHashes).map(p=>[p,'c'.repeat(64)]))};
 const cold=finalizePreparation(h4,source),ram=finalizeRamPreparation(cold,source),protectedEntry=finalizeProtectedPreparation(ram,source),stackEntry=finalizeHeldStackPreparation(protectedEntry,source),pagingEntry=finalizeHeldPagingPreparation(stackEntry,source),manifest=finalizeIntIretPreparation(pagingEntry,source);
 const input={preparedManifest:'/diagnostic-manifest.json',preparedManifestSha256:'d'.repeat(64),addon:tree+'/bochs/bw_direct.node',sha256:'e'.repeat(64)};
 const receipt={schema:buildReceiptSchema,status:'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST',pagedIntIretProfile:nativeIntIretProfile,sourceRevision:source.revision,sourceHashes:source.hashes,preparedHashes:generatedHashes(),preparedTree:tree,preparedManifestPath:input.preparedManifest,preparedManifestSha256:input.preparedManifestSha256,addonPath:input.addon,addonSha256:input.sha256,requiredFeatures,requiredExports};
 return structuredClone({source,h4,cold,ram,protectedEntry,stackEntry,pagingEntry,manifest,input,receipt});
}
test('INT manifest/config uses new generated roles and preserves historical protected/RAM/cold origins',()=>{
 const d=mkdtempSync(join(tmpdir(),'protected-build-config-'));try{mkdirSync(join(d,'bochs'));const f=fixture(d),p=join(d,'bochsrc'),rom=join(d,'bochs/owned-paged-int-iret-ROM.bin');writeFileSync(rom,fixedIntIretRom());const text=canonicalConfiguration(f.manifest,join(d,'run.log'));writeFileSync(p,text);assert.equal(authenticateConfiguration(p,f.manifest).romSha256,nativeIntIretProfile.romSha256);assert.deepEqual(f.manifest.originalPagingProvenance,f.pagingEntry);assert.deepEqual(validateBuildMetadata(f.input,f.source,f.manifest,f.receipt),generatedHashes());
 for(const change of [s=>s.replace('guest=16','guest=32'),s=>s.replace('owned-paged-int-iret-ROM.bin','owned-protected-ram-ROM.bin'),s=>s+'cpu: count=2\n']){writeFileSync(p,change(text));assert.throws(()=>authenticateConfiguration(p,f.manifest));}writeFileSync(p,text);const b=fixedIntIretRom();b[0x130]^=1;writeFileSync(rom,b);assert.throws(()=>authenticateConfiguration(p,f.manifest));assert.throws(()=>canonicalConfiguration(f.manifest,'/tmp/space log'));}finally{rmSync(d,{recursive:true,force:true});}
});
test('INT preparation derivative authenticates parent and output roles without materialization',()=>{
 const raw=readFileSync(new URL('../prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url)),d=deriveIntIretPreparer(raw);assert.equal(sha256(raw),preparerParentSha256);assert.ok(d.bytes.includes('prepareHeldPagingSource(argv,env)'));assert.ok(d.bytes.includes('bochs/owned-paged-int-iret-provider.mjs'));assert.ok(d.bytes.includes('bochs/owned-paged-int-iret-ROM.bin'));assert.ok(d.bytes.includes('finalizeIntIretPreparation(intermediate,before)'));assert.throws(()=>deriveIntIretPreparer(Buffer.from('changed')));const f=fixture();assert.equal(f.manifest.pagedIntIretProfile.kind,'fixed-paged-cpl0-int30-iret-native-source-v1');assert.equal(terminalEip,0x7005);assert.equal(f.manifest.nonidentityPagingProfile,undefined);assert.equal(f.manifest.stackProfile,undefined);assert.equal(f.manifest.protectedProfile,undefined);assert.equal(f.manifest.buildReceipt,undefined);assert.equal(f.manifest.reference,undefined);
});
test('INT builder definition-only import retains checked inverse and refuses wrong paths',()=>{
 const p=fileURLToPath(new URL('../ci-build-i80386-native-paged-int-iret.py',import.meta.url));const code=`import sys;sys.dont_write_bytecode=True
import runpy,tempfile,pathlib
m=runpy.run_path(${JSON.stringify(p)},run_name='source_control')
raw=m['held'].held.held.held.parent.read_bytes();s=m['derive_builder'](raw)
assert 'bw.native-paged-int-iret-build-receipt.v1' in s
assert 'prepare-bochs-cpu3-native-paged-int-iret.mjs' in s
assert 'bochs-cpu3-native-paged-int-iret/build-identity.mjs' in s
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
print('DEFINITION_ONLY_INT_BUILDER_PASS')`;assert.equal(execFileSync('python3',['-c',code],{timeout:10000,encoding:'utf8'}).trim(),'DEFINITION_ONLY_INT_BUILDER_PASS');
});
test('INT build metadata and context deny old artifacts and execution claims',()=>{
 const f=fixture();f.manifest.configure=['diagnostic configure'];f.manifest.build=['diagnostic build'];f.receipt.configSha256='f'.repeat(64);const c={schema:'bw.native-paged-int-iret-build-context.v1',sourceRevision:f.source.revision,sourceHashes:f.source.hashes,bochsRevision:f.manifest.bochsRevision,preparedManifestSha256:f.receipt.preparedManifestSha256,preparedHashes:f.receipt.preparedHashes,configSha256:f.receipt.configSha256,configure:f.manifest.configure,build:f.manifest.build,nodeVersion:'v22.23.3',compilerVersion:'diagnostic compiler',platform:'diagnostic platform',architecture:'diagnostic arch',addonLoaded:false};validateBuildContext(c,f.receipt,f.manifest);
 for(const change of [{schema:'bw.native-nonidentity-paging-build-context.v1'},{schema:'bw.native-protected-stack-build-context.v1'},{schema:'bw.native-protected-ram-build-context.v1'},{addonLoaded:true},{nodeVersion:'v20'},{preparedHashes:{}},{sourceHashes:{}},{build:['other']}])assert.throws(()=>validateBuildContext({...c,...change},f.receipt,f.manifest));
 for(const mutate of [x=>x.input.sha256='f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7',x=>x.receipt.schema='bw.native-nonidentity-paging-build-receipt.v1',x=>x.manifest.profile=x.pagingEntry.profile,x=>x.manifest.actualPreparedHashes=x.pagingEntry.actualPreparedHashes,x=>x.receipt.schema='bw.native-protected-stack-build-receipt.v1',x=>x.receipt.schema='bw.native-protected-ram-build-receipt.v1',x=>x.manifest.profile=x.ram.profile,x=>x.manifest.actualPreparedHashes=x.ram.actualPreparedHashes,x=>x.manifest.originalPagingProvenance.generatedRuntimeSha256='0'.repeat(64),x=>x.manifest.originalPagingProvenance.ownedClock.runtimeSha256='0'.repeat(64),x=>x.input.sha256='4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439',x=>x.input.sha256='98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e']){const v=fixture();mutate(v);assert.throws(()=>validateBuildMetadata(v.input,v.source,v.manifest,v.receipt));}
});
test('new manual workflow is fixed disabled/build-only with immutable checkout and always raw evidence',()=>{
 const s=readFileSync(new URL('../../.github/workflows/i80386-native-paged-int-iret-build.yml',import.meta.url),'utf8');for(const x of ['workflow_dispatch:','default: false','inputs.enable_build == true','ref: ${{ github.sha }}','BW_EXPECTED_HEAD: ${{ github.sha }}','contents: read','if: always()','include-hidden-files: true','node-version: 22.23.3','0e45b736ef9792eb9b752b0a35db49eaf2faea47','ci-build-i80386-native-paged-int-iret.py','held-ram-helper.py','held-protected-helper.py','held-stack-helper.py','held-paging-helper.py'])assert.ok(s.includes(x),x);for(const x of ['pull_request:','scripts/run-i80386','enable_guest'])assert.ok(!s.includes(x),x);
});
test('complete INT build identity authenticates current/Git closure and all generated roles',()=>{
 const source=sourceIdentity();for(const p of buildAssets)assert.ok(source.hashes[p],p);const g=generatedHashes(),a=generatedIntIretArtifacts();assert.equal(g['bochs/cpu/bw_slice_runtime.inc'],sha256(a.runtime.bytes));assert.equal(g['bochs/owned-paged-int-iret-provider.mjs'],sha256(a.provider.bytes));assert.equal(g['bochs/owned-paged-int-iret-ROM.bin'],nativeIntIretProfile.romSha256);assert.equal(g['bochs/owned-protected-ram-ROM.bin'],undefined);assert.equal(g['bochs/owned-protected-stack-ROM.bin'],undefined);assert.equal(g['bochs/owned-nonidentity-paging-ROM.bin'],undefined);assert.ok(source.hashes['src/machine-checkpoint.js']);assert.ok(source.hashes['test/i80386-paged-int-iret-native-source.test.mjs']);assert.throws(()=>deriveIntIretAdmission(Buffer.from('changed')));assert.equal(source.hashes['roms/free-at-bios/LICENSE'],sha256(readFileSync(new URL('../../roms/free-at-bios/LICENSE',import.meta.url))));
});
