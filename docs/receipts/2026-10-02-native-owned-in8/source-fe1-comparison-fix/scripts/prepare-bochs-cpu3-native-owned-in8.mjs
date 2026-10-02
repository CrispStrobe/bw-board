/** Source preparation only; distinct ABI4, no automatic compiled build. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {sourceIdentity,ownedAssets} from './bochs-cpu3-native-owned-in8/identity.mjs';
import {deriveOwnedIn8Runtime as deriveOwnedRuntime} from './bochs-cpu3-native-owned-in8/runtime.mjs';
import {deriveOwnedIn8Napi as deriveOwnedNapi} from './bochs-cpu3-native-owned-in8/napi.mjs';
import {sha256,authenticated} from './bochs-cpu3-native-owned-clock/derive.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),[mode,target,...extra]=process.argv.slice(2);
if(extra.length||!['--check','--prepare'].includes(mode)||mode==='--check'&&target||mode==='--prepare'&&!target)throw Error('usage --check | --prepare /new/tree');
const runtime=deriveOwnedRuntime(),napi=deriveOwnedNapi(),abi=readFileSync(new URL('./bochs-cpu3-native-owned-in8/abi.h',import.meta.url));
authenticated(readFileSync(new URL('./bochs-cpu3-native-direct-board/abi.h',import.meta.url)),'04f7030ab482caaffa510bd83681f96a3cd3a2a0b900ff9304acefa8d1623a2d','H4 ABI');
const result=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/prepare-bochs-cpu3-native-hot-direct.mjs'),mode,...(target?[target]:[])],{cwd:root,encoding:'utf8',maxBuffer:16<<20}));
const owned=ownedAssets;
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
for(const p of owned)if(sha256(readFileSync(resolve(root,p)))!==sha256(execFileSync('git',['show',revision+':'+p],{cwd:root})))throw Error('owned input differs from frozen HEAD '+p);
result.originalH4Provenance=structuredClone(result);result.originalH4SourceHashes={...result.sourceHashes};Object.assign(result.sourceHashes,sourceIdentity().hashes);
result.generatedRuntimeSha256=sha256(runtime.bytes);
result.ownedClock={abiVersion:4,status:'SOURCE_ONLY_NOT_BUILT_OR_EXECUTED',runtimeSha256:sha256(runtime.bytes),napiSha256:sha256(napi.bytes),abiSha256:sha256(abi),heldRuntimeSha256:runtime.baseSha256,heldNapiSha256:napi.baseSha256,runtimeSeams:runtime.edits.map(e=>e.label),napiSeams:napi.edits.map(e=>e.label),containment:'main thread in bounded fresh child process; fatal guards kill entire process'};
if(mode==='--prepare'){
 for(const [p,b] of [['bochs/cpu/bw_slice_runtime.inc',runtime.bytes],['bochs/cpu/bw_slice_abi.h',abi],['bochs/bochs-cpu3-native-direct-board/abi.h',abi],['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc',napi.bytes]])writeFileSync(resolve(result.preparedTree,p),b);
 result.actualPreparedHashes=Object.fromEntries(['bochs/cpu/bw_slice_runtime.inc','bochs/cpu/bw_slice_abi.h','bochs/bochs-cpu3-native-direct-board/abi.h','bochs/bochs-cpu3-native-direct-board-adapter/napi.cc'].map(p=>[p,sha256(readFileSync(resolve(result.preparedTree,p)))]));
 result.embedding={...result.embedding,abiVersion:4,loaderAdmission:'distinct private initializing main-thread owner; one canonical frozen DSO; bounded child process'};
}
console.log(JSON.stringify(result,null,2));
