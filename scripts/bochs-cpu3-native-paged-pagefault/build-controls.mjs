import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {derivePageFaultAdmission,sourceIdentity,regularBytes,generatedHashes,validateBuildMetadata,validateBuildContext,canonicalConfiguration,authenticateConfiguration,boundedJson,buildReceiptSchema,requiredFeatures,requiredExports} from './build-identity.mjs';
import {finalizeIntIretPreparation as finalizeHeldIntPreparation} from '../bochs-cpu3-native-paged-int-iret/build-identity.mjs';
import {finalizePagingPreparation as finalizeHeldPagingPreparation} from '../bochs-cpu3-native-nonidentity-paging/build-identity.mjs';
import {finalizeStackPreparation as finalizeHeldStackPreparation} from '../bochs-cpu3-native-protected-stack/build-identity.mjs';
import {finalizeProtectedPreparation} from '../bochs-cpu3-native-protected-ram/build-identity.mjs';
import {finalizeRamPreparation} from '../prepare-bochs-cpu3-native-ram-bootstrap.mjs';
import {derivePageFaultPreparer,preparerParentSha256} from '../prepare-bochs-cpu3-native-paged-pagefault.mjs';
import {finalizePageFaultPreparation,generatedPageFaultArtifacts,buildAssets} from './build-identity.mjs';
import {finalizePreparation} from '../prepare-bochs-cpu3-native-cold-bios.mjs';
import {nativePageFaultProfile} from './provider-profile.mjs';
import {fixedPageFaultRom,terminalEip} from './profile.mjs';
import {hotNativeProfile} from '../bochs-cpu3-native-hot-direct/profile.mjs';
import {upstreamHashes} from '../bochs-cpu3-native-direct-board/patch.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
// Manufactured metadata exercises pure guards; it is never a genuine build receipt.

