import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MASTER_REVISION,LEGACY_WORK_COUNTERS,NATIVE_STAGES,PROFILE_GATES,assertProfileGates,assertSemantic,assertStageReceipt,classifyProfile,rotatedOrder,summarize}
    from '../scripts/measure-harris-native-stage-attribution.mjs';

const workflow=readFileSync(new URL('../.github/workflows/harris-native-stage-attribution.yml',import.meta.url),'utf8');
const source=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
function semantic(){return {stateHash:'x',componentHashes:{cpu:'a',bus:'b',phase:'c',lifecycle:'d',nets:'e',memory:{rom0:'f',rom1:'g',ram0:'h',ram1:'i'}},periods:10,retired:3,writes:[1,1],physicalClock:77,chunks:1,yields:0,
    work:Object.fromEntries(LEGACY_WORK_COUNTERS.map((name,i)=>[name,i+1])),producerWork:{producers:{other:{attempts:0,changes:0},
        busExternal:{attempts:100,changes:0},busOutput:{attempts:20,changes:20},phaseController:{attempts:30,changes:10},phaseLatch:{attempts:260,changes:9},
        memoryBank:{attempts:96,changes:32},phaseSchedule:{attempts:0,changes:0},evaluator:{attempts:4,changes:2},fullScan:{attempts:0,changes:0}},
        memory:{settleCalls:5,passes:6,previewCalls:6,previewBanks:24,presentBanks:12,changedBanks:4,postMemorySettles:6,postMemorySettlesWithoutDriverChange:3,ownedPreviewCalls:6,checkedValidationBanks:0,checkedValidationPinRecords:0}}};}
function stages(){return {native:{memoryMappingCalls:5,memoryMappingVisits:3200,memoryGatherCalls:6,memoryGatherPinRecords:672,memoryPreviewCalls:6,
    memoryPreviewBanks:24,memoryPreviewStateWordCopies:216,memoryCommitBanks:24,memoryCommitStateWordCopies:216,memoryWriterPublications:96,
    memoryPostSettles:6,phaseValidationCalls:10,phaseValidationVisits:660,busValidationCalls:10,busValidationVisits:820},
    js:{wasmBusInspectEntries:46,wasmBusSubmitEntries:9,wasmBusRunEntries:10,completionObjects:10,materializedCompletionRecordBytes:360}};}

test('stage receipt reconciles exact loop dimensions and receipt crossings',()=>{
    assert.equal(NATIVE_STAGES.length,15);assert.doesNotThrow(()=>assertStageReceipt(stages(),semantic()));
    for(const [section,name] of [['native','memoryMappingVisits'],['native','memoryCommitStateWordCopies'],['js','materializedCompletionRecordBytes']]){
        const bad=structuredClone(stages());bad[section][name]++;assert.throws(()=>assertStageReceipt(bad,semantic()));}
});
test('semantic reconciliation includes all existing counter fields',()=>{const expected=semantic();assert.equal(LEGACY_WORK_COUNTERS.length,12);assert.doesNotThrow(()=>assertSemantic(structuredClone(expected),expected));
    for(const field of ['stateHash','componentHashes','periods','retired','writes','physicalClock']){const bad=structuredClone(expected);bad[field]=field==='writes'?[2,1]:field==='stateHash'?'bad':field==='componentHashes'?{...bad.componentHashes,phase:'wrong'}:bad[field]+1;assert.throws(()=>assertSemantic(bad,expected));}
    for(const name of LEGACY_WORK_COUNTERS){const bad=structuredClone(expected);bad.work[name]++;assert.throws(()=>assertSemantic(bad,expected));}});
test('profile classifier uses leaf samples once, rejects unknown Wasm, and excludes idle and GC',()=>{const frames=[['validate_memory_mapping','wasm://x'],['_instructions','file:///x/harris-80c286-boot-cpu.js'],['compileForInternalLoader',''],['unknown_future_kernel','wasm://x'],['(idle)',''],['(garbage collector)','']];
    const profile={nodes:frames.map(([functionName,url],i)=>({id:i+1,callFrame:{functionName,url}})),samples:[1,2,3,4,5,6]};const c=classifyProfile(profile);
    assert.deepEqual({total:c.totalSamples,idle:c.idleSamples,gc:c.gcSamples,nonIdle:c.nonIdleSamples,classified:c.classifiedSamples},{total:6,idle:1,gc:1,nonIdle:4,classified:3});assert.equal(c.classifiedRatio,.75);assert.deepEqual(c.topTwoActionableFamilies,['jsCPU','nativeMemory']);});
test('native stage names receive stage credit only on Wasm frames',()=>{const c=classifyProfile({nodes:[{id:1,callFrame:{functionName:'validate_memory_mapping',url:'file:///x/src/fake.js'}}],samples:[1]});
    assert.equal(c.categories.memoryMappingValidation,undefined);assert.equal(c.categories.fixtureAndModelOther,1);assert.equal(c.actionableSamples,0);});
