import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_REVISION,CANDIDATE_REVISION,LEGACY_WORK_COUNTERS,NATIVE_SOURCES,PRODUCERS,
    assertBusAdmissionReconciliation,interleavedOrder,selectionDecision,summarize}
    from '../scripts/measure-harris-native-bus-admission.mjs';

const source=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

function semantic(candidate=false){
    const producerWork={producers:Object.fromEntries(PRODUCERS.map(name=>[name,{attempts:name==='busExternal'?100:0,changes:0}])),
        memory:{settleCalls:12,passes:20,previewCalls:20,previewBanks:80,presentBanks:8,changedBanks:4,
            postMemorySettles:20,postMemorySettlesWithoutDriverChange:16,ownedPreviewCalls:20,
            checkedValidationBanks:0,checkedValidationPinRecords:0}};
    const zero={attempts:0,admissions:0,failures:0,inputMapVisits:0,outputMapVisits:0,externalMapVisits:0};
    return {stateHash:'state',componentHashes:{cpu:'a',bus:'b',phase:'c',lifecycle:'d',nets:'e',memory:{}},periods:10,
        retired:7,writes:[1,1],physicalClock:77,chunks:1,yields:0,
        work:Object.fromEntries(LEGACY_WORK_COUNTERS.map(name=>[name,0])),producerWork,
        busAdmissionAtConstruction:candidate?{attempts:1,admissions:1,failures:0,inputMapVisits:24,outputMapVisits:48,externalMapVisits:10}:null,
        busAdmissionAfterInitialize:candidate?zero:null,busAdmissionAfterRun:candidate?zero:null};
}

test('bus-admission measurement pins exact revisions, source closure and alternating pairs',()=>{
    assert.equal(BASE_REVISION,'0e80e9ff044898bead53114c420ba8055f054ace');
    assert.equal(CANDIDATE_REVISION,'9550bfb49c23ae770e188569fe52476deb8d22ff');
    assert.equal(LEGACY_WORK_COUNTERS.length,12);assert.equal(PRODUCERS.length,9);assert.equal(NATIVE_SOURCES.length,9);
    assert.deepEqual(interleavedOrder(2,2).map(x=>x.order),[
        ['base','candidate'],['candidate','base'],['base','candidate'],['candidate','base']]);
});

test('bus-admission reconciliation preserves semantics and proves removed versus retained work',()=>{
    assert.deepEqual(assertBusAdmissionReconciliation(semantic(true),semantic(false)),
        {immutableMapComparisonsRemoved:820,liveLevelComparisonsRetained:100});
    for(const field of ['stateHash','componentHashes','work','producerWork','busAdmissionAtConstruction','busAdmissionAfterInitialize','busAdmissionAfterRun']){
        const candidate=structuredClone(semantic(true));
        if(field==='stateHash')candidate[field]='wrong';
        else if(field==='componentHashes')candidate[field].bus='wrong';
        else if(field==='work')candidate[field].deltas++;
        else if(field==='producerWork')candidate[field].producers.busExternal.attempts++;
        else candidate[field]=null;
        assert.throws(()=>assertBusAdmissionReconciliation(candidate,semantic(false)),undefined,field);
    }
});

test('bus-admission selection gate is fixed before hosted measurement',()=>{
    assert.equal(summarize([1,2,3]).median,2);
    assert.deepEqual(selectionDecision({median:1.05,q1:1,min:.98}),
        {accepted:true,thresholds:{median:1.05,q1:1,min:.98},checks:{median:true,q1:true,min:true}});
    for(const value of [{median:1.049,q1:1,min:1},{median:1.06,q1:.999,min:1},{median:1.06,q1:1,min:.979}])
        assert.equal(selectionDecision(value).accepted,false);
});

test('hosted evidence serializes raw pairs before workflow gates and discloses scope',()=>{
    const runner=source('scripts/measure-harris-native-bus-admission.mjs'),workflow=source('.github/workflows/harris-native-bus-admission.yml');
    assert.match(runner,/console\.log\(JSON\.stringify\(/);assert.doesNotMatch(runner,/if\(!decision\.accepted\).*throw/);
    for(const phrase of ['raw callers retain full per-call map validation','Every mutable external 0/1/X/Z level',
        'Phase validation','no DOS, peripherals'])assert.ok(runner.includes(phrase),phrase);
    assert.match(workflow,/native-bus-admission\.json/);assert.match(workflow,/decision\.accepted,true/);
    assert.match(workflow,/pairedActiveThroughputRatio\.median>=1\.05/);
    assert.match(workflow,/pairedActiveThroughputRatio\.q1>=1/);assert.match(workflow,/pairedActiveThroughputRatio\.min>=\.98/);
    for(const action of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
});
