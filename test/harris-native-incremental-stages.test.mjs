import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STAGES,agree,classify,gate} from '../scripts/classify-harris-native-incremental-stages.mjs';
import {BASE_REVISION,CANDIDATE_REVISION,WORK,assertManifestShape,neutrality,summary} from '../scripts/measure-harris-native-incremental-stages.mjs';
import {MUTATIONS} from '../scripts/verify-harris-native-incremental-stage-mutations.mjs';

const source=readFileSync(new URL('../src/experimental/wired-kernel/incremental-nets.c',import.meta.url),'utf8');
const build=readFileSync(new URL('../scripts/build-wired-net-kernel.mjs',import.meta.url),'utf8');
const workflow=readFileSync(new URL('../.github/workflows/harris-native-incremental-stages.yml',import.meta.url),'utf8');

function profile(counts={stage:[40,30,20,10],runtime:5,unresolved:5,extraSettle:0}){
    const nodes=[{id:1,callFrame:{functionName:'settle_incremental_context',url:'wasm://wasm/kernel'},children:[2,3,4,5]}];
    STAGES.forEach((name,index)=>nodes.push({id:index+2,callFrame:{functionName:name,url:'wasm://wasm/kernel'}}));
    nodes.push({id:6,callFrame:{functionName:'runMicrotasks',url:'node:internal/process/task_queues'}});
    nodes.push({id:7,callFrame:{functionName:'mystery',url:'extension://unknown'}});
    return {nodes,samples:[...counts.stage.flatMap((count,index)=>Array(count).fill(index+2)),...Array(counts.extraSettle??0).fill(1),...Array(counts.runtime).fill(6),...Array(counts.unresolved).fill(7)]};
}

test('dedicated flag names exactly four incremental boundaries and leaves global naming separate',()=>{
    assert.equal(STAGES.length,4);
    for(const mutation of MUTATIONS){
        assert.equal(source.split(`#define ${mutation.selector} ${mutation.target}`).length-1,1);
        assert.ok(STAGES.includes(mutation.target));
    }
    assert.match(source,/if\(changed==NONE\)return 0x80000007u;\s*if\(changed==NONE-1\)return 0x80000002u;/);
    assert.match(build,/NATIVE_INCREMENTAL_STAGE_PROFILE_NAMING must be 1 when present/);
    assert.match(build,/incrementalStageProfileNames/);
    assert.match(build,/global and incremental stage profile naming are mutually exclusive/);
    assert.match(build,/-DNATIVE_INCREMENTAL_STAGE_PROFILE_NAMING=1/);
    assert.equal(BASE_REVISION,'d11fb2e1f0af8f030cf3951bc96abb79b39b35e3');
    assert.equal(CANDIDATE_REVISION,'4779a8ca51c05051ed50e1e04dfcbe11dc922ae5');
    assert.equal(WORK.length,12);
});

test('neutrality gate requires median, lower quartile, and minimum inside the fixed symmetric band',()=>{
    assert.deepEqual(summary([.99,1,1.01,1.02]),{samples:4,median:1.005,mad:.010000000000000009,q1:.9975,q3:1.0125,min:.99,max:1.02});
    assert.equal(neutrality(summary([.99,1,1.01])).accepted,true);
    for(const values of [[.97,1,1.01],[.99,1.03,1.03],[.97,.98,.99]])assert.equal(neutrality(summary(values)).accepted,false);
    assert.throws(()=>summary([]));
    assert.throws(()=>summary([1,Number.NaN]));
});

