import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertAdmittedPreviewReconciliation,BASE_REVISION,CANDIDATE_REVISION,interleavedOrder,summarize}
    from '../scripts/measure-harris-native-admitted-memory-preview.mjs';

const legacy=['driverComparisons','valueChangingDriverWrites','dirtyNetResolutions','netDriverVisits','evaluatorRows',
    'dependencyProbes','stagedDriverCopies','committedEvaluatorOutputs','publishNetCopies','deltas','reverseIndexVisits',
    'operationBitsetWordVisits'];
const producers=['other','busExternal','busOutput','phaseController','phaseLatch','memoryBank','phaseSchedule','evaluator','fullScan'];
const receipt=extended=>({stateHash:'same',periods:7,retired:5,writes:[1,1],physicalClock:74,chunks:1,yields:0,
    work:Object.fromEntries(legacy.map((name,index)=>[name,index+1])),producerWork:{
        producers:Object.fromEntries(producers.map((name,index)=>[name,{attempts:index,changes:index%2}])),
        memory:{settleCalls:2,passes:3,previewCalls:3,previewBanks:12,presentBanks:8,changedBanks:2,
            postMemorySettles:3,postMemorySettlesWithoutDriverChange:1,...extended}}});

test('admitted preview receipt preserves semantics and all legacy counters while proving the bypass',()=>{
    const base=receipt(),candidate=receipt({ownedPreviewCalls:3,checkedValidationBanks:0,checkedValidationPinRecords:0});
    assert.equal(assertAdmittedPreviewReconciliation(candidate,base),336);
    for(const bad of [
        {...candidate,stateHash:'different'},
        {...candidate,work:{...candidate.work,deltas:99}},
        receipt({ownedPreviewCalls:2,checkedValidationBanks:0,checkedValidationPinRecords:0}),
        receipt({ownedPreviewCalls:3,checkedValidationBanks:1,checkedValidationPinRecords:28})
    ])assert.throws(()=>assertAdmittedPreviewReconciliation(bad,base));
});

test('measurement uses balanced AB/BA rounds and reports robust dispersion',()=>{
    assert.deepEqual(interleavedOrder(1,2).map(group=>group.order),[
        ['base','candidate'],['candidate','base'],['base','candidate']]);
    assert.deepEqual(summarize([1,2,3]),{samples:3,median:2,mad:1,q1:1.5,q3:2.5,min:1,max:3});
});

test('hosted workflow pins exact source revisions and enforces the declared performance gate',()=>{
    const source=readFileSync(new URL('../.github/workflows/harris-native-admitted-memory-preview.yml',import.meta.url),'utf8');
    assert.ok(source.includes(`BASE_SHA=${BASE_REVISION}`));assert.ok(source.includes(`CANDIDATE_SHA=${CANDIDATE_REVISION}`));
    assert.match(source,/--warmup-rounds=2 --rounds=12/);
    assert.match(source,/validationPinRecordReduction===12626432/);
    assert.match(source,/pairedActiveThroughputRatio\.median>=1\.05/);
    for(const action of source.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
    assert.doesNotMatch(source,/continue-on-error: true|\|\| true/);
});
