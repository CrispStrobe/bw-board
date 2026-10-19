import {test} from 'node:test';
import assert from 'node:assert/strict';
import {COUNTERS, validateCensus} from '../scripts/lib/fastpath-census-receipt.mjs';
const blank = () => Object.fromEntries(COUNTERS.map(name => [name, 0]));

test('empty census reports unavailable fractions, not zero-cost claims', () => {
    assert.deepEqual(validateCensus(blank()), {fastZeroFraction: null, blockZeroFraction: null,
        gpioNoEdgeFraction: null, countedRetired: 0});
});
test('valid mixed progress and rejection census has no performance verdict', () => {
    const counts = {...blank(), FastCalls: 4, FastZero: 2, FastColdEntry: 1, FastRetired: 10,
        BlockCalls: 3, BlockZero: 2, BlockMemoizedMisses: 1, BlockDiscovered: 2,
        BlockCompileAttempts: 2, BlockExecutionRejects: 1, BlockRetired: 4,
        CachedRunCalls: 2, CachedRunZero: 1, CachedRunExecutionRejects: 1, CachedRunRetired: 6,
        OrdinaryRetired: 2, GpioColdCalls: 10, GpioNoEdgeDevices: 10};
    assert.deepEqual(validateCensus(counts), {fastZeroFraction: 0.5, blockZeroFraction: 2 / 3,
        gpioNoEdgeFraction: 1, countedRetired: 12});
});
test('reject schema drift and unsafe or inconsistent counts', () => {
    for (const mutation of [counts => delete counts.FastCalls, counts => counts.Extra = 0,
        counts => counts.FastCalls = -1, counts => counts.FastCalls = 0.5,
        counts => counts.FastCalls = Number.MAX_SAFE_INTEGER + 1,
        counts => counts.FastZero = 1, counts => counts.BlockRetired = 1,
        counts => counts.CachedRunCalls = 1, counts => counts.GpioHostedServices = 1]) {
        const counts = blank();
        mutation(counts);
        assert.throws(() => validateCensus(counts));
    }
});
