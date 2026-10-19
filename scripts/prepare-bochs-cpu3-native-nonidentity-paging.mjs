/** Checked new definitions; importing never materializes or compiles. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {authenticated,replacement,sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveStackPreparer} from './prepare-bochs-cpu3-native-protected-stack.mjs';
export const preparerParentSha256='a54809e4927c2ab461ad6f2fa13ab338c6d3e77ed81b603223c14c4dc71727cd';
export const preparerModuleSha256='1ef2568b9f4de99f519b96dbd5bdcdd4336b6023f7e88bea60b063f5784c7fc1';
export function derivePagingPreparer(bytes){authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-protected-stack.mjs',import.meta.url)),preparerModuleSha256,'held stack materializer module');authenticated(bytes,preparerParentSha256,'held input materializer');const held=deriveStackPreparer(bytes),baseSha256=sha256(held.bytes);let s=held.bytes.toString();const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once("import {prepareProtectedRamSource as prepareHeldProtectedSource} from './prepare-bochs-cpu3-native-protected-ram.mjs';","import {prepareProtectedStackSource as prepareHeldStackSource} from './prepare-bochs-cpu3-native-protected-stack.mjs';",'held stack materialization stage');
 once("import {generatedStackArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-protected-stack/build-identity.mjs';","import {generatedPagingArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-nonidentity-paging/build-identity.mjs';",'new generated paging artifacts');
 once("import {protectedStackProfile} from './bochs-cpu3-native-protected-stack/profile.mjs';","import {nativePagingProfile as protectedStackProfile} from './bochs-cpu3-native-nonidentity-paging/provider-profile.mjs';",'new fixed native paging profile');
 once("import {sourceIdentity,generatedHashes,regularBytes,finalizeStackPreparation} from './bochs-cpu3-native-protected-stack/build-identity.mjs';","import {sourceIdentity,generatedHashes,regularBytes,finalizePagingPreparation} from './bochs-cpu3-native-nonidentity-paging/build-identity.mjs';",'distinct complete paging admission');
 once('export const finalizeStackManifest=finalizeStackPreparation;','export const finalizePagingManifest=finalizePagingPreparation;','new manifest finalizer');once('export function prepareProtectedStackSource(argv,env=process.env){','export function prepareNonidentityPagingSource(argv,env=process.env){','new closed entry');
 once(`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-protected-ram.mjs',import.meta.url)),"2989ddcc148a8c0df3c4f4eabf956bd813a2df4a8413ad249d33cd044d6097a4",'held protected preparer');`,`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-protected-stack.mjs',import.meta.url)),${JSON.stringify(preparerModuleSha256)},'held stack preparer');`,'authenticate invoked held module');
 once('intermediate=prepareHeldProtectedSource(argv,env),result=finalizeStackPreparation(intermediate,before);','intermediate=prepareHeldStackSource(argv,env),result=finalizePagingPreparation(intermediate,before);','held stage then distinct paging profile');once("'bochs/owned-protected-stack-provider.mjs':a.provider.bytes","'bochs/owned-nonidentity-paging-provider.mjs':a.provider.bytes",'new provider output');once("'bochs/owned-protected-stack-ROM.bin':a.rom","'bochs/owned-nonidentity-paging-ROM.bin':a.rom",'new ROM output');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'paging preparer inverse '+e.label);assert.equal(sha256(inverse),baseSha256);return {bytes:Buffer.from(s),baseSha256,edits};}
const parent=new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url);
const source=derivePagingPreparer(readFileSync(parent)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`).replaceAll('import.meta.url',JSON.stringify(import.meta.url));
const materializer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {prepareNonidentityPagingSource,finalizePagingManifest}=materializer;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(prepareNonidentityPagingSource(process.argv.slice(2)),null,2));
