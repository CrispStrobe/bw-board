import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_REVISION,CANDIDATE_REVISION,HEADER_PATH,assertAdmissionCounters,assertAdmissionReconciliation,assertHeaderHashes,
    collectJSImportClosure,interleavedOrder,summarize}
    from '../scripts/measure-harris-native-system-admission.mjs';

const semantic=()=>({stateHash:'same',periods:7,retired:3,physicalClock:74,chunks:1,yields:0,writes:[1,1],
    work:{driverComparisons:9,deltas:4},producerWork:{producers:{memoryBank:{attempts:8,changes:2}},memory:{passes:3}}});

test('memory admission A/B requires exact semantic and work equality',()=>{
    const base=semantic(),candidate=structuredClone(base);assert.doesNotThrow(()=>assertAdmissionReconciliation(candidate,base));
    for(const mutate of [r=>r.periods++,r=>r.writes[0]++,r=>r.work.deltas++,r=>r.producerWork.memory.passes++]){
        const bad=structuredClone(candidate);mutate(bad);assert.throws(()=>assertAdmissionReconciliation(bad,base));
    }
});

test('memory admission A/B order and dispersion are deterministic',()=>{
    assert.deepEqual(interleavedOrder(1,2).map(group=>group.order),[['base','candidate'],['candidate','base'],['base','candidate']]);
    assert.deepEqual(summarize([1,2,3]),{samples:3,median:2,mad:1,q1:1.5,q3:2.5,min:1,max:3});
});

test('memory admission provenance fails closed on missing, extra or wrong native headers',()=>{
    assert.deepEqual(assertHeaderHashes({[HEADER_PATH]:'abc'},'abc'),{[HEADER_PATH]:'abc'});
    for(const value of [{},{[HEADER_PATH]:'bad'},{[HEADER_PATH]:'abc',extra:'abc'}])assert.throws(()=>assertHeaderHashes(value,'abc'));
});

test('memory admission evidence fixes exact work units and follows the runtime JS import closure',()=>{
    assert.deepEqual(assertAdmissionCounters({attempts:1,admissions:1,failures:0,inputMapVisits:112,outputMapVisits:32,
        outputAliasComparisons:496,protectionVisits:4,runtimeMapVisits:0}),{attempts:1,admissions:1,failures:0,
        inputMapVisits:112,outputMapVisits:32,outputAliasComparisons:496,protectionVisits:4,runtimeMapVisits:0});
    const root=new URL('..',import.meta.url).pathname,closure=collectJSImportClosure(root,['src/experimental/harris-native-memory-board.js']);
    for(const path of ['src/experimental/wired-kernel/memory-circuit.js','src/experimental/wired-kernel/phase-circuit-image.js',
        'src/experimental/wired-kernel/bus-circuit-image.js'])assert.ok(closure.includes(path),path);
    assert.throws(()=>assertAdmissionCounters({attempts:1,runtimeMapVisits:0}));
});

test('hosted admission workflow pins exact source commits and unchanged decision gates',()=>{
    const source=readFileSync(new URL('../.github/workflows/harris-native-system-admission.yml',import.meta.url),'utf8');
    assert.ok(source.includes(`BASE_SHA=${BASE_REVISION}`));assert.ok(source.includes(`CANDIDATE_SHA=${CANDIDATE_REVISION}`));
    assert.match(source,/--warmup-rounds=2 --rounds=12/);assert.match(source,/activeRatio\.median>=1\.10/);
    assert.match(source,/NATIVE_STAGE_ATTRIBUTION=1/);assert.match(source,/--attribution-wasm=/);
    assert.match(source,/baseRepeatedMapVisits:91788800/);assert.match(source,/artifact-manifest\.json/);
    assert.match(source,/activeRatio\.q1>=1\.05/);assert.match(source,/activeRatio\.min>=1/);
    for(const action of source.matchAll(/uses: [^@\s]+@([^\s]+)/g))assert.match(action[1],/^[0-9a-f]{40}$/);
    assert.doesNotMatch(source,/continue-on-error: true|\|\| true/);
});
