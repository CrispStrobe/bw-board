/** Produce two exact cold configurations from the qualified source profile. */
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

const [sourceRoot,output]=process.argv.slice(2);
assert.equal(process.argv.length,4);
for(const path of [sourceRoot,output])assert.ok(isAbsolute(path)&&resolve(path)===path);
const {canonicalConfiguration,authenticateConfiguration}=await import(pathToFileURL(resolve(
 sourceRoot,'scripts/bochs-cpu3-native-cold-memory-fusion/identity.mjs')).href);
const result={};
for(const mode of ['direct','companion']){
 const path=resolve(output,mode+'.conf');
 writeFileSync(path,canonicalConfiguration(resolve(output,mode+'.bochs.log')),{flag:'wx'});
 result[mode]={path,sha256:authenticateConfiguration(path).sha256};
}
console.log(JSON.stringify(result));
