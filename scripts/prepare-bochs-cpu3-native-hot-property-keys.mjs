/** Separate H3 preparer: authenticated H2 derivation, copied NAPI replacement only. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {derivePropertyKeyNapi,h2GeneratedNapiSha256} from './bochs-cpu3-native-hot-property-keys/napi.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const [mode,target,...extra]=process.argv.slice(2);
if(extra.length||!['--check','--prepare'].includes(mode)||(mode==='--check'&&target)||(mode==='--prepare'&&!target))throw Error('usage: --check | --prepare /new/tree');
const original='scripts/prepare-bochs-cpu3-native-hot-napi-profile.mjs';
if(sha(readFileSync(resolve(root,original)))!=='f27bc7eaf205a9a0babb8baf7ee7e68c53a98fece0c0cb88d12bb83d40f3d373')throw Error('original hot preparer source changed');
const owned=['scripts/prepare-bochs-cpu3-native-hot-property-keys.mjs','scripts/bochs-cpu3-native-hot-property-keys/napi.mjs','scripts/bochs-cpu3-native-hot-property-keys/wire-contract.md','test/i80386-native-hot-property-keys.test.mjs'];
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
for(const path of owned){const current=readFileSync(resolve(root,path)),committed=execFileSync('git',['show',revision+':'+path],{cwd:root});if(sha(current)!==sha(committed))throw Error('profiler owned input differs from HEAD: '+path);}
const generated=derivePropertyKeyNapi();
const result=JSON.parse(execFileSync(process.execPath,[resolve(root,original),mode,...(target?[target]:[])],{cwd:root,env:process.env,maxBuffer:16<<20,encoding:'utf8'}));
result.h2SourceHashes={...result.sourceHashes};
result.sourceHashes={...result.sourceHashes,...Object.fromEntries(owned.map(path=>[path,sha(readFileSync(resolve(root,path)))]))};
result.propertyKeys={schema:'bw.hot-property-key-derivative.v1',originalH2GeneratedNapiSha256:h2GeneratedNapiSha256,generatedNapiSha256:sha(generated),compiledReplacementOnly:'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc',runtimeUnchanged:true,abiVersion:2,status:'SOURCE_DERIVED_NOT_COMPILED_OR_EXECUTED'};
if(mode==='--prepare'){
 const copied=resolve(result.preparedTree,result.propertyKeys.compiledReplacementOnly);
 if(sha(readFileSync(copied))!==h2GeneratedNapiSha256)throw Error('prepared original NAPI bytes differ before replacement');
 writeFileSync(copied,generated);if(sha(readFileSync(copied))!==result.propertyKeys.generatedNapiSha256)throw Error('generated copied NAPI differs');
}
console.log(JSON.stringify(result,null,2));
