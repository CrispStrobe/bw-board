import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_REVISION,CANDIDATE_REVISION,LEGACY_WORK_COUNTERS,PRODUCERS,assertSparseReconciliation,
    interleavedOrder,summarize} from '../scripts/measure-harris-native-bus-output-sparse.mjs';

const workflow=readFileSync(new URL('../.github/workflows/harris-native-bus-output-sparse.yml',import.meta.url),'utf8');
const runner=readFileSync(new URL('../scripts/measure-harris-native-bus-output-sparse.mjs',import.meta.url),'utf8');
function contract(source){
    assert.equal(BASE_REVISION,'059a7c09838aaf3a83711bf4be552cfe589c15d5');
    assert.equal(CANDIDATE_REVISION,'d86c163147c7f4ecf7300dc0948f184b332de987');
    assert.match(source,/branches: \['perf\/native-bus-output-sparse', 'perf\/native-bus-output-sparse-\*'\]/);
    assert.match(source,/workflow_dispatch:/);assert.match(source,/runs-on: ubuntu-24\.04/);assert.match(source,/fetch-depth: 0/);
    for(const action of source.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
    for(const revision of [BASE_REVISION,CANDIDATE_REVISION])assert.equal((source.match(new RegExp(revision,'g'))??[]).length,2,revision);
    assert.equal((source.match(/git worktree add --detach/g)??[]).length,2);
    assert.equal((source.match(/scripts\/build-wired-net-kernel\.mjs/g)??[]).length,2);
    assert.match(source,/measure-harris-native-bus-output-sparse\.mjs --experimental/);
    assert.match(source,/--iterations=4096 --warmup-rounds=2 --rounds=12/);
    assert.match(source,/assert\.equal\(r\.measurementRevision,process\.env\.GITHUB_SHA\)/);
    assert.match(source,/assert\.ok\(r\.comparisonReduction>=\.25\)/);
    assert.match(source,/assert\.ok\(r\.pairedActiveThroughputRatio\.median>=1\.05\)/);
    assert.ok(source.includes('path: ${{ env.RECEIPT_DIR }}'));assert.doesNotMatch(source,/path: \$\{\{ env\.TREE_DIR \}\}/);
    assert.doesNotMatch(source,/continue-on-error: true|\|\| true/);
}
test('sparse output workflow builds adjacent exact revisions and enforces work and throughput gates',()=>contract(workflow));
test('performance receipt names and limits its admitted incremental scope',()=>{
    assert.match(runner,/workload:'owned-harris-store-loop-memory-only-admitted-incremental-native-bus-output-sparse'/);
    assert.match(runner,/admittedGraph:true,incrementalGraph:true/);
    assert.match(runner,/thresholds qualify only the explicitly selected admittedGraph:true, incrementalGraph:true path/);
    assert.match(runner,/not default checked-path performance evidence/);
});
test('workflow contract rejects weakened provenance, balance, thresholds, artifacts and failure handling',()=>{
    for(const mutant of [workflow.replace(BASE_REVISION,'0'.repeat(40)),workflow.replace(CANDIDATE_REVISION,'1'.repeat(40)),
        workflow.replace('git worktree add --detach "$CANDIDATE_TREE" "$CANDIDATE_SHA"','echo missing-candidate'),
        workflow.replace('node "$CANDIDATE_TREE/scripts/build-wired-net-kernel.mjs"','node scripts/missing-build.mjs'),
        workflow.replace('--warmup-rounds=2 --rounds=12','--warmup-rounds=1 --rounds=2'),
        workflow.replace('r.comparisonReduction>=.25','r.comparisonReduction>=0'),
        workflow.replace('r.pairedActiveThroughputRatio.median>=1.05','r.pairedActiveThroughputRatio.median>0'),
        workflow.replace('path: ${{ env.RECEIPT_DIR }}','path: ${{ env.TREE_DIR }}'),
        workflow.replace('timeout-minutes: 25','continue-on-error: true\n    timeout-minutes: 25')])assert.throws(()=>contract(mutant));
});
test('interleaving balances AB and BA after both warmup orders',()=>assert.deepEqual(interleavedOrder(2,2),[
    {phase:'warmup',round:1,order:['base','candidate']},{phase:'warmup',round:2,order:['candidate','base']},
    {phase:'measured',round:1,order:['base','candidate']},{phase:'measured',round:2,order:['candidate','base']} ]));
test('summary reports median and explicit dispersion',()=>{
    assert.deepEqual(summarize([1,2,3,4]),{samples:4,median:2.5,mad:1,q1:1.75,q3:3.25,min:1,max:4});
    assert.throws(()=>summarize([]),/nonempty/);assert.throws(()=>summarize([1,NaN]),/positive finite/);
});
test('reconciliation permits only skipped bus-output attempts and their aggregate comparisons',()=>{
    assert.equal(LEGACY_WORK_COUNTERS.length,12);assert.equal(PRODUCERS.length,9);
    const producers=Object.fromEntries(PRODUCERS.map(name=>[name,{attempts:name==='busOutput'?480:10,changes:name==='busOutput'?20:5}]));
    const work=Object.fromEntries(LEGACY_WORK_COUNTERS.map(name=>[name,name==='driverComparisons'?560:name==='valueChangingDriverWrites'?60:7]));
    const base={stateHash:'state',periods:10,retired:3,writes:[1,1],physicalClock:77,chunks:1,yields:0,work,
        producerWork:{producers,memory:{passes:4}}};
    const candidate=structuredClone(base);candidate.producerWork.producers.busOutput.attempts=20;candidate.work.driverComparisons=100;
    assert.equal(assertSparseReconciliation(candidate,base),460/560);
    for(const mutate of [x=>x.work.valueChangingDriverWrites++,x=>x.producerWork.producers.busOutput.changes++,
        x=>x.producerWork.producers.busExternal.attempts++,x=>x.producerWork.memory.passes++,x=>x.stateHash='wrong']){
        const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>assertSparseReconciliation(bad,base));
    }
});
