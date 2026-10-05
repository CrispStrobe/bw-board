/** Checked new definitions; importing never materializes or compiles. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {authenticated,replacement,sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveIntIretPreparer} from './prepare-bochs-cpu3-native-paged-int-iret.mjs';
export const preparerParentSha256='a54809e4927c2ab461ad6f2fa13ab338c6d3e77ed81b603223c14c4dc71727cd';
export const preparerModuleSha256='80c11bde85b70ca45a9d7e46a3a8e1eadf66bfa6c5aa61b0fd63f55a245e12d3';
export function derivePageFaultPreparer(bytes){authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-paged-int-iret.mjs',import.meta.url)),preparerModuleSha256,'held paging materializer module');authenticated(bytes,preparerParentSha256,'held input materializer');const held=deriveIntIretPreparer(bytes),baseSha256=sha256(held.bytes);let s=held.bytes.toString();const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once("import {prepareNonidentityPagingSource as prepareHeldPagingSource} from './prepare-bochs-cpu3-native-nonidentity-paging.mjs';","import {preparePagedIntIretSource as prepareHeldIntSource} from './prepare-bochs-cpu3-native-paged-int-iret.mjs';",'held INT materialization stage');
 once("import {generatedIntIretArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-paged-int-iret/build-identity.mjs';","import {generatedPageFaultArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-paged-pagefault/build-identity.mjs';",'new generated fault artifacts');
 once("import {nativeIntIretProfile as protectedStackProfile} from './bochs-cpu3-native-paged-int-iret/provider-profile.mjs';","import {nativePageFaultProfile as protectedStackProfile} from './bochs-cpu3-native-paged-pagefault/provider-profile.mjs';",'new fault profile');
 once("import {sourceIdentity,generatedHashes,regularBytes,finalizeIntIretPreparation} from './bochs-cpu3-native-paged-int-iret/build-identity.mjs';","import {sourceIdentity,generatedHashes,regularBytes,finalizePageFaultPreparation} from './bochs-cpu3-native-paged-pagefault/build-identity.mjs';",'new manifest authority');
 once('export const finalizeIntIretManifest=finalizeIntIretPreparation;','export const finalizePageFaultManifest=finalizePageFaultPreparation;','manifest finalizer');
 once('export function preparePagedIntIretSource(argv,env=process.env){','export function preparePagedPageFaultSource(argv,env=process.env){','closed entry');
 once(`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-nonidentity-paging.mjs',import.meta.url)),"f2802e3b620bab5c22f3a8fea8195c1025fb5fc34c6dfde9a1bbd10038621412",'held paging preparer');`,`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-paged-int-iret.mjs',import.meta.url)),${JSON.stringify(preparerModuleSha256)},'held INT preparer');`,'authenticate held stage');
 once('intermediate=prepareHeldPagingSource(argv,env),result=finalizeIntIretPreparation(intermediate,before);','intermediate=prepareHeldIntSource(argv,env),result=finalizePageFaultPreparation(intermediate,before);','held stage then new fault profile');
 once("'bochs/owned-paged-int-iret-provider.mjs':a.provider.bytes","'bochs/owned-paged-pagefault-provider.mjs':a.provider.bytes",'new provider output');
 once("'bochs/owned-paged-int-iret-ROM.bin':a.rom","'bochs/owned-paged-pagefault-ROM.bin':a.rom",'new ROM output');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'INT preparer inverse '+e.label);assert.equal(sha256(inverse),baseSha256);return {bytes:Buffer.from(s),baseSha256,edits};}
const parent=new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url);
const source=derivePageFaultPreparer(readFileSync(parent)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`).replaceAll('import.meta.url',JSON.stringify(import.meta.url));
const materializer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {preparePagedPageFaultSource,finalizePageFaultManifest}=materializer;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(preparePagedPageFaultSource(process.argv.slice(2)),null,2));
