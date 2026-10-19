import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateBuildMetadata,validateBuildContext,buildReceiptSchema,requiredExports} from '../scripts/bochs-cpu3-native-compact-progress/identity.mjs';
import {PROGRESS_PROFILE} from '../scripts/bochs-cpu3-native-compact-progress/napi.mjs';
const root=new URL('../',import.meta.url);
test('old fusion metadata is denied before artifact roles',()=>{
 assert.equal(buildReceiptSchema,'bw.native-cold-compact-progress-build-receipt.v1');
 assert.throws(()=>validateBuildMetadata({}, {}, {memoryFusionProfile:'bw.cold-native.memory-clock-fusion.v1'}, {}));
 assert.throws(()=>validateBuildContext({memoryFusionProfile:'bw.cold-native.memory-clock-fusion.v1'},{},{}));
 assert.deepEqual(requiredExports,['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1','bw_memory_fusion']);
});
test('compact context is mandatory in actual context validator',()=>{
 const r={sourceRevision:'a'.repeat(40),sourceHashes:{x:'b'.repeat(64)},preparedManifestSha256:'c'.repeat(64),preparedHashes:{y:'d'.repeat(64)},configSha256:'e'.repeat(64)};
 const m={bochsRevision:'f'.repeat(40),configure:['held'],build:['held']};
 const c={progressExportProfile:PROGRESS_PROFILE,memoryFusionProfile:'bw.cold-native.memory-clock-fusion.v1',stateExportProfile:'bw.cold-native.copied-u32-state.v1',schema:'bw.native-cold-compact-progress-build-context.v1',sourceRevision:r.sourceRevision,sourceHashes:r.sourceHashes,bochsRevision:m.bochsRevision,preparedManifestSha256:r.preparedManifestSha256,preparedHashes:r.preparedHashes,configSha256:r.configSha256,configure:m.configure,build:m.build,nodeVersion:'v22.23.3',compilerVersion:'fixture',platform:'fixture',architecture:'fixture',addonLoaded:false};
 validateBuildContext(c,r,m);for(const key of ['progressExportProfile','schema'])assert.throws(()=>validateBuildContext({...c,[key]:'wrong'},r,m));assert.throws(()=>validateBuildContext({...c,addonLoaded:true},r,m));
});
test('disabled static build wires compact preparer without addon execution',()=>{
 const workflow=readFileSync(new URL('.github/workflows/i80386-native-compact-progress-build.yml',root),'utf8');assert.match(workflow,/default: false/);assert.match(workflow,/inputs.enable_build == true/);assert.match(workflow,/ci-build-i80386-native-compact-progress.py/);
 const helper=readFileSync(new URL('scripts/ci-build-i80386-native-compact-progress.py',root),'utf8');assert.match(helper,/prepare-bochs-cpu3-native-compact-progress.mjs/);assert.match(helper,/M\['progressExportProfile'\]=='bw.cold-native.compact-progress.v1'/);assert.doesNotMatch(helper,/require\(|enable_guest|\.resume\(/);
 const prep=readFileSync(new URL('scripts/prepare-bochs-cpu3-native-compact-progress.mjs',root),'utf8');assert.match(prep,/deriveMemoryFusionRuntime/);assert.match(prep,/deriveCompactProgressNapi/);assert.match(prep,/out.progressExportProfile=PROGRESS_PROFILE/);
});
