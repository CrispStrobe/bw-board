import {deriveHotRuntime} from './bochs-cpu3-native-hot-direct/runtime.mjs';
import {hotNativeProfile} from './bochs-cpu3-native-hot-direct/profile.mjs';
/** Prepare a separate pinned Bochs tree. This does not build or run guests. */
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchPinnedSource,revision,sha256,upstreamHashes} from './bochs-cpu3-native-direct-board/patch.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=process.env.BOCHS_386_ROOT && resolve(process.env.BOCHS_386_ROOT);
const [mode,destination,...extra]=process.argv.slice(2);
if(!source || extra.length || !['--check','--prepare'].includes(mode) ||
  (mode==='--check' && destination) || (mode==='--prepare' && !destination))
  throw new Error('BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-direct-board.mjs --check | --prepare /new/tree');
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
if(git(source,['rev-parse','HEAD'])!==revision ||
   git(source,['status','--porcelain','--untracked-files=no']))
  throw new Error('input Bochs source is not the clean pinned revision');
const changed=Object.fromEntries(Object.keys(upstreamHashes).map(path=>
  [path,patchPinnedSource(path,readFileSync(resolve(source,path)))]));
const owned=['scripts/bochs-cpu3-native-direct-board/abi.h',
  'scripts/bochs-cpu3-native-direct-board/runtime.h',
  'scripts/bochs-cpu3-native-direct-board/runtime.inc',
  'scripts/bochs-cpu3-native-direct-board/patch.mjs',
  'scripts/bochs-cpu3-native-combined-paging-ram/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-direct-board.mjs',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/bochs-cpu3-native-device-quanta/patch.mjs',
  'scripts/bochs-cpu3-native-ram-coherence/patch.mjs',
  'scripts/bochs-cpu3-native-rep-pf-pit/patch.mjs',
  'test/fixtures/i80386-free-combined-paging-ram.S',
  'scripts/bochs-cpu3-native-direct-board/board.mjs',
  'test/i80386-native-direct-board.test.mjs',
  'scripts/bochs-cpu3-native-direct-board/addon.mk',
  'scripts/bochs-cpu3-native-direct-board-adapter/napi.cc','scripts/prepare-bochs-cpu3-native-hot-direct.mjs','scripts/bochs-cpu3-native-hot-direct/runtime.mjs','scripts/bochs-cpu3-native-hot-direct/profile.mjs','scripts/bochs-cpu3-native-hot-direct/board.mjs','scripts/bochs-cpu3-native-hot-direct/loader.mjs','test/i80386-native-hot-direct.test.mjs','test/fixtures/i80386-free-combined-hot.S','scripts/i80386-free-combined-hot.mjs'];
for(const path of owned){
  execFileSync('git',['ls-files','--error-unmatch','--',path],{cwd:repo,stdio:'ignore'});
  const committed=execFileSync('git',['show',`HEAD:${path}`],{cwd:repo});
  if(sha256(committed)!==sha256(readFileSync(resolve(repo,path))))
    throw new Error(`owned source differs from HEAD: ${path}`);
}
const result={bochsRevision:revision,boardRevision:git(repo,['rev-parse','HEAD']),
  sourceHashes:Object.fromEntries(owned.map(path=>[path,sha256(readFileSync(resolve(repo,path)))])),
  upstreamHashes,
  patchedHashes:Object.fromEntries(Object.entries(changed).map(([path,bytes])=>[path,sha256(bytes)]))};
const hotRuntime=deriveHotRuntime();result.profile=hotNativeProfile;result.generatedRuntimeSha256=sha256(hotRuntime);
if(mode==='--prepare'){
  const target=resolve(destination);
  if(existsSync(target))throw new Error(`destination exists: ${target}`);
  execFileSync('git',['clone','--local','--no-hardlinks','--quiet',source,target]);
  if(git(target,['rev-parse','HEAD'])!==revision)throw new Error('clone changed revision');
  for(const [path,bytes] of Object.entries(changed))writeFileSync(resolve(target,path),bytes);
  for(const [path,dst] of [
    [owned[0],'bochs/cpu/bw_slice_abi.h'],
    [owned[1],'bochs/cpu/bw_slice_runtime.h'],
    [owned[2],'bochs/cpu/bw_slice_runtime.inc']])
    copyFileSync(resolve(repo,path),resolve(target,dst));
  writeFileSync(resolve(target,'bochs/cpu/bw_slice_runtime.inc'),hotRuntime);
  for(const name of ['bochs-cpu3-native-direct-board','bochs-cpu3-native-direct-board-adapter'])mkdirSync(resolve(target,'bochs',name));
  for(const [src,dst] of [['scripts/bochs-cpu3-native-direct-board/addon.mk','bochs/bw_direct_addon.mk'],['scripts/bochs-cpu3-native-direct-board/abi.h','bochs/bochs-cpu3-native-direct-board/abi.h'],['scripts/bochs-cpu3-native-direct-board-adapter/napi.cc','bochs/bochs-cpu3-native-direct-board-adapter/napi.cc']])copyFileSync(resolve(repo,src),resolve(target,dst));
  result.preparedTree=target;
  result.configure=['./configure','--enable-cpu-level=3','--with-nogui',
    '--disable-plugins','--disable-debugger','--disable-repeat-speedups',
    '--disable-handlers-chaining','--enable-instrumentation=instrument/stubs','CFLAGS=-O2 -fPIC','CXXFLAGS=-O2 -fPIC'];
  result.build=['nice','make','-j1','-f','Makefile','-f','bw_direct_addon.mk','bw_direct.node'];
  result.status='SOURCE_PREPARED_ONLY_NOT_NATIVE_QUALIFICATION';
  const abiVersionMatch=readFileSync(resolve(repo,'scripts/bochs-cpu3-native-direct-board/abi.h'),'utf8').match(/^#define BW_DIRECT_ABI_VERSION ([1-9][0-9]*)$/m);
  if(!abiVersionMatch)throw new Error('direct ABI version declaration missing');
  result.embedding={abiVersion:Number(abiVersionMatch[1]),oneLifetimePerLoadedImage:true,loaderCanonicalImageOnly:true,loaderAdmission:'one canonical DSO per main-thread JS realm',synchronousCallingThread:true,fatalFailuresAbort:true,executeBuffers:'persistent-native-slots'};
  result.requiredConfig={'BX_CPU_LEVEL':3,'BX_USE_IDLE_HACK':0,
    'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0,'BX_SUPPORT_SMP':0,'BX_DEBUGGER':0,'BX_SUPPORT_REPEAT_SPEEDUPS':0,'BX_SUPPORT_FPU':1};
}
console.log(JSON.stringify(result,null,2));
