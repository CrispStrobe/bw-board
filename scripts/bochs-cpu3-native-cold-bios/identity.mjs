/** Read/hash admission only. Trusted frozen filesystem; no addon require or build. */
import assert from 'node:assert/strict';
import {readFileSync,lstatSync,realpathSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ownedAssets as inheritedAssets} from '../bochs-cpu3-native-owned-in8/identity.mjs';
import {deriveColdBiosRuntime,coldNativeProfile} from './runtime.mjs';
import {deriveColdBiosNapi} from './napi.mjs';
import {revision as bochsRevision,upstreamHashes,patchPinnedSource} from '../bochs-cpu3-native-direct-board/patch.mjs';
import {hotNativeProfile} from '../bochs-cpu3-native-hot-direct/profile.mjs';
import {sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url)));
export const buildReceiptSchema='bw.native-cold-bios-build-receipt.v1';
export const requiredFeatures=Object.freeze({BX_CPU_LEVEL:3,BX_SUPPORT_SMP:0,BX_DEBUGGER:0,BX_USE_IDLE_HACK:0,BX_SUPPORT_REPEAT_SPEEDUPS:0,BX_SUPPORT_HANDLERS_CHAINING_SPEEDUPS:0,BX_SUPPORT_FPU:1,BX_PLUGINS:0});
export const requiredExports=Object.freeze(['bw_direct_initialize','bw_direct_resume','bw_direct_set_irq_line','bw_direct_inspect','bw_direct_close','napi_register_module_v1']);
export const ownedAssets=Object.freeze(inheritedAssets.concat(['runtime.mjs','napi.mjs','fetch-policy.mjs','runtime-rep.mjs','rep-policy.mjs','board-profile.mjs','board-provider.mjs','identity.mjs','README.md','NATIVE-SOURCE-PREPARATION.md'].map(p=>'scripts/bochs-cpu3-native-cold-bios/'+p),['scripts/prepare-bochs-cpu3-native-cold-bios.mjs','test/i80386-cold-bios-preparation-source.test.mjs','test/i80386-cold-bios-runtime-source.test.mjs','test/i80386-cold-bios-rep-source.test.mjs','test/i80386-cold-bios-board-source.test.mjs','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin']));
const git=(args,encoding='utf8')=>execFileSync('git',args,{cwd:root,encoding,maxBuffer:32<<20});
export function regularBytes(path,max=16<<20){
 assert.equal(typeof path,'string');assert.ok(isAbsolute(path)&&resolve(path)===path,'canonical absolute file role');
 assert.equal(realpathSync(path),path,'no symlink path components');const st=lstatSync(path);assert.ok(st.isFile()&&!st.isSymbolicLink()&&st.size<=max,'bounded ordinary file');const b=readFileSync(path);assert.equal(b.length,st.size,'stable frozen file size');return b;
}
export function boundedJson(path,digest){assert.equal(typeof digest,'string');assert.match(digest,/^[a-f0-9]{64}$/);const b=regularBytes(path);assert.equal(sha256(b),digest,'authenticated JSON');return JSON.parse(b);}
export function authenticateEnvironment(env=process.env){for(const k of ['NODE_OPTIONS','NODE_PATH','LD_PRELOAD','LD_AUDIT','BW_HOT_NAPI_PROFILE','NODE_V8_COVERAGE'])assert.ok(!env[k],'no executable hook '+k);}
export function sourceIdentity(){
 authenticateEnvironment();
 assert.equal(git(['status','--porcelain']).trim(),'','frozen clean source');const revision=git(['rev-parse','HEAD']).trim(),paths=new Set();
 function visit(p){assert.ok(!p.startsWith('../')&&!isAbsolute(p),'repository-relative source');if(paths.has(p))return;paths.add(p);const b=regularBytes(resolve(root,p));assert.equal(sha256(b),sha256(git(['show',revision+':'+p],null)),'current/Git '+p);
 if(/\.(mjs|js)$/.test(p))for(const m of b.toString().matchAll(/(?:from\s+|import\s*)['"](\.[^'"]+)['"]/g)){const q=resolve(root,dirname(p),m[1]);assert.ok(q.startsWith(root+'/'));visit(q.slice(root.length+1));}}
 for(const p of ownedAssets)visit(p);return {revision,hashes:Object.fromEntries([...paths].sort().map(p=>[p,sha256(regularBytes(resolve(root,p)))]))};
}
export function generatedHashes(){
 const runtime=deriveColdBiosRuntime(),napi=deriveColdBiosNapi(),abi=regularBytes(resolve(root,'scripts/bochs-cpu3-native-owned-in8/abi.h'));
 return {'bochs/cpu/bw_slice_runtime.inc':sha256(runtime.bytes),'bochs/cpu/bw_slice_abi.h':sha256(abi),'bochs/bochs-cpu3-native-direct-board/abi.h':sha256(abi),'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc':sha256(napi.bytes)};
}
export function validateBuildMetadata(input,source,manifest,receipt){
 assert.equal(manifest.boardRevision,source.revision);assert.deepEqual(manifest.sourceHashes,source.hashes,'complete cold source closure');
 assert.deepEqual(manifest.coldProfile,coldNativeProfile,'exact BIOS/ports/caps/checkpoint profile');assert.deepEqual(manifest.profile,coldNativeProfile);
 assert.deepEqual(receipt.coldProfile,coldNativeProfile);assert.equal(manifest.ownedClock.abiVersion,4);
 const expected=generatedHashes();assert.deepEqual(manifest.actualPreparedHashes,expected);assert.equal(manifest.generatedRuntimeSha256,expected['bochs/cpu/bw_slice_runtime.inc']);
 assert.equal(manifest.ownedClock.runtimeSha256,expected['bochs/cpu/bw_slice_runtime.inc']);assert.equal(manifest.ownedClock.napiSha256,expected['bochs/bochs-cpu3-native-direct-board-adapter/napi.cc']);assert.equal(manifest.ownedClock.abiSha256,expected['bochs/cpu/bw_slice_abi.h']);
 assert.equal(receipt.schema,buildReceiptSchema,'old ABI4 build receipts are not cold builds');assert.equal(receipt.status,'BUILD_AND_STATIC_PREFLIGHT_PASS_NO_ADDON_LOAD_OR_GUEST');
 assert.equal(receipt.sourceRevision,source.revision);assert.deepEqual(receipt.sourceHashes,source.hashes);assert.deepEqual(receipt.preparedHashes,expected);
 assert.equal(receipt.preparedTree,manifest.preparedTree);assert.equal(receipt.preparedManifestPath,input.preparedManifest);assert.equal(receipt.preparedManifestSha256,input.preparedManifestSha256);
 assert.equal(input.addon,resolve(manifest.preparedTree,'bochs/bw_direct.node'),'fixed addon role');assert.equal(receipt.addonPath,input.addon);assert.equal(receipt.addonSha256,input.sha256);
 assert.deepEqual(receipt.requiredFeatures,requiredFeatures);assert.deepEqual(receipt.requiredExports,requiredExports);assert.equal(manifest.bochsRevision,'0e45b736ef9792eb9b752b0a35db49eaf2faea47');
 assert.ok(manifest.originalH4Provenance&&manifest.originalH4Profile,'historical intermediate provenance retained');
 assert.deepEqual(manifest.originalH4Profile,hotNativeProfile);assert.deepEqual(manifest.originalH4Provenance.profile,hotNativeProfile);
 assert.equal(manifest.originalH4Provenance.generatedRuntimeSha256,'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a');
 assert.deepEqual(manifest.upstreamHashes,upstreamHashes);assert.deepEqual(manifest.originalH4Provenance.upstreamHashes,upstreamHashes);
 assert.deepEqual(Object.keys(manifest.patchedHashes).sort(),Object.keys(upstreamHashes).sort(),'all patched CPU roles required');
 assert.deepEqual(manifest.originalH4Provenance.patchedHashes,manifest.patchedHashes);
 for(const [p,h]of Object.entries(manifest.originalH4Provenance.sourceHashes))assert.equal(source.hashes[p],h);
 return expected;
}
export function validateBuildContext(context,receipt,manifest){
 assert.equal(context.schema,'bw.native-cold-bios-build-context.v1');assert.equal(context.sourceRevision,receipt.sourceRevision);assert.deepEqual(context.sourceHashes,receipt.sourceHashes);
 assert.equal(context.bochsRevision,manifest.bochsRevision);assert.equal(context.preparedManifestSha256,receipt.preparedManifestSha256);assert.deepEqual(context.preparedHashes,receipt.preparedHashes);assert.equal(context.configSha256,receipt.configSha256);
 assert.deepEqual(context.configure,manifest.configure);assert.deepEqual(context.build,manifest.build);assert.equal(context.nodeVersion,'v22.23.3');
 for(const k of ['compilerVersion','platform','architecture'])assert.ok(typeof context[k]==='string'&&context[k].length>0&&context[k].length<=4096);
 assert.equal(context.addonLoaded,false,'static build context only');
}
export function authenticateBuild(input,source){
 authenticateEnvironment();
 assert.equal(git(['rev-parse','HEAD']).trim(),source.revision);assert.equal(git(['status','--porcelain']).trim(),'','clean admission source');
 const manifest=boundedJson(input.preparedManifest,input.preparedManifestSha256),receipt=boundedJson(input.buildReceipt,input.buildReceiptSha256);
 const expected=validateBuildMetadata(input,source,manifest,receipt);
 const context=boundedJson(receipt.contextPath,receipt.contextSha256);validateBuildContext(context,receipt,manifest);assert.match(input.sha256,/^[a-f0-9]{64}$/);assert.match(receipt.configSha256,/^[a-f0-9]{64}$/);
 assert.equal(realpathSync(manifest.preparedTree),manifest.preparedTree,'ordinary canonical prepared tree');assert.ok(lstatSync(manifest.preparedTree).isDirectory());
 for(const [p,h]of Object.entries(source.hashes)){assert.equal(sha256(regularBytes(resolve(root,p))),h);assert.equal(sha256(git(['show',source.revision+':'+p],null)),h);}
 assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:manifest.preparedTree,encoding:'utf8'}).trim(),bochsRevision,'prepared upstream HEAD');
 for(const [p,h]of Object.entries(manifest.patchedHashes)){
 const original=execFileSync('git',['show',bochsRevision+':'+p],{cwd:manifest.preparedTree,maxBuffer:8<<20});assert.equal(sha256(original),upstreamHashes[p]);assert.equal(sha256(patchPinnedSource(p,original)),h,'actual CPU transformation');assert.ok(p.startsWith('bochs/')&&!p.includes('..'),'patched relative role');assert.equal(sha256(regularBytes(resolve(manifest.preparedTree,p))),h);}
 for(const [p,h]of Object.entries(expected))assert.equal(sha256(regularBytes(resolve(manifest.preparedTree,p))),h);
 for(const [src,dst]of [['scripts/bochs-cpu3-native-direct-board/runtime.h','bochs/cpu/bw_slice_runtime.h'],['scripts/bochs-cpu3-native-direct-board/addon.mk','bochs/bw_direct_addon.mk']])assert.equal(sha256(regularBytes(resolve(manifest.preparedTree,dst))),source.hashes[src]);
 const config=regularBytes(resolve(manifest.preparedTree,'bochs/config.h'));assert.equal(sha256(config),receipt.configSha256);
 for(const [name,value]of Object.entries(requiredFeatures)){const m=[...config.toString().matchAll(new RegExp('^#define\\s+'+name+'\\s+(\\d+)\\s*$','gm'))];assert.equal(m.length,1);assert.equal(Number(m[0][1]),value);}
 assert.equal(sha256(regularBytes(input.addon,8<<20)),input.sha256);
 assert.equal(git(['rev-parse','HEAD']).trim(),source.revision);assert.equal(git(['status','--porcelain']).trim(),'','source still clean after admission');
 return {schema:buildReceiptSchema,sourceRevision:source.revision,preparedManifestSha256:input.preparedManifestSha256,buildReceiptSha256:input.buildReceiptSha256,configSha256:receipt.configSha256,preparedHashes:expected,addonSha256:input.sha256,contextSha256:receipt.contextSha256};
}
export function canonicalConfiguration(logPath='/tmp/cold-bios-bochs.log'){
 assert.equal(typeof logPath,'string');assert.ok(isAbsolute(logPath)&&resolve(logPath)===logPath&&logPath.length<=4096&&!/[\s,\0]/.test(logPath));
 return ['display_library: nogui','memory: guest=16, host=16',`romimage: file=${resolve(root,'roms/free-at-bios/BIOS-bochs-legacy')}`,`vgaromimage: file=${resolve(root,'roms/free-at-bios/vgabios-lgpl.bin')}`,'cpu: count=1, ips=10000000','clock: sync=none, time0=946684800','boot: disk','port_e9_hack: enabled=1',`log: ${logPath}`,'panic: action=fatal','error: action=report','info: action=report','debug: action=ignore','mouse: enabled=0',''].join('\n');
}
export function authenticateConfiguration(path){
 authenticateEnvironment();
 const b=regularBytes(path,16384),text=b.toString(),logs=[...text.matchAll(/^log: (.+)$/gm)];assert.equal(logs.length,1);assert.equal(text,canonicalConfiguration(logs[0][1]),'exact source config semantics');
 const revision=git(['rev-parse','HEAD']).trim();for(const [p,h]of [['BIOS-bochs-legacy',coldNativeProfile.romSha256],['vgabios-lgpl.bin','76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1']]){const rel='roms/free-at-bios/'+p;assert.equal(sha256(regularBytes(resolve(root,rel),1<<20)),h);assert.equal(sha256(git(['show',revision+':'+rel],null)),h);}
 return {sha256:sha256(b),biosSha256:coldNativeProfile.romSha256,text};
}
