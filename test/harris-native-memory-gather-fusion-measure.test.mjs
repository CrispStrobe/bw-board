import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_REVISION,CANDIDATE_REVISION,LEGACY_WORK_COUNTERS,NATIVE_SOURCES,PRODUCERS,
    assertFusionReconciliation,interleavedOrder,selectionDecision,summarize}
    from '../scripts/measure-harris-native-memory-gather-fusion.mjs';
import {MUTATIONS} from '../scripts/verify-harris-native-memory-gather-fusion-mutations.mjs';

const source=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

function semantic(){
    const producerWork={producers:Object.fromEntries(PRODUCERS.map(name=>[name,{attempts:0,changes:0}])),
        memory:{settleCalls:12,passes:20,previewCalls:20,previewBanks:80,presentBanks:8,changedBanks:4,
            postMemorySettles:20,postMemorySettlesWithoutDriverChange:16,ownedPreviewCalls:20,
            checkedValidationBanks:0,checkedValidationPinRecords:0}};
    const admission={attempts:1,admissions:1,failures:0,inputMapVisits:112,outputMapVisits:32,
        outputAliasComparisons:496,protectionVisits:4,runtimeMapVisits:0};
    return {stateHash:'state',componentHashes:{cpu:'a',bus:'b',phase:'c',lifecycle:'d',nets:'e',memory:{}},periods:10,
        retired:7,writes:[1,1],physicalClock:77,chunks:1,yields:0,
        work:Object.fromEntries(LEGACY_WORK_COUNTERS.map(name=>[name,0])),producerWork,
        memoryAdmissionAtConstruction:admission,memoryAdmissionAfterInitialize:admission,memoryAdmissionAfterRun:admission};
}

test('memory-input fusion measurement pins exact revisions, source closure and alternating pairs',()=>{
    assert.equal(BASE_REVISION,'0e80e9ff044898bead53114c420ba8055f054ace');
    assert.equal(CANDIDATE_REVISION,'c743e8501c82394aad9590c43bd958020a0f0ead');
    assert.equal(LEGACY_WORK_COUNTERS.length,12);assert.equal(PRODUCERS.length,9);assert.equal(NATIVE_SOURCES.length,9);
    assert.deepEqual(interleavedOrder(2,2).map(x=>x.order),[
        ['base','candidate'],['candidate','base'],['base','candidate'],['candidate','base']]);
});

test('memory-input fusion reconciliation preserves semantics and proves avoided versus retained work',()=>{
    assert.deepEqual(assertFusionReconciliation(semantic(),semantic()),
        {intermediateInputCopiesAvoided:4480,liveMappedInputReadsRetained:4480});
    for(const field of ['stateHash','componentHashes','work','producerWork','memoryAdmissionAtConstruction','memoryAdmissionAfterInitialize','memoryAdmissionAfterRun']){
        const candidate=structuredClone(semantic());
        if(field==='stateHash')candidate[field]='wrong';
        else if(field==='componentHashes')candidate[field].bus='wrong';
        else if(field==='work')candidate[field].deltas++;
        else if(field==='producerWork')candidate[field].producers.busExternal.attempts++;
        else candidate[field]=null;
        assert.throws(()=>assertFusionReconciliation(candidate,semantic()),undefined,field);
    }
});

test('memory-input fusion selection gate is fixed before hosted measurement',()=>{
    assert.equal(summarize([1,2,3]).median,2);
    assert.deepEqual(selectionDecision({median:1.05,q1:1,min:.98}),
        {accepted:true,thresholds:{median:1.05,q1:1,min:.98},checks:{median:true,q1:true,min:true}});
    for(const value of [{median:1.049,q1:1,min:1},{median:1.06,q1:.999,min:1},{median:1.06,q1:1,min:.979}])
        assert.equal(selectionDecision(value).accepted,false);
});

test('every memory-input fusion mutant has one exact production selector and a named red',()=>{
    assert.equal(MUTATIONS.length,7);assert.equal(new Set(MUTATIONS.map(x=>x.name)).size,7);
    for(const mutation of MUTATIONS){
        const production=source(`src/experimental/wired-kernel/${mutation.file}`);
        assert.equal(production.split(mutation.from).length-1,1,mutation.name);
        assert.ok(mutation.pattern);assert.notEqual(mutation.from,mutation.to);
    }
});

test('hosted evidence serializes raw pairs before workflow gates and discloses scope',()=>{
    const runner=source('scripts/measure-harris-native-memory-gather-fusion.mjs'),workflow=source('.github/workflows/harris-native-memory-gather-fusion.yml');
    assert.match(runner,/console\.log\(JSON\.stringify\(/);assert.doesNotMatch(runner,/if\(!decision\.accepted\).*throw/);
    for(const phrase of ['raw callers retain their copied snapshot','every live level and conflict',
        'Phase and bus validation','no DOS, peripherals'])assert.ok(runner.includes(phrase),phrase);
    assert.match(workflow,/native-memory-input-fusion\.json/);assert.match(workflow,/decision\.accepted,true/);
    assert.match(workflow,/pairedActiveThroughputRatio\.median>=1\.05/);
    assert.match(workflow,/pairedActiveThroughputRatio\.q1>=1/);assert.match(workflow,/pairedActiveThroughputRatio\.min>=\.98/);
    for(const action of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
});
