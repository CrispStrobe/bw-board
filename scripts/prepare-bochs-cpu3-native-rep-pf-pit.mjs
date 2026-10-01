/** Prepare a separate pinned Bochs tree. This does not build or run guests. */
import {execFileSync} from 'node:child_process';
import {copyFileSync,existsSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {patchPinnedSource,revision,sha256,upstreamHashes} from './bochs-cpu3-native-rep-pf-pit/patch.mjs';

const repo=resolve(fileURLToPath(new URL('..',import.meta.url)));
const source=process.env.BOCHS_386_ROOT && resolve(process.env.BOCHS_386_ROOT);
const [mode,destination,...extra]=process.argv.slice(2);
if(!source || extra.length || !['--check','--prepare'].includes(mode) ||
  (mode==='--check' && destination) || (mode==='--prepare' && !destination))
  throw new Error('BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-rep-pf-pit.mjs --check | --prepare /new/tree');
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
if(git(source,['rev-parse','HEAD'])!==revision ||
   git(source,['status','--porcelain','--untracked-files=no']))
  throw new Error('input Bochs source is not the clean pinned revision');
const changed=Object.fromEntries(Object.keys(upstreamHashes).map(path=>
  [path,patchPinnedSource(path,readFileSync(resolve(source,path)))]));
const owned=['scripts/bochs-cpu3-native-rep-pf-pit/abi.h',
  'scripts/bochs-cpu3-native-rep-pf-pit/runtime.h',
  'scripts/bochs-cpu3-native-rep-pf-pit/runtime.inc',
  'scripts/bochs-cpu3-native-rep-pf-pit/patch.mjs',
  'scripts/prepare-bochs-cpu3-native-rep-pf-pit.mjs',
  'scripts/bochs-cpu3-native-memory-map/patch.mjs',
  'scripts/bochs-cpu3-native-events/patch.mjs',
  'scripts/bochs-cpu3-native-slice/patch.mjs',
  'scripts/bochs-cpu3-native-device-quanta/patch.mjs',
  'scripts/bochs-cpu3-native-ram-coherence/patch.mjs',
  'test/fixtures/i80386-free-rep-pf-pit.S',
  'scripts/bochs-cpu3-native-rep-pf-pit/wire-contract.md'];
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
  result.preparedTree=target;
  result.configure=['./configure','--enable-cpu-level=3','--with-nogui',
    '--disable-plugins','--disable-debugger','--disable-repeat-speedups',
    '--disable-handlers-chaining','--enable-instrumentation=instrument/stubs'];
  result.build=['nice','make','-j1'];
  result.requiredConfig={'BX_CPU_LEVEL':3,'BX_USE_IDLE_HACK':0,
    'BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS':0};
}
console.log(JSON.stringify(result,null,2));
