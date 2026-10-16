/** Checked new definitions; importing never materializes or compiles. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {authenticated,replacement,sha256} from './bochs-cpu3-native-owned-clock/derive.mjs';
import {derivePagingPreparer} from './prepare-bochs-cpu3-native-nonidentity-paging.mjs';
export const preparerParentSha256='a54809e4927c2ab461ad6f2fa13ab338c6d3e77ed81b603223c14c4dc71727cd';
export const preparerModuleSha256='f2802e3b620bab5c22f3a8fea8195c1025fb5fc34c6dfde9a1bbd10038621412';
export function derivePagedIrqPreparer(bytes){authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-nonidentity-paging.mjs',import.meta.url)),preparerModuleSha256,'held paging materializer module');authenticated(bytes,preparerParentSha256,'held input materializer');const held=derivePagingPreparer(bytes),baseSha256=sha256(held.bytes);let s=held.bytes.toString();const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once("import {prepareProtectedStackSource as prepareHeldStackSource} from './prepare-bochs-cpu3-native-protected-stack.mjs';","import {prepareNonidentityPagingSource as prepareHeldPagingSource} from './prepare-bochs-cpu3-native-nonidentity-paging.mjs';",'held paging materialization stage');
 once("import {generatedPagingArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-nonidentity-paging/build-identity.mjs';","import {generatedPagedIrqArtifacts as generatedRamArtifacts} from './bochs-cpu3-native-paged-irq/build-identity.mjs';",'new generated IRQ artifacts');
 once("import {nativePagingProfile as protectedStackProfile} from './bochs-cpu3-native-nonidentity-paging/provider-profile.mjs';","import {nativePagedIrqProfile as protectedStackProfile} from './bochs-cpu3-native-paged-irq/provider-profile.mjs';",'new fixed native IRQ profile');
 once("import {sourceIdentity,generatedHashes,regularBytes,finalizePagingPreparation} from './bochs-cpu3-native-nonidentity-paging/build-identity.mjs';","import {sourceIdentity,generatedHashes,regularBytes,finalizePagedIrqPreparation} from './bochs-cpu3-native-paged-irq/build-identity.mjs';",'distinct complete IRQ admission');
 once('export const finalizePagingManifest=finalizePagingPreparation;','export const finalizePagedIrqManifest=finalizePagedIrqPreparation;','new manifest finalizer');
 once('export function prepareNonidentityPagingSource(argv,env=process.env){','export function preparePagedIrqSource(argv,env=process.env){','new closed entry');
 once(`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-protected-stack.mjs',import.meta.url)),"1ef2568b9f4de99f519b96dbd5bdcdd4336b6023f7e88bea60b063f5784c7fc1",'held stack preparer');`,`authenticated(readFileSync(new URL('./prepare-bochs-cpu3-native-nonidentity-paging.mjs',import.meta.url)),${JSON.stringify(preparerModuleSha256)},'held paging preparer');`,'authenticate invoked held module');
 once('intermediate=prepareHeldStackSource(argv,env),result=finalizePagingPreparation(intermediate,before);','intermediate=prepareHeldPagingSource(argv,env),result=finalizePagedIrqPreparation(intermediate,before);','held stage then distinct IRQ profile');
 once("'bochs/owned-nonidentity-paging-provider.mjs':a.provider.bytes","'bochs/owned-paged-irq-provider.mjs':a.provider.bytes",'new provider output');
 once("'bochs/owned-nonidentity-paging-ROM.bin':a.rom","'bochs/owned-paged-irq-ROM.bin':a.rom",'new ROM output');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'IRQ preparer inverse '+e.label);assert.equal(sha256(inverse),baseSha256);return {bytes:Buffer.from(s),baseSha256,edits};}
const parent=new URL('./prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url);
const source=derivePagedIrqPreparer(readFileSync(parent)).bytes.toString().replace(/from (['"])(\.[^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,parent).href}${q}`).replaceAll('import.meta.url',JSON.stringify(import.meta.url));
const materializer=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
export const {preparePagedIrqSource,finalizePagedIrqManifest}=materializer;
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(preparePagedIrqSource(process.argv.slice(2)),null,2));
