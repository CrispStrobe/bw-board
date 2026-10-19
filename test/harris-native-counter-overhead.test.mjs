import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BASE_REVISION, COUNTER_REVISION, LEGACY_WORK_COUNTERS, assertSameSemanticReceipt,
    interleavedOrder, summarize} from '../scripts/measure-harris-native-counter-overhead.mjs';

const workflow = readFileSync(new URL('../.github/workflows/harris-native-counter-overhead.yml', import.meta.url), 'utf8');

function workflowContract(source) {
    assert.equal(BASE_REVISION, 'a26853ad946edb05e4d3192298207c25437129fa');
    assert.equal(COUNTER_REVISION, '9b35e08d25a972dcf51b214a054195a7430a3c0e');
    assert.match(source, /branches: \['measure\/native-counter-overhead', 'measure\/native-counter-overhead-\*'\]/);
    assert.match(source, /workflow_dispatch:/);
    assert.match(source, /runs-on: ubuntu-24\.04/);
    assert.match(source, /fetch-depth: 0/);
    assert.match(source, /harris-counter-overhead\.XXXXXX/);
    assert.match(source, /harris-counter-trees\.XXXXXX/);
    for (const action of source.matchAll(/uses: [^@\s]+@([^\s]+)/g)) assert.match(action[1], /^[0-9a-f]{40}$/);
    for (const revision of [BASE_REVISION, COUNTER_REVISION])
        assert.equal((source.match(new RegExp(revision, 'g')) ?? []).length, 2, `${revision}: assignment and receipt assertion`);
    assert.equal((source.match(/git worktree add --detach/g) ?? []).length, 2);
    assert.equal((source.match(/scripts\/build-wired-net-kernel\.mjs/g) ?? []).length, 2);
    assert.match(source, /measure-harris-native-counter-overhead\.mjs --experimental/);
    assert.doesNotMatch(source, /measure-harris-hybrid-producers\.mjs/);
    assert.match(source, /--warmup-rounds=2 --rounds=10/);
    assert.match(source, /--batch-periods=8192 --wall-budget-ms=1000/);
    assert.match(source, /assert\.equal\(r\.measurementRevision,process\.env\.GITHUB_SHA\)/);
    assert.match(source, /assert\.equal\(r\.warmups\.length,4\)/);
    assert.match(source, /assert\.equal\(r\.samples\.length,20\)/);
    assert.match(source, /assert\.equal\(Object\.keys\(r\.expected\.work\)\.length,12\)/);
    assert.ok(source.includes('path: ${{ env.OVERHEAD_DIR }}'));
    assert.doesNotMatch(source, /path: \$\{\{ env\.TREE_DIR \}\}/);
    assert.doesNotMatch(source, /continue-on-error: true|\|\| true/);
}

test('overhead workflow builds both exact revisions and measures them in one job', () => {
    assert.doesNotThrow(() => workflowContract(workflow));
});

test('workflow contract rejects weakened identity, pairing, receipt and failure gates', () => {
    for (const mutant of [
        workflow.replace(BASE_REVISION, '0000000000000000000000000000000000000000'),
        workflow.replace(COUNTER_REVISION, '1111111111111111111111111111111111111111'),
        workflow.replace('git worktree add --detach "$COUNTER_TREE" "$COUNTER_SHA"', 'echo missing-counter-tree'),
        workflow.replace('node "$COUNTER_TREE/scripts/build-wired-net-kernel.mjs"', 'node scripts/missing-build.mjs'),
        workflow.replace('measure-harris-native-counter-overhead.mjs', 'missing-overhead.mjs'),
        workflow.replace('--warmup-rounds=2 --rounds=10', '--warmup-rounds=1 --rounds=2'),
        workflow.replace('assert.equal(r.measurementRevision,process.env.GITHUB_SHA)', 'void r.measurementRevision'),
        workflow.replace('Object.keys(r.expected.work).length,12', 'Object.keys(r.expected.work).length,11'),
        workflow.replace('path: ${{ env.OVERHEAD_DIR }}', 'path: ${{ env.TREE_DIR }}'),
        workflow.replace('timeout-minutes: 20', 'continue-on-error: true\n    timeout-minutes: 20')
    ]) assert.throws(() => workflowContract(mutant));
});

test('interleaving balances order after both AB and BA warmups', () => {
    assert.deepEqual(interleavedOrder(2, 4), [
        {phase: 'warmup', round: 1, order: ['base', 'counter']},
        {phase: 'warmup', round: 2, order: ['counter', 'base']},
        {phase: 'measured', round: 1, order: ['base', 'counter']},
        {phase: 'measured', round: 2, order: ['counter', 'base']},
        {phase: 'measured', round: 3, order: ['base', 'counter']},
        {phase: 'measured', round: 4, order: ['counter', 'base']}
    ]);
});

test('summary reports median and explicit dispersion', () => {
    assert.deepEqual(summarize([1, 2, 3, 4]), {samples: 4, median: 2.5, mad: 1, q1: 1.75, q3: 3.25, min: 1, max: 4});
    assert.throws(() => summarize([]), /nonempty/);
    assert.throws(() => summarize([1, Number.NaN]), /positive finite/);
});

test('semantic reconciliation holds every required field and all twelve legacy counters', () => {
    assert.equal(LEGACY_WORK_COUNTERS.length, 12);
    const receipt = {stateHash: 'state', periods: 57, retired: 6, writes: [2, 2], physicalClock: 124, chunks: 8, yields: 7,
        work: Object.fromEntries(LEGACY_WORK_COUNTERS.map((name, index) => [name, index + 1]))};
    assert.doesNotThrow(() => assertSameSemanticReceipt(structuredClone(receipt), receipt));
    for (const name of ['stateHash', 'periods', 'retired', 'writes', 'physicalClock', 'chunks', 'yields']) {
        const mutant = structuredClone(receipt);
        mutant[name] = name === 'writes' ? [2, 3] : name === 'stateHash' ? 'wrong' : mutant[name] + 1;
        assert.throws(() => assertSameSemanticReceipt(mutant, receipt), /all legacy counters must match/, name);
    }
    for (const name of LEGACY_WORK_COUNTERS) {
        const mutant = structuredClone(receipt); mutant.work[name]++;
        assert.throws(() => assertSameSemanticReceipt(mutant, receipt), /all legacy counters must match/, name);
    }
});
