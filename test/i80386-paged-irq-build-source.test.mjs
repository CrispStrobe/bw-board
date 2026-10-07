import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {derivePagedIrqAdmission,generatedHashes,generatedPagedIrqArtifacts,finalizePagedIrqPreparation,validatePagedIrqManifest,canonicalConfiguration,oldAddonsNotAdmitted} from '../scripts/bochs-cpu3-native-paged-irq/build-identity.mjs';
import {derivePagedIrqPreparer} from '../scripts/prepare-bochs-cpu3-native-paged-irq.mjs';
import {finalizePagingPreparation} from '../scripts/bochs-cpu3-native-nonidentity-paging/build-identity.mjs';
import {finalizeStackPreparation} from '../scripts/bochs-cpu3-native-protected-stack/build-identity.mjs';
import {finalizeProtectedPreparation} from '../scripts/bochs-cpu3-native-protected-ram/build-identity.mjs';
import {finalizeRamPreparation} from '../scripts/prepare-bochs-cpu3-native-ram-bootstrap.mjs';
import {finalizePreparation} from '../scripts/prepare-bochs-cpu3-native-cold-bios.mjs';
import {hotNativeProfile} from '../scripts/bochs-cpu3-native-hot-direct/profile.mjs';
import {upstreamHashes} from '../scripts/bochs-cpu3-native-direct-board/patch.mjs';
import {nativePagedIrqProfile} from '../scripts/bochs-cpu3-native-paged-irq/provider-profile.mjs';
import {sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';

test('IRQ build definitions derive exact held sources and distinct generated roles',()=>{
 const input=readFileSync(new URL('../scripts/bochs-cpu3-native-cold-bios/identity.mjs',import.meta.url));
 const admission=derivePagedIrqAdmission(input);
 assert.ok(admission.bytes.includes('bochs/owned-paged-irq-provider.mjs'));
 assert.ok(admission.bytes.includes('bochs/owned-paged-irq-ROM.bin'));
 assert.throws(()=>derivePagedIrqAdmission(Buffer.from('changed')));
 const source=readFileSync(new URL('../scripts/prepare-bochs-cpu3-native-ram-bootstrap.mjs',import.meta.url));
 const preparer=derivePagedIrqPreparer(source);
 assert.ok(preparer.bytes.includes('finalizePagedIrqPreparation(intermediate,before)'));
 assert.ok(preparer.bytes.includes('bochs/owned-paged-irq-ROM.bin'));
 assert.throws(()=>derivePagedIrqPreparer(Buffer.from('changed')));
 const hashes=generatedHashes(),artifacts=generatedPagedIrqArtifacts();
 assert.equal(hashes['bochs/cpu/bw_slice_runtime.inc'],sha256(artifacts.runtime.bytes));
 assert.equal(hashes['bochs/owned-paged-irq-provider.mjs'],sha256(artifacts.provider.bytes));
 assert.equal(hashes['bochs/owned-paged-irq-ROM.bin'],nativePagedIrqProfile.romSha256);
 assert.equal(hashes['bochs/owned-paged-int-iret-ROM.bin'],undefined);
 assert.deepEqual(Object.keys(hashes).sort(),[
  'bochs/cpu/bw_slice_runtime.inc','bochs/cpu/bw_slice_abi.h',
  'bochs/bochs-cpu3-native-direct-board/abi.h',
  'bochs/bochs-cpu3-native-direct-board-adapter/napi.cc',
  'bochs/owned-paged-irq-provider.mjs','bochs/owned-paged-irq-ROM.bin'].sort());
});

test('IRQ manifest keeps paging provenance and denies historical generated roles',()=>{
 const source={revision:'a'.repeat(40),hashes:{'diagnostic-source':'b'.repeat(64)}};
 const h4={boardRevision:source.revision,bochsRevision:'0e45b736ef9792eb9b752b0a35db49eaf2faea47',sourceHashes:{...source.hashes},profile:hotNativeProfile,generatedRuntimeSha256:'89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a',preparedTree:'/diagnostic-prepared',upstreamHashes,patchedHashes:Object.fromEntries(Object.keys(upstreamHashes).map(p=>[p,'c'.repeat(64)]))};
 const cold=finalizePreparation(h4,source),ram=finalizeRamPreparation(cold,source),protectedEntry=finalizeProtectedPreparation(ram,source),stack=finalizeStackPreparation(protectedEntry,source),paging=finalizePagingPreparation(stack,source),irq=finalizePagedIrqPreparation(paging,source);
 assert.deepEqual(irq.originalPagingProvenance,paging);
 assert.deepEqual(irq.pagedIrqProfile,nativePagedIrqProfile);
 assert.deepEqual(irq.actualPreparedHashes,generatedHashes());
 assert.ok(canonicalConfiguration(irq,'/diagnostic-irq.log').includes('owned-paged-irq-ROM.bin'));
 for(const mutate of [x=>x.actualPreparedHashes=paging.actualPreparedHashes,
  x=>x.originalPagingProvenance.generatedRuntimeSha256='0'.repeat(64),
  x=>x.pagedIrqProfile=paging.profile]){
  const changed=structuredClone(irq);mutate(changed);assert.throws(()=>validatePagedIrqManifest(changed));
 }
 assert.ok(oldAddonsNotAdmitted.length>0);
});
