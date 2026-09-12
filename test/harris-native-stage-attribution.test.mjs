import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {MASTER_REVISION,DIAGNOSTIC_SOURCE_PATH,HEADER_PATH,NATIVE_SOURCE_PATHS,LEGACY_WORK_COUNTERS,NATIVE_STAGES,PROFILE_GATES,
    assertDiagnosticSourceHashes,assertHeaderHashes,assertJSImportHashes,assertProfileGates,assertSemantic,assertSourceHashes,assertStageReceipt,canonicalBuildArgs,classifyProfile,
    collectJSImportClosure,controlGateResult,rotatedOrder,summarize}
    from '../scripts/measure-harris-native-stage-attribution.mjs';
import {createAcceptedBusStageAttribution} from '../src/experimental/wired-kernel/memory-circuit.js';

const workflow=readFileSync(new URL('../.github/workflows/harris-native-stage-attribution.yml',import.meta.url),'utf8');
const source=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
function assertDerivedStageCounterSources(files){
    const {banks,memory,phase,bus}=files;
    assert.match(banks,/#define PREVIEW_RETURN\(value\) do\{STAGE_ADD\(STAGE_MEMORY_PREVIEW_BANKS,stage_visited\);STAGE_ADD\(STAGE_MEMORY_PREVIEW_STATE_WORD_COPIES,stage_visited\*WORDS\);return value;\}while\(0\)/);
    const preview=banks.slice(banks.indexOf('STAGE_ADD(STAGE_MEMORY_PREVIEW_CALLS,1);'),banks.indexOf('u32 preview_memory_banks'));
    assert.match(preview,/#ifdef NATIVE_STAGE_ATTRIBUTION\n    u32 stage_visited=0;/);assert.match(preview,/#define PREVIEW_VISIT\(\) stage_visited\+\+;/);assert.match(preview,/#else\n    #define PREVIEW_VISIT\(\)\n    #define PREVIEW_RETURN\(value\) return value/);
    assert.match(preview,/for\(u32 b=0;b<banks;b\+\+\) \{\n        PREVIEW_VISIT\(\)/);
    assert.equal((preview.match(/\breturn\b/g)??[]).length,2,'both enabled and disabled exit macros return directly');
    assert.doesNotMatch(preview,/STAGE_ADD\(STAGE_MEMORY_PREVIEW_BANKS,1\)|STAGE_ADD\(STAGE_MEMORY_PREVIEW_STATE_WORD_COPIES,WORDS\)/);
    for(const formula of ['MAPPING_RETURN(2,i+1)','MAPPING_RETURN(3,banks*28+i*(i+1)/2+1)','MAPPING_RETURN(4,banks*28+i*(i+1)/2+j+2)','MAPPING_RETURN(0,banks*28+(banks*8)*(banks*8+1)/2)'])assert.ok(memory.includes(formula),formula);
    for(const formula of ['INLINE_MAPPING_FAILURE(2,i+1)','INLINE_MAPPING_FAILURE(3,banks*28+i*(i+1)/2+1)','INLINE_MAPPING_FAILURE(4,banks*28+i*(i+1)/2+j+2)','STAGE_ADD(STAGE_MEMORY_MAPPING_VISITS,banks*28+(banks*8)*(banks*8+1)/2)'])assert.ok(memory.includes(formula),formula);
    assert.match(memory,/#ifdef NATIVE_STAGE_PROFILE_NAMING\n    if\(!c\[31\]\) \{\n        u32 mapping=validate_memory_mapping/);
    assert.match(memory,/#ifdef NATIVE_STAGE_ATTRIBUTION\n    if\(!c\[31\]\) \{\n    STAGE_ADD\(STAGE_MEMORY_MAPPING_CALLS,1\)/);
    assert.match(memory,/STAGE_ADD\(STAGE_MEMORY_WRITER_PUBLICATIONS,publications\);\n                    #endif\n                    fault\[0\]=1;fault\[1\]=2;return 1;/);
    for(const formula of ['PHASE_MAPPING_RETURN(reject_phase(p,4,6,i,fault),i+1)','PHASE_MAPPING_RETURN(reject_phase(p,4,7,i,fault),6+i+1)','PHASE_MAPPING_RETURN(reject_phase(p,4,8,i,fault),13+i+1)','PHASE_MAPPING_RETURN(reject_phase(p,4,9,i,fault),40+i+1)','PHASE_MAPPING_RETURN(0,66)'])assert.ok(phase.includes(formula),formula);
    for(const formula of ['BUS_MAPPING_RETURN(failure(p,8,2,i,fault),i+1)','BUS_MAPPING_RETURN(failure(p,8,2,i,fault),24+i+1)','BUS_MAPPING_RETURN(failure(p,8,2,i,fault),72+i+1)','BUS_MAPPING_RETURN(0,72+p[6])'])assert.ok(bus.includes(formula),formula);
    assert.match(phase,/if\(p\[2\]>1\|\|p\[3\]>1\)return reject_phase/);assert.match(bus,/if\(p\[6\]>128\)return failure/);
    assert.doesNotMatch(memory,/\bvisits\+\+/);assert.doesNotMatch(phase,/\bvisits\+\+/);assert.doesNotMatch(bus,/\bvisits\+\+/);
}
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
    assert.equal(NATIVE_STAGES.length,15);assert.doesNotThrow(()=>assertStageReceipt(stages(),semantic(),{memoryMapping:'historical-runtime-validation'}));
    const admitted=stages();admitted.native.memoryMappingCalls=admitted.native.memoryMappingVisits=0;
    assert.doesNotThrow(()=>assertStageReceipt(admitted,semantic(),{memoryMapping:'admitted'}));
    assert.throws(()=>assertStageReceipt(stages(),semantic(),{memoryMapping:'admitted'}));
    for(const [section,name] of [['native','memoryMappingVisits'],['native','memoryCommitStateWordCopies'],['js','materializedCompletionRecordBytes']]){
        const bad=structuredClone(stages());bad[section][name]++;assert.throws(()=>assertStageReceipt(bad,semantic(),{memoryMapping:'historical-runtime-validation'}));}
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
test('rotating order and summaries are deterministic',()=>{assert.deepEqual([1,2,3,4].map(rotatedOrder),[['master','diagnosticOff','nativeCounter','combinedCounter'],['diagnosticOff','nativeCounter','combinedCounter','master'],['nativeCounter','combinedCounter','master','diagnosticOff'],['combinedCounter','master','diagnosticOff','nativeCounter']]);assert.equal(summarize([1,2,3]).median,2);});
test('failed control gate remains a serializable observation',()=>{const gate=controlGateResult({candidateOffToMaster:1,counterOnToOff:.97});assert.equal(gate.passed,false);assert.deepEqual(gate.observations.counterOnToOff,{value:.97,minimum:.98,maximum:1.02,passed:false});assert.doesNotThrow(()=>JSON.stringify(gate));});
test('current attribution provenance fails closed on native inventories and follows the workload JS closure',()=>{
    const sources=Object.fromEntries(NATIVE_SOURCE_PATHS.map((path,index)=>[path,`digest-${index}`]));
    assert.deepEqual(assertSourceHashes({...sources},sources),sources);assert.deepEqual(assertHeaderHashes({[HEADER_PATH]:'header'},'header'),{[HEADER_PATH]:'header'});
    const missing={...sources};delete missing[NATIVE_SOURCE_PATHS[0]];const wrong={...sources,[NATIVE_SOURCE_PATHS[0]]:'wrong'};
    const extra={...sources,'src/experimental/wired-kernel/extra.c':'extra'};
    for(const value of [missing,wrong,extra])assert.throws(()=>assertSourceHashes(value,sources));
    const diagnostic={...sources,[DIAGNOSTIC_SOURCE_PATH]:'diagnostic'};assert.deepEqual(assertDiagnosticSourceHashes(diagnostic,sources),diagnostic);
    assert.throws(()=>assertDiagnosticSourceHashes(sources,sources));
    assert.throws(()=>assertDiagnosticSourceHashes({...diagnostic,[NATIVE_SOURCE_PATHS[0]]:'wrong'},sources));
    for(const value of [{},{[HEADER_PATH]:'wrong'},{[HEADER_PATH]:'header',extra:'extra'}])assert.throws(()=>assertHeaderHashes(value,'header'));
    const root=new URL('..',import.meta.url).pathname,closure=collectJSImportClosure(root,['src/devices/bus-memory.js','src/experimental/harris-80c286-boot-cpu.js',
        'src/experimental/harris-boot-rom.js','src/experimental/harris-native-memory-board.js','src/experimental/harris-run-transactions.js']);
    for(const path of ['src/experimental/wired-kernel/memory-circuit.js','src/experimental/wired-kernel/phase-circuit-image.js',
        'src/experimental/wired-kernel/bus-circuit-image.js'])assert.ok(closure.includes(path),path);
    const js=Object.fromEntries(closure.map((path,index)=>[path,`js-${index}`]));assert.deepEqual(assertJSImportHashes({...js},js),js);
    const jsMissing={...js};delete jsMissing[closure[0]];const jsWrong={...js,[closure[0]]:'wrong'},jsExtra={...js,'src/extra.js':'extra'};
    for(const value of [jsMissing,jsWrong,jsExtra])assert.throws(()=>assertJSImportHashes(value,js));
    assert.deepEqual(canonicalBuildArgs(['-O3','-DNATIVE_STAGE_ATTRIBUTION=1',`/a/${NATIVE_SOURCE_PATHS[0]}`,'-o','/tmp/a']),
        ['-O3',NATIVE_SOURCE_PATHS[0],'-o','<output>']);
    assert.deepEqual(canonicalBuildArgs(['-O3','-DNATIVE_STAGE_PROFILE_NAMING=1',`/b/${NATIVE_SOURCE_PATHS[0]}`,'-o','/tmp/b']),
        ['-O3',NATIVE_SOURCE_PATHS[0],'-o','<output>']);
});
test('workflow pins exact control, builds off/on separately, and rejects weak attribution',()=>{
    assert.ok(workflow.includes(`MASTER_SHA=${MASTER_REVISION}`));assert.match(workflow,/workflow_dispatch:/);assert.match(workflow,/branches: \['perf\/native-stage-attribution', 'perf\/native-stage-attribution-\*'\]/);
    assert.equal((workflow.match(/build-wired-net-kernel\.mjs/g)??[]).length,4);assert.equal((workflow.match(/NATIVE_STAGE_ATTRIBUTION=1/g)??[]).length,1);assert.equal((workflow.match(/NATIVE_STAGE_PROFILE_NAMING=1/g)??[]).length,1);
    for(const mode of ['counter-on','named-profile'])assert.ok(workflow.includes(`${mode}-mapping-tests.tap`),mode);
    assert.match(workflow,/test\/harris-native-memory-circuit\.test\.mjs\s+test\/harris-native-system-admission\.test\.mjs/);
    assert.match(workflow,/assert\.match\(tap,\/\^# skipped 0\$\/m\)/);assert.match(workflow,/assert\.doesNotMatch\(tap,\/# SKIP/);
    assert.match(workflow,/cmp "\$RECEIPT_DIR\/master-build\/wired-net-kernel\.wasm" "\$RECEIPT_DIR\/diagnostic-off-build\/wired-net-kernel\.wasm"/);assert.match(workflow,/cmp "\$MASTER_TREE\/src\/experimental\/wired-kernel\/bus-circuit-image\.js"/);
    assert.match(workflow,/candidateOffToMaster>=\.98&&r\.ratios\.candidateOffToMaster<=1\.02/);assert.match(workflow,/combinedCounterToOff>=\.98&&r\.ratios\.combinedCounterToOff<=1\.02/);assert.match(workflow,/nativeCounterToOff/);assert.match(workflow,/combinedCounterToNative/);assert.match(workflow,/stageProfileNames\],\[true,false,false\]/);assert.match(workflow,/stageProfileNames\],\[false,false,true\]/);
    assert.match(workflow,/for run in 1 2 3/);assert.match(workflow,/--cpu-prof/);assert.match(workflow,/--profile-repetitions=8/);assert.match(workflow,/profileReceipt\.expected,control\.expected/);assert.match(workflow,/classifiedRatio>=\.90/);assert.match(workflow,/actionableRatio>=\.70/);assert.match(workflow,/x\.samples>=50&&x\.shareOfNonIdle>=\.10/);assert.match(workflow,/topTwoCombinedShare>=\.25/);assert.match(workflow,/topTwoActionableFamilies/);assert.match(workflow,/artifact-manifest\.json/);assert.match(workflow,/createHash\("sha256"\)/);assert.match(workflow,/\["master","diagnostic-off","counter-on","named-profile"\]/);assert.match(workflow,/missing,unexpected,files/);assert.doesNotMatch(workflow,/continue-on-error: true|\|\| true/);
    for(const action of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
});
test('diagnostic build is conditional and stable work-counter ABI source is untouched',()=>{
    const build=source('scripts/build-wired-net-kernel.mjs'),runner=source('scripts/measure-harris-native-stage-attribution.mjs'),incremental=source('src/experimental/wired-kernel/incremental-nets.c'),header=source('src/experimental/wired-kernel/stage-attribution.h');
    assert.match(build,/NATIVE_STAGE_ATTRIBUTION/);assert.match(build,/NATIVE_STAGE_PROFILE_NAMING/);assert.match(build,/headerHashes:\{\[headerName\]:hash/);assert.doesNotMatch(build,/\.\.\.sourceNames,'src\/experimental\/wired-kernel\/stage-attribution\.h'/);assert.match(build,/stage_attribution_version/);assert.match(incremental,/u32 incremental_work\[12\]/);assert.match(incremental,/incremental_work_counters_version\(void\)\{return 3;\}/);
    assert.match(runner,/assertSourceHashes\(build\.sourceHashes/);assert.match(runner,/assertHeaderHashes\(build\.headerHashes/);
    assert.match(runner,/diagnostics-off production Wasm identity/);assert.match(runner,/only explicit diagnostic build flags may differ/);
    assert.match(runner,/assertDiagnosticSourceHashes/);assert.match(runner,/immutable admission work is unchanged by execution/);
    assert.match(runner,/assertStageReceipt\(stage,semantic,\{memoryMapping:'admitted'\}\)/);
    assert.match(header,/STAGE_COUNTER_COUNT/);assert.match(header,/#ifdef NATIVE_STAGE_PROFILE_NAMING\n#define STAGE_NOINLINE/);assert.doesNotMatch(header,/incremental_work|producer_work|memory_pass_work/);
});
test('accepted boundary counters preserve disabled bus shape and disclose rejected calls',()=>{const bus=source('src/experimental/wired-kernel/bus-circuit-image.js'),memory=source('src/experimental/wired-kernel/memory-circuit.js'),runner=source('scripts/measure-harris-native-stage-attribution.mjs');
    assert.doesNotMatch(bus,/stageAttribution|wasmBusInspectEntries|inspectJSStageAttribution/);
    assert.match(memory,/const rawBusMethods=busBinding\?\.initialize\(\{e,p,put,inspect/);assert.doesNotMatch(memory,/busExports|countBusCrossings|countJSStage/);
    assert.match(memory,/createAcceptedBusStageAttribution\(rawBusMethods\)/);
    assert.match(memory,/materializedCompletionRecordBytes/);assert.doesNotMatch(memory,/nativeReceiptBytesRead/);
    assert.match(runner,/Other rejected high-level calls are excluded, including validation paths that may already have called bus_inspect/);
    for(const name of ['inspectPhase','inspectLifecycle','inspectNets','componentHashes','headerHashes','nativeCounter','combinedCounter'])assert.ok(runner.includes(name),name);
});
test('accepted boundary counters execute success, budget, fault, exclusion, reset and u32 wrap contracts',()=>{
    const acceptedSubmit={token:'submit'},completed={completed:true,completions:[{},{}]},budget={completed:false,stopReason:'budget',completions:[{}]};
    let nextRun=completed;const raw={marker:7,submit:()=>acceptedSubmit,runUntilCompletion:()=>nextRun};const measured=createAcceptedBusStageAttribution(raw);
    assert.equal(measured.marker,7);assert.equal(measured.submit(),acceptedSubmit);assert.equal(measured.runUntilCompletion(),completed);
    assert.deepEqual(measured.inspectJSStageAttribution(),{wasmBusInspectEntries:5,wasmBusSubmitEntries:1,wasmBusRunEntries:1,completionObjects:2,materializedCompletionRecordBytes:72});
    nextRun=budget;assert.equal(measured.runUntilCompletion(),budget);assert.deepEqual(measured.inspectJSStageAttribution(),{wasmBusInspectEntries:6,wasmBusSubmitEntries:1,wasmBusRunEntries:2,completionObjects:3,materializedCompletionRecordBytes:108});
    const fault=new Error('native fault');fault.progress={completions:[{},{}]};nextRun=undefined;raw.runUntilCompletion=()=>{throw fault;};
    assert.throws(()=>measured.runUntilCompletion(),error=>error===fault);assert.deepEqual(measured.inspectJSStageAttribution(),{wasmBusInspectEntries:8,wasmBusSubmitEntries:1,wasmBusRunEntries:3,completionObjects:5,materializedCompletionRecordBytes:180});
    measured.resetJSStageAttribution();assert.deepEqual(measured.inspectJSStageAttribution(),{wasmBusInspectEntries:0,wasmBusSubmitEntries:0,wasmBusRunEntries:0,completionObjects:0,materializedCompletionRecordBytes:0});
    const rejected=new Error('pre-boundary');delete fault.progress;raw.submit=raw.runUntilCompletion=()=>{throw rejected;};
    assert.throws(()=>measured.submit(),error=>error===rejected);assert.throws(()=>measured.runUntilCompletion(),error=>error===rejected);assert.deepEqual(measured.inspectJSStageAttribution(),{wasmBusInspectEntries:0,wasmBusSubmitEntries:0,wasmBusRunEntries:0,completionObjects:0,materializedCompletionRecordBytes:0});
    raw.runUntilCompletion=()=>({completions:{length:0xffffffff}});measured.runUntilCompletion();raw.runUntilCompletion=()=>({completions:{length:1}});measured.runUntilCompletion();
    assert.deepEqual(measured.inspectJSStageAttribution(),{wasmBusInspectEntries:2,wasmBusSubmitEntries:0,wasmBusRunEntries:2,completionObjects:0,materializedCompletionRecordBytes:0});
});
test('receipts precede workflow acceptance and profile classification has no in-process gate',()=>{const runner=source('scripts/measure-harris-native-stage-attribution.mjs');assert.match(runner,/process\.stdout\.write\(JSON\.stringify\(report,null,2\)\+'\\n'\);\}/);assert.doesNotMatch(runner,/process\.stdout\.write[^\n]+assert/);
    const classify=runner.slice(runner.indexOf("if(options['classify-profile'])"),runner.indexOf("assert.equal(options.experimental"));assert.doesNotMatch(classify,/assertProfileGates/);assert.match(classify,/console\.log\(JSON\.stringify/);assert.match(classify,/construction and final inspection frames/);assert.doesNotMatch(classify,/never contribute to actionableSamples/);});
test('moved memory mutations retain unique selectors and named reds',()=>{const producer=source('scripts/verify-harris-native-producer-counters.mjs'),owned=source('scripts/verify-harris-native-owned-memory-preview-mutations.mjs'),memoryCircuit=source('src/experimental/wired-kernel/memory-circuit.c'),memoryBanks=source('src/experimental/wired-kernel/memory-banks.c');
    for(const verifier of [producer,owned])assert.match(verifier,/env:\{\.\.\.process\.env,NATIVE_STAGE_ATTRIBUTION:'1'\}/);
    assert.match(producer,/U8\(25\)\[b\*8\+bit\],PRODUCER_MEMORY_BANK/);assert.match(memoryCircuit,/#ifdef NATIVE_STAGE_PROFILE_NAMING/);
    assert.match(memoryBanks,/#define PREVIEW_FUNCTION preview_banks/);
    for(const anchor of ['U8(25)[b*8+bit],PRODUCER_MEMORY_BANK)','if(U8(26)[b])memory_pass_work[4]++;','if(U8(27)[b]){changed=1;memory_pass_work[5]++;}']){assert.equal(memoryCircuit.split(anchor).length-1,1,anchor);assert.ok(producer.includes(anchor),anchor);}
    const commitAnchor='#ifdef NATIVE_STAGE_ATTRIBUTION\n    STAGE_ADD(STAGE_MEMORY_COMMIT_BANKS,banks);STAGE_ADD(STAGE_MEMORY_COMMIT_STATE_WORD_COPIES,banks*WORDS);\n    #endif\n    for(u32 b=0;b<banks;b++) {';
    assert.match(producer,/name:'mislabelled memory producer'/);assert.match(owned,/name:'peer commit loop stops after first bank',pattern:'late peer-bank fault'/);assert.equal(memoryBanks.split(commitAnchor).length-1,1);assert.ok(owned.includes(commitAnchor.replaceAll('\n','\\n')));
});
test('stage counters aggregate preview writes and derive exact early-exit visit totals',()=>{const files={banks:source('src/experimental/wired-kernel/memory-banks.c'),memory:source('src/experimental/wired-kernel/memory-circuit.c'),phase:source('src/experimental/wired-kernel/phase-circuit.c'),bus:source('src/experimental/wired-kernel/bus-circuit.c')};
    assert.doesNotThrow(()=>assertDerivedStageCounterSources(files));
    const mutations=[['banks','#define PREVIEW_VISIT() stage_visited++;','#define PREVIEW_VISIT()'],['banks','PREVIEW_RETURN(error);','return error;'],
        ['memory','#ifdef NATIVE_STAGE_PROFILE_NAMING\n    if(!c[31]) {','#ifdef NATIVE_STAGE_PROFILE_NAMING\n    if(1) {'],
        ['memory','#ifdef NATIVE_STAGE_ATTRIBUTION\n    if(!c[31]) {','#ifdef NATIVE_STAGE_ATTRIBUTION\n    if(1) {'],
        ['memory','INLINE_MAPPING_FAILURE(2,i+1)','INLINE_MAPPING_FAILURE(2,i)'],
        ['memory','INLINE_MAPPING_FAILURE(3,banks*28+i*(i+1)/2+1)','INLINE_MAPPING_FAILURE(3,banks*28+i+1)'],
        ['memory','INLINE_MAPPING_FAILURE(4,banks*28+i*(i+1)/2+j+2)','INLINE_MAPPING_FAILURE(4,banks*28+i+j+2)'],
        ['memory','STAGE_ADD(STAGE_MEMORY_MAPPING_VISITS,banks*28+(banks*8)*(banks*8+1)/2)','STAGE_ADD(STAGE_MEMORY_MAPPING_VISITS,banks*28)'],
        ['memory','STAGE_ADD(STAGE_MEMORY_WRITER_PUBLICATIONS,publications);\n                    #endif\n                    fault[0]=1;fault[1]=2;return 1;',
            '(void)publications;\n                    #endif\n                    fault[0]=1;fault[1]=2;return 1;'],
        ['phase','40+i+1','40+i'],['bus','72+p[6]','72']];
    for(const [file,from,to] of mutations){const changed={...files,[file]:files[file].replace(from,to)};assert.notEqual(changed[file],files[file],from);assert.throws(()=>assertDerivedStageCounterSources(changed),undefined,from);}
});
test('legacy producer receipt keeps C and exact header provenance separate',()=>{const runner=source('scripts/measure-harris-hybrid-producers.mjs');assert.match(runner,/assert\.match\(path, \/\^src\\\/experimental\\\/wired-kernel\\\/\[a-z-\]\+\\\.c\$\//);assert.match(runner,/assert\.deepEqual\(Object\.keys\(build\.headerHashes \?\? \{\}\), \[headerPath\]\)/);
    assert.match(runner,/headerPath = 'src\/experimental\/wired-kernel\/stage-attribution\.h'/);assert.match(runner,/const headerHash = hash\(readFileSync/);assert.match(runner,/assert\.equal\(headerHash, build\.headerHashes\[headerPath\]/);assert.match(runner,/wasmSHA256: hash\(wasmBytes\), sourceHashes, headerHashes/);
});
