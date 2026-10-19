/** Exact materializer derivative. Importing never creates or builds a tree. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {authenticated,replacement,sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
export const preparerParentSha256='a54809e4927c2ab461ad6f2fa13ab338c6d3e77ed81b603223c14c4dc71727cd';
export function deriveProtectedPreparer(bytes){
 let s=authenticated(bytes,preparerParentSha256,'held RAM materializer');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once("import {prepareColdSource,validatePreparationRequest} from './prepare-bochs-cpu3-native-cold-bios.mjs';","import {prepareRamSource as prepareHeldRamSource} from './prepare-bochs-cpu3-native-ram-bootstrap.mjs';\nimport {validatePreparationRequest} from './prepare-bochs-cpu3-native-cold-bios.mjs';",'held RAM materialization path');
 once("import {generatedRamArtifacts} from './bochs-cpu3-native-ram-bootstrap/preparation.mjs';","import {generatedProtectedArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-protected-ram/build-identity.mjs';",'new generated runtime/provider/ROM');
 once("import {ramBootstrapProfile} from './bochs-cpu3-native-ram-bootstrap/profile.mjs';","import {protectedRamProfile} from './bochs-cpu3-native-protected-ram/profile.mjs';",'new fixed profile');
 once("import {sourceIdentity,generatedHashes,regularBytes,validateRamManifest} from './bochs-cpu3-native-ram-bootstrap/build-identity.mjs';","import {sourceIdentity,generatedHashes,regularBytes,finalizeProtectedPreparation} from './bochs-cpu3-native-protected-ram/build-identity.mjs';",'complete protected admission');
 const a=s.indexOf('export function finalizeRamPreparation('),b=s.indexOf('export function prepareRamSource(',a);assert.ok(a>=0&&b>a);
 once(s.slice(a,b),'export const finalizeProtectedManifest=finalizeProtectedPreparation;\n','new final manifest provenance/profile');
 once('export function prepareRamSource(argv,env=process.env){','export function prepareProtectedRamSource(argv,env=process.env){','new closed materializer entry');
 const check="authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-cold-bios.mjs',import.meta.url)),preparerParentSha256,'held cold preparer');";
 once(check,`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url)),${JSON.stringify(preparerParentSha256)},'held RAM preparer');`,'authenticate invoked parent');
 once('intermediate=prepareColdSource(argv,env),result=finalizeRamPreparation(intermediate,before);','intermediate=prepareHeldRamSource(argv,env),result=finalizeProtectedPreparation(intermediate,before);','real RAM intermediate followed by protected profile');
 once("'bochs/owned-ram-provider.mjs':a.provider.bytes","'bochs/owned-protected-ram-provider.mjs':a.provider.bytes",'new provider output role');
 once("'bochs/owned-ram-ROM.bin':a.rom","'bochs/owned-protected-ram-ROM.bin':a.rom",'new ROM output role');
 once('console.log(JSON.stringify(prepareRamSource(process.argv.slice(2)),null,2));','console.log(JSON.stringify(prepareProtectedRamSource(process.argv.slice(2)),null,2));','new direct CLI');
 // The outer module is the sole CLI entry, so importing transformed definitions is inert.
 const cli="if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareProtectedRamSource(process.argv.slice(2)),null,2));";
 once(cli,'/* CLI is owned by the authenticated outer module. */','no data-URL CLI');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'protected preparer inverse '+e.label);assert.equal(sha256(inverse),preparerParentSha256);return {bytes:Buffer.from(s),edits};
}
const parent=new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url);
const source=deriveProtectedPreparer(readFileSync(parent)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`).replaceAll('import.meta.url',JSON.stringify(import.meta.url));
const materializer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {prepareProtectedRamSource,finalizeProtectedManifest}=materializer;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareProtectedRamSource(process.argv.slice(2)),null,2));