test('actionable family ties use deterministic lexical order',()=>{const frames=[['settle_incremental_context','wasm://x'],['bus_begin','wasm://x'],['preview_memory_stage','wasm://x']];
    const c=classifyProfile({nodes:frames.map(([functionName,url],i)=>({id:i+1,callFrame:{functionName,url}})),samples:[1,2,3]});
    assert.deepEqual(c.actionableRanking.map(x=>x.family),['nativeBusAndPhase','nativeMemory','nativeNetKernel']);});
test('actionable gates cannot be satisfied by runtime, harness, or fixture samples',()=>{const frames=[...Array.from({length:90},()=>['compileForInternalLoader','node:internal/test']),...Array.from({length:5},()=>['preview_memory_stage','wasm://x']),...Array.from({length:5},()=>['_instructions','file:///x/harris-80c286-boot-cpu.js'])];
    const c=classifyProfile({nodes:frames.map(([functionName,url],i)=>({id:i+1,callFrame:{functionName,url}})),samples:frames.map((_,i)=>i+1)});assert.equal(c.classifiedRatio,1);assert.equal(c.actionableRatio,.1);assert.throws(()=>assertProfileGates(c),/70% actionable/);
    assert.deepEqual(PROFILE_GATES,{classifiedRatio:.9,actionableRatio:.7,topFamilySamples:50,topFamilyShare:.1,topTwoCombinedShare:.25});});
test('rotating order and summaries are deterministic',()=>{assert.deepEqual([1,2,3].map(rotatedOrder),[['master','diagnosticOff','diagnosticOn'],['diagnosticOff','diagnosticOn','master'],['diagnosticOn','master','diagnosticOff']]);assert.equal(summarize([1,2,3]).median,2);});
test('workflow pins exact control, builds off/on separately, and rejects weak attribution',()=>{
    assert.ok(workflow.includes(`MASTER_SHA=${MASTER_REVISION}`));assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/branches: \['perf\/native-stage-attribution', 'perf\/native-stage-attribution-\*'\]/);
    assert.equal((workflow.match(/build-wired-net-kernel\.mjs/g)??[]).length,3);assert.equal((workflow.match(/NATIVE_STAGE_ATTRIBUTION=1/g)??[]).length,1);
    assert.match(workflow,/candidateOffToMaster>=\.98&&r\.ratios\.candidateOffToMaster<=1\.02/);assert.match(workflow,/diagnosticOnToOff>=\.98&&r\.ratios\.diagnosticOnToOff<=1\.02/);
    assert.match(workflow,/for run in 1 2 3/);assert.match(workflow,/--cpu-prof/);assert.match(workflow,/--profile-repetitions=8/);assert.match(workflow,/classifiedRatio>=\.90/);assert.match(workflow,/actionableRatio>=\.70/);assert.match(workflow,/x\.samples>=50&&x\.shareOfNonIdle>=\.10/);assert.match(workflow,/topTwoCombinedShare>=\.25/);assert.match(workflow,/topTwoActionableFamilies/);assert.match(workflow,/artifact-manifest\.json/);assert.match(workflow,/createHash\("sha256"\)/);assert.match(workflow,/wired-net-kernel\.wasm/);assert.doesNotMatch(workflow,/continue-on-error: true|\|\| true/);
    for(const action of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
});
test('diagnostic build is conditional and stable work-counter ABI source is untouched',()=>{
    const build=source('scripts/build-wired-net-kernel.mjs'),incremental=source('src/experimental/wired-kernel/incremental-nets.c'),header=source('src/experimental/wired-kernel/stage-attribution.h');
    assert.match(build,/NATIVE_STAGE_ATTRIBUTION/);assert.match(build,/stage_attribution_version/);assert.match(incremental,/u32 incremental_work\[12\]/);assert.match(incremental,/incremental_work_counters_version\(void\)\{return 3;\}/);
    assert.match(header,/STAGE_COUNTER_COUNT/);assert.match(header,/NATIVE_STAGE_ATTRIBUTION/);assert.doesNotMatch(header,/incremental_work|producer_work|memory_pass_work/);
});
test('crossing counters follow actual calls and semantic hash covers hidden state',()=>{const bus=source('src/experimental/wired-kernel/bus-circuit-image.js'),runner=source('scripts/measure-harris-native-stage-attribution.mjs');
    assert.match(bus,/const inspectEntry=field=>\{count\('wasmBusInspectEntries'\);return e\.bus_inspect\(field\);\}/);assert.doesNotMatch(bus,/count\('wasmBusInspectEntries',4\)/);
    assert.match(bus,/materializedCompletionRecordBytes/);assert.doesNotMatch(bus,/nativeReceiptBytesRead/);
    for(const name of ['inspectPhase','inspectLifecycle','inspectNets','componentHashes'])assert.ok(runner.includes(name),name);
});