test('manifest provenance rejects missing, extra, and wrong diagnostic inputs',()=>{
    const names=['net-resolver.c','memory-banks.c','memory-circuit.c','phase-components.c','phase-circuit.c','phase-schedule.c','incremental-nets.c','bus-sequencer.c','bus-circuit.c'].map(name=>`src/experimental/wired-kernel/${name}`);
    const manifest={stageProfileNames:false,stageAttribution:false,incrementalStageProfileNames:true,args:['-O3','-DNATIVE_INCREMENTAL_STAGE_PROFILE_NAMING=1'],sourceHashes:Object.fromEntries(names.map(name=>[name,'hash'])),headerHashes:{'src/experimental/wired-kernel/stage-attribution.h':'hash'}};
    assert.doesNotThrow(()=>assertManifestShape(manifest,true));
    for(const mutant of [
        {...manifest,sourceHashes:Object.fromEntries(Object.entries(manifest.sourceHashes).slice(1))},
        {...manifest,sourceHashes:{...manifest.sourceHashes,'src/extra.c':'hash'}},
        {...manifest,headerHashes:{...manifest.headerHashes,'src/extra.h':'hash'}},
        {...manifest,args:[...manifest.args,'-DNATIVE_STAGE_PROFILE_NAMING=1']},
        {...manifest,incrementalStageProfileNames:false},
    ])assert.throws(()=>assertManifestShape(mutant,true));
});

test('classifier is exhaustive and accepts three resolved actionable profiles with one stable winner',()=>{
    const values=[profile(),profile({stage:[41,29,20,10],runtime:5,unresolved:5}),profile({stage:[42,28,20,10],runtime:5,unresolved:5})].map(classify);
    for(const value of values){
        assert.equal(Object.values(value.categories).reduce((a,b)=>a+b,0),value.total);
        assert.ok(value.resolvedShare>=.90);
        assert.ok(value.actionableShare>=.70);
        assert.equal(value.settleInclusive,100);
        assert.equal(value.fourStageSelf,100);
    }
    assert.equal(agree(values).winner,STAGES[0]);
});

test('classifier fails closed on unknown stages and every classification or selection weakness',()=>{
    const unknown=profile();unknown.nodes[1].callFrame.functionName='incremental_stage_unknown';
    assert.throws(()=>classify(unknown),/unknown incremental stage/);
    assert.throws(()=>gate(classify(profile({stage:[40,30,20,10],runtime:5,unresolved:20}))),/resolved share/);
    assert.throws(()=>gate(classify(profile({stage:[40,30,20,10],runtime:50,unresolved:0}))),/actionable share/);
    assert.throws(()=>gate(classify(profile({stage:[20,20,20,20],runtime:5,unresolved:0}))),/settle inclusive/);
    assert.throws(()=>gate(classify(profile({stage:[8,7,7,7],runtime:5,unresolved:0,extraSettle:71}))),/four-stage self samples/);
    assert.throws(()=>gate(classify(profile({stage:[34,33,33,0],runtime:5,unresolved:0,extraSettle:0}))),/absent/);
    assert.throws(()=>gate(classify(profile({stage:[14,14,14,14],runtime:5,unresolved:0,extraSettle:44}))),/winner sample minimum/);
    const a=classify(profile()),b=classify(profile({stage:[30,40,20,10],runtime:5,unresolved:5}));
    assert.throws(()=>agree([a,b,a]),/rank-one stage disagreement/);
});

test('workflow freezes exact source and evidence envelopes, gates before three profiles, and inventories artifacts',()=>{
    assert.match(workflow,/branches: \['evidence\/native-incremental-stages', 'evidence\/native-incremental-stages-\*'\]/);
    for(const action of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
    for(const revision of [BASE_REVISION,CANDIDATE_REVISION])assert.ok(workflow.includes(revision));
    assert.match(workflow,/NATIVE_INCREMENTAL_STAGE_PROFILE_NAMING=1/);
    assert.match(workflow,/mapped preview remains selected/);
    assert.match(workflow,/cmp .*base-build\/wired-net-kernel\.wasm.*off-build\/wired-net-kernel\.wasm/);
    assert.match(workflow,/--warmups=4 --rounds=12/);
    assert.match(workflow,/assert\.equal\(r\.decision\.accepted,true\)/);
    assert.match(workflow,/for run in 1 2 3/);
    assert.ok(workflow.indexOf('assert.equal(r.decision.accepted,true)')<workflow.indexOf('for run in 1 2 3'));
    assert.match(workflow,/verify-harris-native-incremental-stage-mutations\.mjs/);
    assert.match(workflow,/test "\$\(grep -c '\^# mutation rejected:' .*\)" -eq 4/);
    assert.match(workflow,/artifact-manifest\.json/);
    assert.doesNotMatch(workflow,/continue-on-error: true|\|\| true/);
});
