/** Exact static ABI5 build admission. No addon load or guest execution. */
import assert from 'node:assert/strict';
import {writeFileSync,statSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {sourceIdentity,regularBytes} from '../bochs-cpu3-native-cold-memory-fusion/identity.mjs';
import {directSourceIdentity,generated} from '../prepare-bochs-cpu3-native-cold-direct-ram.mjs';
import {coldNativeProfile} from '../bochs-cpu3-native-cold-bios/runtime.mjs';
import {STATE_EXPORT_PROFILE} from '../bochs-cpu3-native-cold-bios-typed-state/napi.mjs';
import {PROGRESS_PROFILE} from '../bochs-cpu3-native-compact-progress/napi.mjs';
import {revision as bochsRevision,upstreamHashes,patchPinnedSource} from '../bochs-cpu3-native-direct-board/patch.mjs';

const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32<<20}).trim();
export function expectedBuildMetadata(){
 const base=sourceIdentity(),direct=directSourceIdentity(),derived=generated();
 assert.equal(base.revision,direct.revision);
 return {head:base.revision,sourceHashes:{...base.hashes,...direct.hashes},directSourceHashes:direct.hashes,
  generatedHashes:derived.hashes,heldRuntimeSha256:derived.runtime.baseSha256,
  heldNapiSha256:derived.napi.baseSha256,
  ownerCoreSha256:direct.hashes['scripts/bochs-cpu3-native-cold-owned-ram/owned-ram.h']};
}
export function validateBuildMetadata(manifest,expected){
 assert.equal(manifest.boardRevision,expected.head);assert.equal(manifest.bochsRevision,bochsRevision);
 assert.equal(manifest.directRamProfile,'bw.cpu3.cold.direct-ram-rom-exec.v1');
 assert.equal(manifest.stateExportProfile,STATE_EXPORT_PROFILE);
 assert.equal(manifest.progressExportProfile,PROGRESS_PROFILE);
 assert.deepEqual(manifest.profile,coldNativeProfile);assert.deepEqual(manifest.coldProfile,coldNativeProfile);
 assert.deepEqual(manifest.sourceHashes,expected.sourceHashes,'complete exact source map');
 assert.deepEqual(manifest.directSourceHashes,expected.directSourceHashes,'exact new-profile closure');
 assert.deepEqual(manifest.actualPreparedHashes,expected.generatedHashes,'complete exact generated file map');
 assert.equal(manifest.generatedRuntimeSha256,expected.generatedHashes['bochs/cpu/bw_slice_runtime.inc']);
 assert.equal(manifest.ownedClock.abiVersion,5);
 assert.equal(manifest.ownedClock.runtimeSha256,expected.generatedHashes['bochs/cpu/bw_slice_runtime.inc']);
 assert.equal(manifest.ownedClock.napiSha256,expected.generatedHashes['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc']);
 assert.equal(manifest.ownedClock.abiSha256,expected.generatedHashes['bochs/cpu/bw_slice_abi.h']);
 assert.equal(manifest.ownedClock.ownerCoreSha256,expected.ownerCoreSha256);
 assert.equal(manifest.ownedClock.heldRuntimeSha256,expected.heldRuntimeSha256);
 assert.equal(manifest.ownedClock.heldNapiSha256,expected.heldNapiSha256);
 assert.equal(manifest.embedding.abiVersion,5);
 assert.ok(manifest.originalH4Provenance&&manifest.originalMemoryFusionProvenance);
 assert.equal(manifest.originalMemoryFusionProvenance.memoryFusionProfile,'bw.cold-native.memory-clock-fusion.v1');
 assert.deepEqual(manifest.upstreamHashes,upstreamHashes,'exact upstream patch role/hash map');
 assert.deepEqual(Object.keys(manifest.patchedHashes).sort(),Object.keys(upstreamHashes).sort(),'exact CPU patch roles');
 assert.deepEqual(manifest.configure,['./configure','--enable-cpu-level=3','--with-nogui','--disable-plugins',
  '--disable-debugger','--disable-repeat-speedups','--disable-handlers-chaining',
  '--enable-instrumentation=instrument/stubs','CFLAGS=-O2 -fPIC','CXXFLAGS=-O2 -fPIC']);
 assert.deepEqual(manifest.build,['nice','make','-j1','-f','Makefile','-f','bw_direct_addon.mk','bw_direct.node']);
 assert.ok(isAbsolute(manifest.preparedTree)&&resolve(manifest.preparedTree)===manifest.preparedTree);
 assert.equal(realpathSync(manifest.preparedTree),manifest.preparedTree,'ordinary prepared tree');
 return true;
}
export function verifyDirectBuild(manifestPath,addonPath,outputPath,expectedHead){
 for(const p of [manifestPath,addonPath,outputPath])assert.ok(isAbsolute(p)&&resolve(p)===p);
 assert.match(expectedHead??'',/^[0-9a-f]{40}$/);
 assert.equal(git('rev-parse','HEAD'),expectedHead);assert.equal(git('status','--porcelain'),'');
 const manifest=JSON.parse(regularBytes(manifestPath).toString());
 const expected=expectedBuildMetadata();assert.equal(expected.head,expectedHead);
 validateBuildMetadata(manifest,expected);
 assert.equal(addonPath,resolve(manifest.preparedTree,'bochs/bw_direct.node'),'fixed addon role');
 assert.equal(realpathSync(addonPath),addonPath,'ordinary exact addon path');
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:manifest.preparedTree,encoding:'utf8'}).trim(),bochsRevision);
 for(const [path,hash]of Object.entries(expected.sourceHashes)){
  assert.equal(sha256(regularBytes(resolve(path))),hash,'source file '+path);
  assert.equal(sha256(execFileSync('git',['show',expectedHead+':'+path],{maxBuffer:32<<20})),hash,'HEAD source '+path);
 }
 for(const [path,hash]of Object.entries(upstreamHashes)){
  const original=execFileSync('git',['show',bochsRevision+':'+path],{cwd:manifest.preparedTree,maxBuffer:8<<20});
  assert.equal(sha256(original),hash,'pinned upstream CPU role '+path);
  assert.equal(sha256(patchPinnedSource(path,original)),manifest.patchedHashes[path],'exact CPU patch '+path);
 }
 for(const [path,hash]of Object.entries({...manifest.patchedHashes,...expected.generatedHashes}))
  assert.equal(sha256(regularBytes(resolve(manifest.preparedTree,path))),hash,'prepared file '+path);
 for(const [source,target]of [['scripts/bochs-cpu3-native-direct-board/runtime.h','bochs/cpu/bw_slice_runtime.h'],
  ['scripts/bochs-cpu3-native-direct-board/addon.mk','bochs/bw_direct_addon.mk']])
  assert.equal(sha256(regularBytes(resolve(manifest.preparedTree,target))),expected.sourceHashes[source],'fixed build role '+target);
 const config=regularBytes(resolve(manifest.preparedTree,'bochs/config.h')).toString();
 for(const [key,want]of Object.entries({BX_CPU_LEVEL:3,BX_SUPPORT_SMP:0,BX_DEBUGGER:0,BX_USE_IDLE_HACK:0,
  BX_SUPPORT_REPEAT_SPEEDUPS:0,BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS:0,BX_SUPPORT_FPU:1,BX_PLUGINS:0})){
  const found=[...config.matchAll(new RegExp('^#define\\s+'+key+'\\s+(\\d+)\\s*$','gm'))];
  assert.equal(found.length,1,'config feature '+key);assert.equal(Number(found[0][1]),want);
 }
 const addon=regularBytes(addonPath,8<<20);assert.ok(statSync(addonPath).size>0);
 const exported=execFileSync('nm',['-D','--defined-only',addonPath],{encoding:'utf8'});
 for(const symbol of ['bw_direct_initialize','bw_direct_resume','bw_direct_inspect','bw_direct_close',
  'bw_cold_direct_ram_memory','bw_cold_direct_ram_reconcile_full','bw_cold_direct_ram_watermarks',
  'bw_cold_direct_ram_source_clock','napi_register_module_v1'])
  assert.match(exported,new RegExp('\\b'+symbol+'$','m'),'same-DSO export '+symbol);
 assert.equal(git('status','--porcelain'),'');
 const receipt={schema:'bw.cold-native.direct-ram-static-build.v1',sourceHead:expectedHead,
  preparedManifestSha256:sha256(regularBytes(manifestPath)),preparedHashes:expected.generatedHashes,
  sourceHashes:expected.sourceHashes,ownerCoreSha256:expected.ownerCoreSha256,
  configSha256:sha256(Buffer.from(config)),addonSha256:sha256(addon),addonBytes:addon.length,
  addonLoaded:false,guestRun:false};
 writeFileSync(outputPath,JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
 return receipt;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [manifest,addon,out]=process.argv.slice(2);assert.equal(process.argv.length,5);
 console.log(JSON.stringify(verifyDirectBuild(manifest,addon,out,process.env.BW_EXPECTED_HEAD)));
}