// CURRENT_PF_INVENTORY_BEGIN: metadata-only helpers, no production seed changes.
const currentInventoryBytes=44149;
const currentInventorySha256='9ae1a88eb3e0df91f8393f034af15d2d6202a25ee87250ad4af38667af7a32c7';
const originalBindingSha256='0311ea55d664b3555fd823d544bc13c5313283b3c91dc15e3bbe0258a10b9a42';
const bridgePath='scripts/i80386-historical-source-contexts/bridge.mjs';
const bridgeSha256='23fad659fb38a857a09c0d7bd64022fd3b87f257ca429616c0717e013ca2f0d6';
function uniqueInventoryJson(text){
 assert.equal(typeof text,'string');assert.ok(Buffer.byteLength(text)<=131072);
 let position=0,nodes=0;
 const space=()=>{while(/\s/.test(text[position]??'')&&position<text.length)position++;};
 function string(){
  const start=position;assert.equal(text[position++],'"');let escaped=false;
  while(position<text.length){const c=text[position++];if(escaped){escaped=false;continue;}if(c==='\\'){escaped=true;continue;}if(c==='"'){const value=JSON.parse(text.slice(start,position));assert.ok(value.length<=512);return value;}}
  assert.fail('unterminated inventory string');
 }
 function value(depth){
  assert.ok(depth<=10&&++nodes<=6000,'inventory JSON budget');space();
  if(text[position]==='{'){
   position++;space();const names=new Set();if(text[position]==='}'){position++;return;}
   for(;;){space();const key=string();assert.ok(!names.has(key),'duplicate inventory key');names.add(key);space();assert.equal(text[position++],':');value(depth+1);space();if(text[position]==='}'){position++;return;}assert.equal(text[position++],',');}
  }
  if(text[position]==='['){position++;space();if(text[position]===']'){position++;return;}for(;;){value(depth+1);space();if(text[position]===']'){position++;return;}assert.equal(text[position++],',');}}
  if(text[position]==='"'){string();return;}
  const token=/^(?:0|[1-9][0-9]*|true|false|null)/.exec(text.slice(position));assert.ok(token,'inventory primitive');position+=token[0].length;
 }
 value(0);space();assert.equal(position,text.length,'inventory trailing bytes');
 return JSON.parse(text);
}
function closedInventoryKeys(value,names){
 assert.ok(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),[...names].sort(),'closed inventory keys');
}
function validateCurrentInventory(declaration,binding){
 closedInventoryKeys(declaration,['schema','version','original','added','currentStaticPaths','staticCount','metadataRole','fixtureCount']);
 assert.equal(declaration.schema,'bw.current-paged-pf-static-inventory.v1');assert.equal(declaration.version,1);
 closedInventoryKeys(declaration.original,['bindingPath','bindingSha256','compiledRevision','compiledSourceSha256','compiledFiles']);
 assert.equal(declaration.original.bindingPath,'scripts/bochs-cpu3-native-paged-pagefault/driver-build-binding.json');
 assert.equal(declaration.original.bindingSha256,originalBindingSha256);
 assert.equal(declaration.original.compiledRevision,'5df525f72790876d35e49d936bac1f1284fa81e7');
 assert.equal(declaration.original.compiledSourceSha256,'73b16ea6d2f49f55d30c513ba033b272a40a76bfa4f94e34c2ceee3266046993');
 assert.equal(binding.compiledRevision,declaration.original.compiledRevision);
 assert.equal(binding.compiledSourceSha256,declaration.original.compiledSourceSha256);
 assert.deepEqual(declaration.original.compiledFiles,binding.compiledFiles,'published original243 map');
 const old=Object.keys(binding.compiledFiles);assert.equal(old.length,243);assert.ok(!old.includes(bridgePath));
 closedInventoryKeys(declaration.added,['path','sha256']);assert.equal(declaration.added.path,bridgePath);assert.equal(declaration.added.sha256,bridgeSha256);
 assert.deepEqual(declaration.currentStaticPaths,[...old,bridgePath].sort(),'exact original243 plus bridge');
 assert.equal(declaration.staticCount,244);assert.equal(declaration.fixtureCount,245);
 assert.equal(declaration.metadataRole,'scripts/bochs-cpu3-native-paged-pagefault/current-source-inventory.json');
 assert.ok(!declaration.currentStaticPaths.includes(declaration.metadataRole),'metadata role is separate');
 return declaration;
}
function assertCurrentInventory(source,declaration){
 assert.ok(source&&source.hashes&&typeof source.hashes==='object'&&!Array.isArray(source.hashes));
 assert.deepEqual(Object.keys(source.hashes).sort(),declaration.currentStaticPaths,'current static path census');
 for(const digest of Object.values(source.hashes))assert.match(digest,/^[a-f0-9]{64}$/);
 assert.equal(source.hashes[bridgePath],bridgeSha256,'exact admitted current bridge');
}
function readCurrentInventory(){
 const raw=regularBytes(fileURLToPath(new URL('./current-source-inventory.json',import.meta.url)),currentInventoryBytes);
 assert.equal(raw.length,currentInventoryBytes);assert.equal(sha256(raw),currentInventorySha256,'current inventory raw seal');
 const old=regularBytes(fileURLToPath(new URL('./driver-build-binding.json',import.meta.url)),131072);
 assert.equal(sha256(old),originalBindingSha256,'unchanged original binding seal');
 return validateCurrentInventory(uniqueInventoryJson(new TextDecoder('utf-8',{fatal:true}).decode(raw)),uniqueInventoryJson(new TextDecoder('utf-8',{fatal:true}).decode(old)));
}
// CURRENT_PF_INVENTORY_END

