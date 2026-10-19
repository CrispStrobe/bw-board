/** Separate H5 preparer: authenticated H4, conditional scalar arguments only. */
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {derivePackedArgsNapi,h4GeneratedNapiSha256} from './bochs-cpu3-native-hot-packed-args/napi.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),sha=b=>createHash('sha256').update(b).digest('hex');
const [mode,target,...extra]=process.argv.slice(2);
if(extra.length||!['--check','--prepare'].includes(mode)||(mode==='--check'&&target)||(mode==='--prepare'&&!target))throw Error('usage: --check | --prepare /new/tree');
const original='scripts/prepare-bochs-cpu3-native-hot-packed-scalar.mjs';
if(sha(readFileSync(resolve(root,original)))!=='190e3cf4a8009962d43e7ae9b37ba5d954723e3c3b237900b2e8e99fa41f308c')throw Error('original hot preparer source changed');
const owned=['scripts/prepare-bochs-cpu3-native-hot-packed-args.mjs','scripts/bochs-cpu3-native-hot-packed-args/napi.mjs','scripts/bochs-cpu3-native-hot-packed-args/wire-contract.md','scripts/run-i80386-native-hot-packed-args.mjs','test/i80386-native-hot-packed-args.test.mjs'];
const revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
for(const path of owned){const current=readFileSync(resolve(root,path)),committed=execFileSync('git',['show',revision+':'+path],{cwd:root});if(sha(current)!==sha(committed))throw Error('packed scalar owned input differs from HEAD: '+path);}
const generated=derivePackedArgsNapi();
const result=JSON.parse(execFileSync(process.execPath,[resolve(root,original),mode,...(target?[target]:[])],{cwd:root,env:process.env,maxBuffer:16<<20,encoding:'utf8'}));
result.h4SourceHashes={...result.sourceHashes};
result.sourceHashes={...result.sourceHashes,...Object.fromEntries(owned.map(path=>[path,sha(readFileSync(resolve(root,path)))]))};
result.packedArgs={schema:'bw.hot-packed-args-derivative.v1',h4GeneratedNapiSha256,generatedNapiSha256:sha(generated),compiledReplacementOnly:'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc',runtimeUnchanged:true,abiVersion:2,status:'SOURCE_DERIVED_NOT_COMPILED_OR_EXECUTED'};
if(mode==='--prepare'){
 const copied=resolve(result.preparedTree,result.packedArgs.compiledReplacementOnly);
 if(sha(readFileSync(copied))!==h4GeneratedNapiSha256)throw Error('prepared original NAPI bytes differ before replacement');
 writeFileSync(copied,generated);if(sha(readFileSync(copied))!==result.packedArgs.generatedNapiSha256)throw Error('generated copied NAPI differs');
}
console.log(JSON.stringify(result,null,2));
