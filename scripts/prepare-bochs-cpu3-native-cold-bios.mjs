/** Source preparation only. Original H4 intermediate retained; no build/reference/guest invented. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {lstatSync,realpathSync,writeFileSync} from 'node:fs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sourceIdentity,regularBytes,generatedHashes} from './bochs-cpu3-native-cold-bios/identity.mjs';
import {deriveColdBiosRuntime,coldNativeProfile} from './bochs-cpu3-native-cold-bios/runtime.mjs';
import {deriveColdBiosNapi} from './bochs-cpu3-native-cold-bios/napi.mjs';
import {sha256,authenticated} from './bochs-cpu3-native-owned-clock/derive.mjs';
const root=resolve(fileURLToPath(new URL('../',import.meta.url)));
export function validatePreparationRequest(argv,env){
 const [mode,target,...extra]=argv;assert.ok(!extra.length&&['--check','--prepare'].includes(mode));assert.ok(mode==='--check'?argv.length===1:argv.length===2&&typeof target==='string'&&target.length>0);
 for(const k of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'])assert.ok(!env[k],'no executable hook '+k);
 assert.equal(typeof env.BOCHS_386_ROOT,'string');assert.ok(isAbsolute(env.BOCHS_386_ROOT)&&resolve(env.BOCHS_386_ROOT)===env.BOCHS_386_ROOT);assert.equal(realpathSync(env.BOCHS_386_ROOT),env.BOCHS_386_ROOT);assert.ok(lstatSync(env.BOCHS_386_ROOT).isDirectory());
 if(mode==='--prepare'){assert.ok(isAbsolute(target)&&resolve(target)===target);let absent=false;try{lstatSync(target);}catch(e){if(e.code!=='ENOENT')throw e;absent=true;}assert.ok(absent,'new target only; dangling links are existing entries');assert.equal(realpathSync(dirname(target)),dirname(target),'ordinary parent');}
 return {mode,target};
}
export function finalizePreparation(intermediate,source,runtime=deriveColdBiosRuntime(),napi=deriveColdBiosNapi()){
 assert.equal(intermediate.boardRevision,source.revision);assert.equal(intermediate.bochsRevision,'0e45b736ef9792eb9b752b0a35db49eaf2faea47');
 for(const [p,h]of Object.entries(intermediate.sourceHashes))assert.equal(source.hashes[p],h,'H4 source is in complete cold closure '+p);
 const out=structuredClone(intermediate);out.originalH4Provenance=structuredClone(intermediate);out.originalH4Profile=structuredClone(intermediate.profile);
 out.sourceHashes={...source.hashes};out.profile=coldNativeProfile;out.coldProfile=coldNativeProfile;out.generatedRuntimeSha256=sha256(runtime.bytes);
 const expected=generatedHashes();out.ownedClock={abiVersion:4,status:'SOURCE_ONLY_NOT_BUILT_OR_EXECUTED',runtimeSha256:expected['bochs/cpu/bw_slice_runtime.inc'],napiSha256:expected['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc'],abiSha256:expected['bochs/cpu/bw_slice_abi.h'],heldRuntimeSha256:runtime.baseSha256,heldNapiSha256:napi.baseSha256,runtimeSeams:runtime.edits.map(e=>e.label),napiSeams:napi.edits.map(e=>e.label),containment:'bounded fresh process; initializing thread owner; fatal guards affect entire process'};
 if(intermediate.preparedTree){out.actualPreparedHashes=expected;out.embedding={...intermediate.embedding,abiVersion:4,loaderAdmission:'distinct cold source/profile/generated-artifact admission; ABI version alone insufficient'};}
 return out;
}
export function prepareColdSource(argv,env=process.env){
 const {mode,target}=validatePreparationRequest(argv,env),before=sourceIdentity(),runtime=deriveColdBiosRuntime(),napi=deriveColdBiosNapi();
 const abi=regularBytes(resolve(root,'scripts/bochs-cpu3-native-owned-in8/abi.h'));
 authenticated(regularBytes(resolve(root,'scripts/bochs-cpu3-native-direct-board/abi.h')),'04f7030ab482caaffa510bd83681f96a3cd3a2a0b900ff9304acefa8d1623a2d','held ABI2 intermediate');
 const intermediate=JSON.parse(execFileSync(process.execPath,[resolve(root,'scripts/prepare-bochs-cpu3-native-hot-direct.mjs'),mode,...(target?[target]:[])],{cwd:root,env,encoding:'utf8',timeout:120000,maxBuffer:16<<20}));
 const result=finalizePreparation(intermediate,before,runtime,napi);
 if(mode==='--prepare'){
  for(const [p,b]of [['bochs/cpu/bw_slice_runtime.inc',runtime.bytes],['bochs/cpu/bw_slice_abi.h',abi],['bochs/bochs-cpu3-native-direct-board/abi.h',abi],['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc',napi.bytes]]){const path=resolve(result.preparedTree,p);regularBytes(path);writeFileSync(path,b);assert.equal(sha256(regularBytes(path)),result.actualPreparedHashes[p]);}
 }
 assert.deepEqual(sourceIdentity(),before,'source remains frozen throughout preparation');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareColdSource(process.argv.slice(2)),null,2));
