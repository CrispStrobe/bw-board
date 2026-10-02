/** Frozen source/build provenance admission; does not build or run anything. */
import assert from 'node:assert/strict';
import {readFileSync,statSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {deriveOwnedRuntime} from './runtime.mjs';
import {deriveOwnedNapi} from './napi.mjs';
import {sha256} from './derive.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const ownedAssets=['abi.h','clock.inc','derive.mjs','runtime.mjs','napi.mjs','provider.mjs','loader.mjs','factory.mjs','worker.mjs','identity.mjs','contract.md'].map(p=>'scripts/bochs-cpu3-native-owned-clock/'+p).concat(['scripts/run-i80386-native-owned-clock.mjs','scripts/prepare-bochs-cpu3-native-owned-clock.mjs','test/i80386-native-owned-clock.test.mjs','test/i80386-native-owned-clock-c-harness.test.mjs','test/fixtures/i80386-owned-clock-harness.cc','scripts/bochs-cpu3-native-direct-board/runtime.inc','scripts/bochs-cpu3-native-direct-board/runtime.h','scripts/bochs-cpu3-native-direct-board/addon.mk','scripts/prepare-bochs-cpu3-native-hot-direct.mjs','scripts/prepare-bochs-cpu3-native-direct-board.mjs','test/i80386-native-direct-board.test.mjs','test/i80386-native-hot-direct.test.mjs','test/fixtures/i80386-free-combined-paging-ram.S','scripts/bochs-cpu3-native-direct-board/abi.h','scripts/bochs-cpu3-native-direct-board-adapter/napi.cc','test/fixtures/i80386-free-combined-hot.S','package.json']);
export function sourceIdentity(){
 const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',maxBuffer:32<<20}).trim();assert.equal(git(['status','--porcelain']),'','frozen clean source');const revision=git(['rev-parse','HEAD']),paths=new Set();
 function visit(p){if(paths.has(p))return;paths.add(p);const b=readFileSync(resolve(root,p));assert.equal(sha256(b),sha256(execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:32<<20})),p);if(/\.(mjs|js)$/.test(p))for(const m of b.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g))visit(resolve(root,dirname(p),m[1]).slice(root.length+1));}
 for(const p of ownedAssets)visit(p);return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha256(readFileSync(resolve(root,p)))]))};
}
export function boundedJson(path,expectedSha){assert.equal(typeof path,'string');assert.match(expectedSha,/^[a-f0-9]{64}$/);const st=statSync(path);assert.ok(st.isFile()&&st.size<=16*1024*1024);const b=readFileSync(path);assert.equal(sha256(b),expectedSha);return JSON.parse(b);}
export function authenticateBuild(input,source){
 const manifest=boundedJson(input.preparedManifest,input.preparedManifestSha256),receipt=boundedJson(input.buildReceipt,input.buildReceiptSha256);
 assert.equal(manifest.boardRevision,source.revision);assert.equal(manifest.ownedClock.abiVersion,3);
 for(const [p,h] of Object.entries(source.hashes))assert.equal(manifest.sourceHashes[p],h,'prepared source binding '+p);
 for(const [p,h] of Object.entries(manifest.sourceHashes)){assert.equal(sha256(readFileSync(resolve(root,p))),h,'all manifest current inputs '+p);assert.equal(sha256(execFileSync('git',['show',source.revision+':'+p],{cwd:root,maxBuffer:32<<20})),h,'all manifest git inputs '+p);}
 assert.equal(manifest.ownedClock.abiSha256,sha256(readFileSync(new URL('./abi.h',import.meta.url))));
 assert.equal(manifest.ownedClock.runtimeSha256,sha256(deriveOwnedRuntime().bytes));assert.equal(manifest.ownedClock.napiSha256,sha256(deriveOwnedNapi().bytes));
 const expected={'bochs/cpu/bw_slice_runtime.inc':manifest.ownedClock.runtimeSha256,'bochs/cpu/bw_slice_abi.h':manifest.ownedClock.abiSha256,'bochs/bochs-cpu3-native-direct-board/abi.h':manifest.ownedClock.abiSha256,'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc':manifest.ownedClock.napiSha256};
 for(const [p,h] of Object.entries(manifest.patchedHashes))assert.equal(sha256(readFileSync(resolve(manifest.preparedTree,p))),h,'actual patched CPU '+p);
 for(const [src,dst] of [['scripts/bochs-cpu3-native-direct-board/runtime.h','bochs/cpu/bw_slice_runtime.h'],['scripts/bochs-cpu3-native-direct-board/addon.mk','bochs/bw_direct_addon.mk']])assert.equal(sha256(readFileSync(resolve(manifest.preparedTree,dst))),source.hashes[src],'actual unchanged copied '+dst);
 assert.deepEqual(manifest.actualPreparedHashes,expected);for(const [p,h] of Object.entries(expected))assert.equal(sha256(readFileSync(resolve(manifest.preparedTree,p))),h,'actual prepared '+p);
 assert.equal(receipt.schema,'bw.owned-clock-build-receipt.v1');assert.equal(receipt.status,'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST');assert.equal(receipt.preparedTree,manifest.preparedTree);assert.equal(receipt.preparedManifestPath,input.preparedManifest);
 const requiredFeatures={BX_CPU_LEVEL:3,BX_SUPPORT_SMP:0,BX_DEBUGGER:0,BX_USE_IDLE_HACK:0,BX_SUPPORT_REPEAT_SPEEDUPS:0,BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS:0,BX_SUPPORT_FPU:1,BX_PLUGINS:0};
 const config=readFileSync(resolve(manifest.preparedTree,'bochs/config.h'),'utf8');for(const [name,value] of Object.entries(requiredFeatures)){const m=[...config.matchAll(new RegExp('^#define\\s+'+name+'\\s+(\\d+)\\s*$','gm'))];assert.equal(m.length,1,'one actual config macro '+name);assert.equal(Number(m[0][1]),value,'actual config feature '+name);}
 assert.deepEqual(receipt.requiredFeatures,requiredFeatures);assert.deepEqual(receipt.requiredExports,['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']);assert.equal(receipt.preparedManifestSha256,input.preparedManifestSha256);assert.equal(receipt.sourceRevision,source.revision);assert.deepEqual(receipt.sourceHashes,source.hashes);assert.deepEqual(receipt.preparedHashes,expected);assert.equal(receipt.addonSha256,input.sha256);assert.equal(receipt.addonPath,input.addon);assert.equal(sha256(readFileSync(input.addon)),input.sha256);assert.equal(sha256(readFileSync(resolve(manifest.preparedTree,'bochs/config.h'))),receipt.configSha256);
 return {preparedManifestSha256:input.preparedManifestSha256,buildReceiptSha256:input.buildReceiptSha256,configSha256:receipt.configSha256,preparedHashes:expected};
}
