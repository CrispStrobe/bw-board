// Materialize only the small generated N-API control translation unit and headers.
import {readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {deriveDirectRamNapi} from './napi.mjs';
const output=resolve(process.argv[2]??'build/direct-ram-control');
const source=resolve('scripts');
for(const name of ['bochs-cpu3-native-direct-board-adapter','bochs-cpu3-native-direct-board',
 'bochs-cpu3-native-cold-direct-ram','bochs-cpu3-native-cold-owned-ram'])mkdirSync(join(output,name),{recursive:true});
const abi=readFileSync(join(source,'bochs-cpu3-native-owned-in8/abi.h'),'utf8');
if(!abi.includes('#define BW_DIRECT_ABI_VERSION 4'))throw Error('held ABI4 source mismatch');
writeFileSync(join(output,'bochs-cpu3-native-direct-board/abi.h'),abi.replace('#define BW_DIRECT_ABI_VERSION 4','#define BW_DIRECT_ABI_VERSION 5'));
for(const name of ['abi.h','bridge.h','napi-control-stub.cc'])copyFileSync(join(source,'bochs-cpu3-native-cold-direct-ram',name),join(output,'bochs-cpu3-native-cold-direct-ram',name));
copyFileSync(join(source,'bochs-cpu3-native-cold-owned-ram/owned-ram.h'),join(output,'bochs-cpu3-native-cold-owned-ram/owned-ram.h'));
writeFileSync(join(output,'bochs-cpu3-native-direct-board-adapter/napi.cc'),deriveDirectRamNapi().bytes);
console.log('direct-RAM bounded N-API control source materialized');
