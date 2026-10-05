/** Exact new materializer definitions. Importing never prepares or builds a tree. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {authenticated,replacement,sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveProtectedPreparer} from './prepare-bochs-cpu3-native-protected-ram.mjs';
export const preparerParentSha256='a54809e4927c2ab461ad6f2fa13ab338c6d3e77ed81b603223c14c4dc71727cd';
export const preparerModuleSha256='2989ddcc148a8c0df3c4f4eabf956bd813a2df4a8413ad249d33cd044d6097a4';
export function deriveStackPreparer(bytes){authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-protected-ram.mjs',import.meta.url)),preparerModuleSha256,'held protected materializer module');authenticated(bytes,preparerParentSha256,'held input materializer');const held=deriveProtectedPreparer(bytes),baseSha256=sha256(held.bytes);let s=held.bytes.toString();const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once("import {prepareRamSource as prepareHeldRamSource} from './prepare-bochs-cpu3-native-ram-bootstrap.mjs';","import {prepareProtectedRamSource as prepareHeldProtectedSource} from './prepare-bochs-cpu3-native-protected-ram.mjs';",'held protected materialization stage');
 once("import {generatedProtectedArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-protected-ram/build-identity.mjs';","import {generatedStackArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-protected-stack/build-identity.mjs';",'new generated stack artifacts');
 once("import {protectedRamProfile} from './bochs-cpu3-native-protected-ram/profile.mjs';","import {protectedStackProfile} from './bochs-cpu3-native-protected-stack/profile.mjs';",'new fixed stack profile');
 once("import {sourceIdentity,generatedHashes,regularBytes,finalizeProtectedPreparation} from './bochs-cpu3-native-protected-ram/build-identity.mjs';","import {sourceIdentity,generatedHashes,regularBytes,finalizeStackPreparation} from './bochs-cpu3-native-protected-stack/build-identity.mjs';",'distinct complete stack admission');
 once('export const finalizeProtectedManifest=finalizeProtectedPreparation;','export const finalizeStackManifest=finalizeStackPreparation;','new manifest finalizer');once('export function prepareProtectedRamSource(argv,env=process.env){','export function prepareProtectedStackSource(argv,env=process.env){','new closed entry');
 once(`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url)),${JSON.stringify(preparerParentSha256)},'held RAM preparer');`,`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-protected-ram.mjs',import.meta.url)),${JSON.stringify(preparerModuleSha256)},'held protected preparer');`,'authenticate invoked held module');
 once('intermediate=prepareHeldRamSource(argv,env),result=finalizeProtectedPreparation(intermediate,before);','intermediate=prepareHeldProtectedSource(argv,env),result=finalizeStackPreparation(intermediate,before);','real held stage then new stack profile');once("'bochs/owned-protected-ram-provider.mjs':a.provider.bytes","'bochs/owned-protected-stack-provider.mjs':a.provider.bytes",'new provider output');once("'bochs/owned-protected-ram-ROM.bin':a.rom","'bochs/owned-protected-stack-ROM.bin':a.rom",'new ROM output');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'stack preparer inverse '+e.label);assert.equal(sha256(inverse),baseSha256);return {bytes:Buffer.from(s),baseSha256,edits};}
const parent=new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url);
const source=deriveStackPreparer(readFileSync(parent)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`).replaceAll('import.meta.url',JSON.stringify(import.meta.url));
const materializer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {prepareProtectedStackSource,finalizeStackManifest}=materializer;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareProtectedStackSource(process.argv.slice(2)),null,2));
