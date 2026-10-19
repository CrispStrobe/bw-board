/** Materialization only. No configure, make, addon load or CPU execution. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,lstatSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {prepareColdSource,validatePreparationRequest} from './prepare-bochs-cpu3-native-cold-bios.mjs';
import {authenticated,sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {generatedRamArtifacts} from './bochs-cpu3-native-ram-bootstrap/preparation.mjs';
import {ramBootstrapProfile} from './bochs-cpu3-native-ram-bootstrap/profile.mjs';
import {sourceIdentity,generatedHashes,regularBytes,validateRamManifest} from './bochs-cpu3-native-ram-bootstrap/build-identity.mjs';
export const preparerParentSha256='1ad5d49bb92c1a7e9761e8c068d10785e298bcba202c0e7744ab9c0d992298f4';
export function finalizeRamPreparation(intermediate,source){
 assert.equal(intermediate.boardRevision,source.revision);assert.equal(intermediate.bochsRevision,'0e45b736ef9792eb9b752b0a35db49eaf2faea47');
 assert.equal(intermediate.generatedRuntimeSha256,'6fdf5fccf797777acce655be2609cf58fb498d18ad6d0dd78fdef8e38a505643');
 for(const [p,h]of Object.entries(intermediate.sourceHashes))assert.equal(source.hashes[p],h,'cold source in complete RAM closure');
 const out=structuredClone(intermediate),expected=generatedHashes();out.originalColdProvenance=structuredClone(intermediate);
 delete out.coldProfile;out.sourceHashes={...source.hashes};out.profile=ramBootstrapProfile;out.ramProfile=ramBootstrapProfile;out.generatedRuntimeSha256=expected['bochs/cpu/bw_slice_runtime.inc'];
 out.ownedClock={...intermediate.ownedClock,status:'SOURCE_ONLY_NOT_BUILT_OR_EXECUTED',runtimeSha256:out.generatedRuntimeSha256,napiSha256:expected['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc'],heldRuntimeSha256:intermediate.generatedRuntimeSha256,ramRuntimeSeams:generatedRamArtifacts().runtime.edits.map(e=>e.label)};
 if(intermediate.preparedTree){out.actualPreparedHashes=expected;out.embedding={...intermediate.embedding,loaderAdmission:'distinct RAM source/profile/generated-artifact admission; old cold DSO is not admitted'};validateRamManifest(out);}
 return out;
}
export function prepareRamSource(argv,env=process.env){
 const {mode}=validatePreparationRequest(argv,env);authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-cold-bios.mjs',import.meta.url)),preparerParentSha256,'held cold preparer');
 const before=sourceIdentity(),a=generatedRamArtifacts(),intermediate=prepareColdSource(argv,env),result=finalizeRamPreparation(intermediate,before);
 if(mode==='--prepare'){
  const outputs={'bochs/cpu/bw_slice_runtime.inc':a.runtime.bytes,'bochs/owned-ram-provider.mjs':a.provider.bytes,'bochs/owned-ram-ROM.bin':a.rom};
  for(const [p,b]of Object.entries(outputs)){const path=resolve(result.preparedTree,p);assert.equal(realpathSync(dirname(path)),dirname(path));if(p.endsWith('bw_slice_runtime.inc'))regularBytes(path);else{let absent=false;try{lstatSync(path);}catch(e){if(e.code!=='ENOENT')throw e;absent=true;}assert.ok(absent,'new generated role only');}writeFileSync(path,b,{flag:p.endsWith('bw_slice_runtime.inc')?'w':'wx'});assert.equal(sha256(regularBytes(path)),result.actualPreparedHashes[p]);}
  for(const [p,h]of Object.entries(result.actualPreparedHashes))assert.equal(sha256(regularBytes(resolve(result.preparedTree,p))),h);
 }
 assert.deepEqual(sourceIdentity(),before,'complete source remains frozen');return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareRamSource(process.argv.slice(2)),null,2));
