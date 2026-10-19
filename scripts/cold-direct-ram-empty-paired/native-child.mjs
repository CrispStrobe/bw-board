/** Reuse the qualified paired native guest loop with only its provider loader varied. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const sha=b=>createHash('sha256').update(b).digest('hex');
export const heldSha256='f9e78c9f8adb510fda66bec1dde666233477600dabea57e0018a16f9050d25db';
const held=new URL('../cold-direct-ram-paired/native.mjs',import.meta.url);
const provider=new URL('./provider.mjs',import.meta.url);
const edits=[
 ["import {loadDirectTimingProvider} from './direct-provider.mjs';",
  "import {load} from 'bw:direct-provider';"],
 ["assert.ok(input.mode==='direct'||input.mode==='companion');",
  "assert.equal(input.mode,'direct');assert.ok(input.providerVariant==='baseline'||input.providerVariant==='candidate');"],
 ['const require=createRequire(import.meta.url),addon=require(input.addon);',
  "const require=createRequire(resolve(input.sourceRoot,'package.json')),addon=require(input.addon);"],
 ['const derived=await loadDirectTimingProvider(input.sourceRoot);',
  'const derived=await load(input.sourceRoot,input.providerVariant);']
];
const footer="if(process.argv[1]&&resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))){\n assert.equal(process.argv.length,3);await runNative(JSON.parse(readFileSync(process.argv[2],'utf8')));\n}\n";
function exact(s,before,after){assert.equal(s.split(before).length,2,'exact native child seam');return s.replace(before,after);}
export function deriveNativeChild(){
 const original=readFileSync(held);assert.equal(sha(original),heldSha256,'held native child bytes');
 let modified=original.toString();for(const [before,after] of edits)modified=exact(modified,before,after);
 assert.ok(modified.endsWith(footer),'held direct child main footer');modified=modified.slice(0,-footer.length);
 let restored=modified+footer;for(const [before,after] of [...edits].reverse())restored=exact(restored,after,before);
 assert.equal(sha(Buffer.from(restored)),heldSha256,'native child inverse');
 const loaded=exact(modified,"'bw:direct-provider'",`'${provider.href}'`);
 assert.equal(exact(loaded,`'${provider.href}'`,"'bw:direct-provider'"),modified,'loaded URL inverse');
 return Object.freeze({heldSha256,normalizedSha256:sha(Buffer.from(modified)),
  loadedSha256:sha(Buffer.from(loaded)),moduleUrl:'data:text/javascript;base64,'+Buffer.from(loaded).toString('base64')});
}
export async function runVariant(input){
 const derived=deriveNativeChild(),module=await import(derived.moduleUrl);
 assert.equal(typeof module.runNative,'function');
 return module.runNative(input);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(new URL(import.meta.url).pathname)){
 assert.equal(process.argv.length,3);
 const input=JSON.parse(readFileSync(process.argv[2],'utf8'));
 await runVariant(input);
}
