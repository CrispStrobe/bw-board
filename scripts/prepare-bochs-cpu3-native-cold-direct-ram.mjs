/** Authenticated ABI5 source preparation; no addon load or guest execution. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareColdSource} from './prepare-bochs-cpu3-native-cold-memory-fusion.mjs';
import {regularBytes,sourceIdentity} from './bochs-cpu3-native-cold-memory-fusion/identity.mjs';
import {sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveDirectRamRuntime} from './bochs-cpu3-native-cold-direct-ram/runtime.mjs';
import {deriveDirectRamNapi} from './bochs-cpu3-native-cold-direct-ram/napi.mjs';

const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
const profile='bw.cpu3.cold.direct-ram-rom-exec.v1';
const git=(args,encoding='utf8')=>execFileSync('git',args,{cwd:root,encoding,maxBuffer:32<<20});
export function directSourceIdentity(){
 const revision=git(['rev-parse','HEAD']).trim();assert.equal(git(['status','--porcelain']).trim(),'','clean direct source');
 const roots=git(['ls-files','scripts/bochs-cpu3-native-cold-direct-ram']).trim().split('\n');
 roots.push('scripts/bochs-cpu3-native-cold-owned-ram/owned-ram.h',
  'scripts/bochs-cpu3-native-cold-owned-ram/napi.cc',
  'scripts/bochs-cpu3-native-cold-owned-ram/actual-fixture.mjs',
  'scripts/bochs-cpu3-native-compact-progress/held-napi.cc',
  'scripts/bochs-cpu3-native-compact-progress/progress.inc',
  'scripts/bochs-cpu3-native-compact-progress/napi.mjs',
  'scripts/prepare-bochs-cpu3-native-cold-direct-ram.mjs',
  '.github/workflows/i80386-native-cold-direct-ram-actual.yml');
 const found=new Map();
 function visit(path){
  assert.ok(!isAbsolute(path)&&!path.startsWith('../'),'repository-relative direct source');
  if(found.has(path))return;
  const bytes=regularBytes(resolve(root,path));
  const hash=sha256(bytes);assert.equal(hash,sha256(git(['show',revision+':'+path],null)),'tracked direct source '+path);
  found.set(path,hash);
  if(/\.(mjs|js)$/.test(path))for(const match of bytes.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)){
   const target=resolve(root,dirname(path),match[1]);assert.ok(target.startsWith(root+'/'));
   visit(target.slice(root.length+1));
  }
 }
 for(const path of roots)visit(path);
 const hashes=Object.fromEntries([...found].sort(([a],[b])=>a.localeCompare(b)));
 const directAbi=regularBytes(resolve(root,'scripts/bochs-cpu3-native-cold-direct-ram/abi.h')).toString();
 const pinned=/BW_COLD_DIRECT_RAM_CORE_SHA256 "([0-9a-f]{64})"/.exec(directAbi)?.[1];
 assert.equal(hashes['scripts/bochs-cpu3-native-cold-owned-ram/owned-ram.h'],pinned,'exact reused owner core');
 return {revision,hashes};
}
export function generated(){
 const runtime=deriveDirectRamRuntime(),napi=deriveDirectRamNapi();
 const baseAbi=regularBytes(resolve(root,'scripts/bochs-cpu3-native-owned-in8/abi.h')).toString();
 assert.equal((baseAbi.match(/#define BW_DIRECT_ABI_VERSION 4/g)??[]).length,1,'held ABI4 header');
 const directAbi=regularBytes(resolve(root,'scripts/bochs-cpu3-native-cold-direct-ram/abi.h'));
 const abi=Buffer.from(baseAbi.replace('#define BW_DIRECT_ABI_VERSION 4','#define BW_DIRECT_ABI_VERSION 5')+'\n'+directAbi.toString());
 const files={
  'bochs/cpu/bw_slice_runtime.inc':runtime.bytes,
  'bochs/cpu/bw_slice_abi.h':abi,
  'bochs/bochs-cpu3-native-direct-board/abi.h':abi,
  'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc':napi.bytes,
  'bochs/bochs-cpu3-native-cold-direct-ram/abi.h':directAbi,
  'bochs/bochs-cpu3-native-cold-direct-ram/bridge.h':regularBytes(resolve(root,'scripts/bochs-cpu3-native-cold-direct-ram/bridge.h')),
  'bochs/bochs-cpu3-native-cold-owned-ram/owned-ram.h':regularBytes(resolve(root,'scripts/bochs-cpu3-native-cold-owned-ram/owned-ram.h'))
 };
 return {runtime,napi,files,hashes:Object.fromEntries(Object.entries(files).map(([p,b])=>[p,sha256(b)]))};
}
export function prepareDirectRamSource(argv){
 assert.ok(argv[0]==='--check'&&argv.length===1||argv[0]==='--prepare'&&argv.length===2,'check or prepare only');
 const before=directSourceIdentity(),base=sourceIdentity(),built=generated();
 assert.equal(base.revision,before.revision);
 const result=prepareColdSource(argv);
 assert.equal(result.boardRevision,before.revision);
 if(argv[0]==='--prepare')for(const [path,bytes]of Object.entries(built.files)){
  const target=resolve(result.preparedTree,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes);
  assert.equal(sha256(regularBytes(target)),built.hashes[path]);
 }
 result.originalMemoryFusionProvenance={memoryFusionProfile:result.memoryFusionProfile,ownedClock:structuredClone(result.ownedClock)};
 delete result.memoryFusionProfile;
 result.directRamProfile=profile;
 result.progressExportProfile='bw.cold-native.compact-progress.v1';
 result.sourceHashes={...base.hashes,...before.hashes};
 result.directSourceHashes=before.hashes;
 result.actualPreparedHashes=built.hashes;
 result.generatedRuntimeSha256=built.hashes['bochs/cpu/bw_slice_runtime.inc'];
 result.ownedClock={abiVersion:5,status:'SOURCE_PREPARED_NOT_GUEST_QUALIFIED',runtimeSha256:result.generatedRuntimeSha256,
  napiSha256:built.hashes['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc'],
  abiSha256:built.hashes['bochs/cpu/bw_slice_abi.h'],ownerCoreSha256:before.hashes['scripts/bochs-cpu3-native-cold-owned-ram/owned-ram.h'],
  heldRuntimeSha256:built.runtime.baseSha256,heldNapiSha256:built.napi.baseSha256,
  runtimeSeams:built.runtime.edits.map(e=>e.label),napiSeams:built.napi.edits.map(e=>e.label)};
 if(result.embedding)result.embedding={...result.embedding,abiVersion:5,loaderAdmission:'exact direct source closure and generated ABI5 artifact'};
 assert.deepEqual(directSourceIdentity(),before,'direct source unchanged through preparation');
 assert.deepEqual(sourceIdentity(),base,'inherited source unchanged through preparation');
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareDirectRamSource(process.argv.slice(2)),null,2));
