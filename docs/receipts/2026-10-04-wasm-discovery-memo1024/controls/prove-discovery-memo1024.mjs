import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
const root='/mnt/volume1/code/lego/labwired-same-host-20261003.R0T0cC';
const cwd=root+'/labwired-bool-tail',git=args=>execFileSync('git',args,{cwd,encoding:'utf8'});
const base='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const source='30131a9068e7c4aff6540092bce0a019f3b5c021';
assert.equal(git(['rev-parse','HEAD']).trim(),source);assert.equal(git(['rev-parse',source+'^']).trim(),base);
assert.equal(git(['status','--porcelain']).trim(),'');
assert.deepEqual(git(['diff','--name-only',base,source]).trim().split('\n'),[
 '.github/workflows/wasm-discovery-memo1024.yml','crates/core/src/cpu/cortex_m.rs',
 'crates/core/src/cpu/cortex_m/t16_discovery_tests.rs'
]);
const path='crates/core/src/cpu/cortex_m.rs',testPath='crates/core/src/cpu/cortex_m/t16_discovery_tests.rs';
const original=git(['show',base+':'+path]),candidate=git(['show',source+':'+path]);
const capacity='// Experimental WASM-only capacity change. Keep the exact PC/generation key,\n// discovery admission and all invalidation rules; native remains at 64 slots.\nconst T16_DISCOVERY_MISS_SLOTS: usize = if cfg!(target_arch = "wasm32") {\n    1024\n} else {\n    64\n};';
assert.equal(candidate.split(capacity).length,2);
const note='    // Bounded direct-mapped memo: 64 native / 1024 WASM (PC, generation) slots.';
assert.equal(candidate.split(note).length,2);
assert.equal(candidate.replace(capacity,'const T16_DISCOVERY_MISS_SLOTS: usize = 64;')
 .replace(note,'    // Bounded 1 KiB, direct-mapped (PC, generation) discovery-only memo.'),original);
const oldTests=git(['show',base+':'+testPath]),tests=git(['show',source+':'+testPath]);
const added=tests.match(/#\[test\]\nfn cached_discovery_memo_capacity_matches_policy_and_exact_keys\(\)[\s\S]*?(?=#\[test\])/)[0];
assert.equal(tests.replace(added,''),oldTests);
const hash=b=>createHash('sha256').update(b).digest('hex');
const proof={base,source,cpuReconstructionExact:true,nativeDispatchUnchanged:true,
 nativeCapacity:64,wasmCapacity:1024,existingTestsPreserved:true,
 exactPcAndGenerationKeyUnchanged:true,indexFormulaUnchanged:true,
 allDiscoveryAndInvalidationBodiesUnchanged:true,positiveCachePrecedenceUnchanged:true,
 admissionAndDynamicExecutionFailuresUnchanged:true,architecturalStateAndSnapshotSchemaUnchanged:true,
 noTraitOrPublicApiChanges:true,noUnsafeCodeAdded:true,noLiveEligibilityCachingAdded:true,
 originalCpuSha256:hash(original),originalTestsSha256:hash(oldTests),
 memoryTradeoff:'1024 tuples instead of 64 in WASM; no additional allocation or native capacity change',
 testScope:'Host exact-key primitive plus symbolic capacity arithmetic; not actual-WASM census',
 hostedOnly:true,noTimingConclusion:true};
const out='/mnt/storage/code/labwired-evidence/labwired-same-host-20261003.R0T0cC/discovery-memo1024-source-contract.json';
assert(!existsSync(out));const data=JSON.stringify(proof,null,2)+'\n';
execFileSync('apply_patch',[],{input:'*** Begin Patch\n*** Add File: '+out+'\n'+data.trimEnd().split('\n').map(l=>'+'+l).join('\n')+'\n*** End Patch\n'});
console.log(JSON.stringify(proof));
