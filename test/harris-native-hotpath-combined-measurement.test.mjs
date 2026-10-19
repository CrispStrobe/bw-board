import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertCombinedReconciliation,BASE_REVISION,CANDIDATE_REVISION,interleavedOrder,summarize}
    from '../scripts/measure-harris-native-hotpath-combined.mjs';

const legacy=['driverComparisons','valueChangingDriverWrites','dirtyNetResolutions','netDriverVisits','evaluatorRows',
    'dependencyProbes','stagedDriverCopies','committedEvaluatorOutputs','publishNetCopies','deltas','reverseIndexVisits',
    'operationBitsetWordVisits'];
const producerNames=['other','busExternal','busOutput','phaseController','phaseLatch','memoryBank','phaseSchedule','evaluator','fullScan'];
const receipt=({candidate=false}={})=>({stateHash:'same',periods:7,retired:5,writes:[1,1],physicalClock:74,chunks:1,yields:0,
    work:Object.fromEntries(legacy.map((name,index)=>[name,name==='driverComparisons'?(candidate?184:500):index+1])),
    producerWork:{producers:Object.fromEntries(producerNames.map((name,index)=>[name,name==='busOutput'?
        {attempts:candidate?20:336,changes:20}:{attempts:index,changes:index%2}])),memory:{settleCalls:2,passes:3,
        previewCalls:3,previewBanks:12,presentBanks:8,changedBanks:2,postMemorySettles:3,
        postMemorySettlesWithoutDriverChange:1,...candidate&&{ownedPreviewCalls:3,checkedValidationBanks:0,
            checkedValidationPinRecords:0}}}});

test('combined receipt independently reconciles sparse bus writes and admitted memory validation',()=>{
    const base=receipt(),candidate=receipt({candidate:true});
    assert.deepEqual(assertCombinedReconciliation(candidate,base),{
        comparisonReduction:316/500,skippedBusOutputAttempts:316,validationPinRecordReduction:336});
    for(const bad of [
        {...candidate,stateHash:'different'},
        {...candidate,work:{...candidate.work,deltas:99}},
        {...candidate,producerWork:{...candidate.producerWork,producers:{...candidate.producerWork.producers,
            busOutput:{attempts:21,changes:20}}}},
        {...candidate,producerWork:{...candidate.producerWork,memory:{...candidate.producerWork.memory,checkedValidationBanks:1}}}
    ])assert.throws(()=>assertCombinedReconciliation(bad,base));
});

test('combined measurement preserves balanced order and robust dispersion',()=>{
    assert.deepEqual(interleavedOrder(1,2).map(group=>group.order),[
        ['base','candidate'],['candidate','base'],['base','candidate']]);
    assert.deepEqual(summarize([1,2,3]),{samples:3,median:2,mad:1,q1:1.5,q3:2.5,min:1,max:3});
});

test('combined hosted workflow pins exact sources and retains the unchanged stop gate',()=>{
    const source=readFileSync(new URL('../.github/workflows/harris-native-hotpath-combined.yml',import.meta.url),'utf8');
    assert.ok(source.includes(`BASE_SHA=${BASE_REVISION}`));assert.ok(source.includes(`CANDIDATE_SHA=${CANDIDATE_REVISION}`));
    assert.match(source,/--warmup-rounds=2 --rounds=12/);assert.match(source,/comparisonReduction>=\.25/);
    assert.match(source,/validationPinRecordReduction,25242112/);
    assert.match(source,/pairedActiveThroughputRatio\.median>=1\.05/);
    for(const action of source.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
    assert.doesNotMatch(source,/continue-on-error: true|\|\| true/);
});
