/** Separate H4 preparer: original hot runtime, packed NAPI replacement only. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {derivePackedScalarNapi,originalNapiSha256} from './bochs-cpu3-native-hot-packed-scalar/napi.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const [mode,target,...extra]=process.argv.slice(2);
if(extra.length||!['--check','--prepare'].includes(mode)||(mode==='--check'&&target)||(mode==='--prepare'&&!target))throw Error('usage: --check | --prepare /new/tree');
const original='scripts/prepare-bochs-cpu3-native-hot-direct.mjs';
if(sha(readFileSync(resolve(root,original)))!=='6942a881c72151ad075cd757fe4ec39bef793675defebb250f41395dd05c24bb')throw Error('original hot preparer source changed');
const owned=['scripts/prepare-bochs-cpu3-native-hot-packed-scalar.mjs','scripts/bochs-cpu3-native-hot-packed-scalar/napi.mjs','scripts/bochs-cpu3-native-hot-packed-scalar/packed-scalar.mjs','scripts/bochs-cpu3-native-hot-packed-scalar/loader.mjs','scripts/bochs-cpu3-native-hot-packed-scalar/wire-contract.md','scripts/run-i80386-native-hot-packed-scalar.mjs','test/i80386-native-hot-packed-scalar.test.mjs'];
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
for(const path of owned){const current=readFileSync(resolve(root,path)),committed=execFileSync('git',['show',revision+':'+path],{cwd:root});if(sha(current)!==sha(committed))throw Error('packed scalar owned input differs from HEAD: '+path);}
const generated=derivePackedScalarNapi();
const result=JSON.parse(execFileSync(process.execPath,[resolve(root,original),mode,...(target?[target]:[])],{cwd:root,env:process.env,maxBuffer:16<<20,encoding:'utf8'}));
result.originalHotSourceHashes={...result.sourceHashes};
result.sourceHashes={...result.sourceHashes,...Object.fromEntries(owned.map(path=>[path,sha(readFileSync(resolve(root,path)))]))};
result.packedScalar={schema:'bw.hot-packed-scalar-derivative.v1',originalNapiSha256,generatedNapiSha256:sha(generated),compiledReplacementOnly:'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc',runtimeUnchanged:true,abiVersion:2,status:'SOURCE_DERIVED_NOT_COMPILED_OR_EXECUTED'};
if(mode==='--prepare'){
 const copied=resolve(result.preparedTree,result.packedScalar.compiledReplacementOnly);
 if(sha(readFileSync(copied))!==originalNapiSha256)throw Error('prepared original NAPI bytes differ before replacement');
 writeFileSync(copied,generated);if(sha(readFileSync(copied))!==result.packedScalar.generatedNapiSha256)throw Error('generated copied NAPI differs');
}
console.log(JSON.stringify(result,null,2));