function fixture(tree='/diagnostic-protected-prepared'){
 const source={revision:'a'.repeat(40),hashes:{'diagnostic-source':'b'.repeat(64)}};
 const h4={boardRevision:source.revision,bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',sourceHashes:{...source.hashes},profile:hotNativeProfile,generatedRuntimeSha256:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',preparedTree:tree,upstreamHashes,patchedHashes:Object.fromEntries(Object.keys(upstreamHashes).map(p=>[p,'c'.repeat(64)]))};
 const cold=finalizePreparation(h4,source),ram=finalizeRamPreparation(cold,source),protectedEntry=finalizeProtectedPreparation(ram,source),stackEntry=finalizeHeldStackPreparation(protectedEntry,source),pagingEntry=finalizeHeldPagingPreparation(stackEntry,source),intEntry=finalizeHeldIntPreparation(pagingEntry,source),manifest=finalizePageFaultPreparation(intEntry,source);
 const input={preparedManifest:'/diagnostic-manifest.json',preparedManifestSha256:'d'.repeat(64),addon:tree+'/bochs/bw_direct.node',sha256:'e'.repeat(64)};
 const receipt={schema:buildReceiptSchema,status:'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST',pagedPageFaultProfile:nativePageFaultProfile,sourceRevision:source.revision,sourceHashes:source.hashes,preparedHashes:generatedHashes(),preparedTree:tree,preparedManifestPath:input.preparedManifest,preparedManifestSha256:input.preparedManifestSha256,addonPath:input.addon,addonSha256:input.sha256,requiredFeatures,requiredExports};
 return structuredClone({source,h4,cold,ram,protectedEntry,stackEntry,pagingEntry,intEntry,manifest,input,receipt});
}
test('PF manifest/config uses new generated roles and preserves historical protected/RAM/cold origins',()=>{
 const d=mkdtempSync(join(tmpdir(),'protected-build-config-'));try{mkdirSync(join(d,'bochs'));const f=fixture(d),p=join(d,'bochsrc'),rom=join(d,'bochs/owned-paged-pagefault-ROM.bin');writeFileSync(rom,fixedPageFaultRom());const text=canonicalConfiguration(f.manifest,join(d,'run.log'));writeFileSync(p,text);assert.equal(authenticateConfiguration(p,f.manifest).romSha256,nativePageFaultProfile.romSha256);assert.equal(f.manifest.schema,'bw.paged-pagefault.prepared.v1');assert.deepEqual(f.manifest.originalIntIretProvenance,f.intEntry);assert.deepEqual(validateBuildMetadata(f.input,f.source,f.manifest,f.receipt),generatedHashes());
 for(const change of [s=>s.replace('guest=16','guest=32'),s=>s.replace('owned-paged-pagefault-ROM.bin','owned-protected-ram-ROM.bin'),s=>s+'cpu: count=2\n']){writeFileSync(p,change(text));assert.throws(()=>authenticateConfiguration(p,f.manifest));}writeFileSync(p,text);const b=fixedPageFaultRom();b[0x130]^=1;writeFileSync(rom,b);assert.throws(()=>authenticateConfiguration(p,f.manifest));assert.throws(()=>canonicalConfiguration(f.manifest,'/tmp/space log'));}finally{rmSync(d,{recursive:true,force:true});}
});
test('PF preparation derivative authenticates parent and output roles without materialization',()=>{
 const admission=derivePageFaultAdmission(readFileSync(new URL('../bochs-cpu3-native-cold-bios/identity.mjs',import.meta.url)));assert.ok(admission.edits.length>0);assert.ok(admission.bytes.includes('bochs/owned-paged-pagefault-ROM.bin'));assert.ok(admission.bytes.includes('bw.native-paged-pagefault-build-receipt.v1'));assert.ok(!admission.bytes.includes("'bochs/owned-paged-int-iret-ROM.bin':"));
 const raw=readFileSync(new URL('../prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url)),d=derivePageFaultPreparer(raw);assert.equal(sha256(raw),preparerParentSha256);assert.ok(d.bytes.includes('prepareHeldIntSource(argv,env)'));assert.ok(d.bytes.includes('bochs/owned-paged-pagefault-provider.mjs'));assert.ok(d.bytes.includes('bochs/owned-paged-pagefault-ROM.bin'));assert.ok(d.bytes.includes('finalizePageFaultPreparation(intermediate,before)'));assert.throws(()=>derivePageFaultPreparer(Buffer.from('changed')));const f=fixture();assert.equal(f.manifest.pagedPageFaultProfile.kind,'fixed-paged-cpl0-pf14-repair-cr3-iret-retry-native-source-v1');assert.equal(terminalEip,0x700a);assert.equal(f.manifest.pagedIntIretProfile,undefined);assert.equal(f.manifest.nonidentityPagingProfile,undefined);assert.equal(f.manifest.stackProfile,undefined);assert.equal(f.manifest.protectedProfile,undefined);assert.equal(f.manifest.buildReceipt,undefined);assert.equal(f.manifest.reference,undefined);
});
test('PF builder definition-only import retains checked inverse and refuses wrong paths',()=>{
 const p=fileURLToPath(new URL('../ci-build-i80386-native-paged-pagefault.py',import.meta.url));const code=`import sys;sys.dont_write_bytecode=True
import runpy,tempfile,pathlib
m=runpy.run_path(${JSON.stringify(p)},run_name='source_control')
raw=m['held'].held.held.held.held.parent.read_bytes();s=m['derive_builder'](raw)
assert 'bw.native-paged-pagefault-build-receipt.v1' in s
assert 'prepare-bochs-cpu3-native-paged-pagefault.mjs' in s
assert 'bochs-cpu3-native-paged-pagefault/build-identity.mjs' in s
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
print('DEFINITION_ONLY_PF_BUILDER_PASS')`;assert.equal(execFileSync('python3',['-c',code],{timeout:10000,encoding:'utf8'}).trim(),'DEFINITION_ONLY_PF_BUILDER_PASS');
});
test('PF build metadata and context deny old artifacts and execution claims',()=>{
 const f=fixture();f.manifest.configure=['diagnostic configure'];f.manifest.build=['diagnostic build'];f.receipt.configSha256='f'.repeat(64);const c={schema:'bw.native-paged-pagefault-build-context.v1',sourceRevision:f.source.revision,sourceHashes:f.source.hashes,bochsRevision:f.manifest.bochsRevision,preparedManifestSha256:f.receipt.preparedManifestSha256,preparedHashes:f.receipt.preparedHashes,configSha256:f.receipt.configSha256,configure:f.manifest.configure,build:f.manifest.build,nodeVersion:'v22.23.3',compilerVersion:'diagnostic compiler',platform:'diagnostic platform',architecture:'diagnostic arch',addonLoaded:false};validateBuildContext(c,f.receipt,f.manifest);
 for(const change of [{schema:'bw.native-paged-int-iret-build-context.v1'},{schema:'bw.native-nonidentity-paging-build-context.v1'},{schema:'bw.native-protected-stack-build-context.v1'},{schema:'bw.native-protected-ram-build-context.v1'},{addonLoaded:true},{nodeVersion:'v20'},{preparedHashes:{}},{sourceHashes:{}},{build:['other']}])assert.throws(()=>validateBuildContext({...c,...change},f.receipt,f.manifest));
 for(const mutate of [x=>x.manifest.schema='bw.native-paged-int-iret.prepared.v1',x=>x.input.sha256='92a5121df194c6675303913ebd527e7d0253e29e686b2cbd8dd91fb579489b6f',x=>x.receipt.schema='bw.native-paged-int-iret-build-receipt.v1',x=>x.manifest.profile=x.intEntry.profile,x=>x.manifest.actualPreparedHashes=x.intEntry.actualPreparedHashes,x=>x.manifest.originalIntIretProvenance.generatedRuntimeSha256='0'.repeat(64),x=>x.manifest.originalIntIretProvenance.ownedClock.runtimeSha256='0'.repeat(64),x=>x.input.sha256='f3e7406b0b8ce88fcb05be4b99cc0c7a6fab27fa12f1dff071d323ad707a37b7',x=>x.receipt.schema='bw.native-nonidentity-paging-build-receipt.v1',x=>x.manifest.profile=x.pagingEntry.profile,x=>x.manifest.actualPreparedHashes=x.pagingEntry.actualPreparedHashes,x=>x.receipt.schema='bw.native-protected-stack-build-receipt.v1',x=>x.receipt.schema='bw.native-protected-ram-build-receipt.v1',x=>x.manifest.profile=x.ram.profile,x=>x.manifest.actualPreparedHashes=x.ram.actualPreparedHashes,x=>x.manifest.originalPagingProvenance.generatedRuntimeSha256='0'.repeat(64),x=>x.manifest.originalPagingProvenance.ownedClock.runtimeSha256='0'.repeat(64),x=>x.input.sha256='4076aca36f5d7e79eb7cdd829746fd35edd852cd407d5c6eab905f7c1799b439',x=>x.input.sha256='98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e']){const v=structuredClone(f);mutate(v);assert.throws(()=>validateBuildMetadata(v.input,v.source,v.manifest,v.receipt));}
});
test('new manual workflow is fixed disabled/build-only with immutable checkout and always raw evidence',()=>{
 const s=readFileSync(new URL('../../.github/workflows/i80386-native-paged-pagefault-build.yml',import.meta.url),'utf8');for(const x of ['workflow_dispatch:','default: false','inputs.enable_build == true','ref: ${{ github.sha }}','BW_EXPECTED_HEAD: ${{ github.sha }}','contents: read','if: always()','include-hidden-files: true','node-version: 22.23.3','0e45b736ef9792eb9b752b0a35db49eaf2faea47','ci-build-i80386-native-paged-pagefault.py','held-ram-helper.py','held-protected-helper.py','held-stack-helper.py','held-paging-helper.py','held-int-helper.py'])assert.ok(s.includes(x),x);for(const x of ['pull_request:','scripts/run-i80386','enable_guest'])assert.ok(!s.includes(x),x);
});
test('complete PF build identity authenticates current/Git closure and all generated roles',()=>{
 const source=sourceIdentity();for(const p of buildAssets)assert.ok(source.hashes[p],p);const g=generatedHashes(),a=generatedPageFaultArtifacts();assert.equal(g['bochs/cpu/bw_slice_runtime.inc'],sha256(a.runtime.bytes));assert.equal(g['bochs/owned-paged-pagefault-provider.mjs'],sha256(a.provider.bytes));assert.equal(g['bochs/owned-paged-pagefault-ROM.bin'],nativePageFaultProfile.romSha256);assert.equal(g['bochs/owned-protected-ram-ROM.bin'],undefined);assert.equal(g['bochs/owned-protected-stack-ROM.bin'],undefined);assert.equal(g['bochs/owned-nonidentity-paging-ROM.bin'],undefined);assert.ok(source.hashes['src/machine-checkpoint.js']);assert.ok(source.hashes['test/i80386-paged-pagefault-native-runtime-driver.test.mjs']);assert.throws(()=>derivePageFaultAdmission(Buffer.from('changed')));assert.equal(source.hashes['roms/free-at-bios/LICENSE'],sha256(readFileSync(new URL('../../roms/free-at-bios/LICENSE',import.meta.url))));const inventory=readCurrentInventory();assertCurrentInventory(source,inventory);
 for(const mutate of [v=>delete v.hashes[inventory.currentStaticPaths[0]],v=>delete v.hashes[bridgePath],v=>v.hashes['test/foreign-extra.mjs']='a'.repeat(64),v=>v.hashes[bridgePath]='0'.repeat(64)]){const bad=structuredClone(source);mutate(bad);assert.throws(()=>assertCurrentInventory(bad,inventory));}
 assert.throws(()=>uniqueInventoryJson('{"schema":1,"schema":2}'),/duplicate inventory key/);
 const duplicate=structuredClone(inventory);duplicate.currentStaticPaths.push(bridgePath);assert.throws(()=>validateCurrentInventory(duplicate,{compiledRevision:inventory.original.compiledRevision,compiledSourceSha256:inventory.original.compiledSourceSha256,compiledFiles:inventory.original.compiledFiles}));console.log('PF_BUILD_SOURCE_IDENTITY '+JSON.stringify(source));console.log('PF_BUILD_GENERATED_HASHES '+JSON.stringify(g));
});
