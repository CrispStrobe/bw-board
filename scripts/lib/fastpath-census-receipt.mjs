import assert from 'node:assert/strict';

export const COUNTERS = Object.freeze([
    'FastCalls', 'FastColdEntry', 'FastZero', 'FastRetired',
    'BlockCalls', 'BlockCacheHits', 'BlockMemoizedMisses', 'BlockAdmissionRejects',
    'BlockCompileAttempts', 'BlockDiscoveryMisses', 'BlockDiscovered',
    'BlockExecutionRejects', 'BlockZero', 'BlockRetired',
    'CachedRunCalls', 'CachedRunCacheStops', 'CachedRunExecutionRejects',
    'CachedRunZero', 'CachedRunRetired', 'OrdinaryRetired',
    'GpioColdCalls', 'GpioNoEdgeDevices', 'GpioDevicesVisited', 'GpioHostedServices'
]);

/** Occurrence diagnostics only: intentionally no throughput or acceptance verdict. */
export function validateCensus (counts) {
    assert.deepEqual(Object.keys(counts).sort(), [...COUNTERS].sort(), 'exact counter schema');
    for (const value of Object.values(counts)) assert.ok(Number.isSafeInteger(value) && value >= 0);
    assert.ok(counts.FastColdEntry <= counts.FastZero && counts.FastZero <= counts.FastCalls);
    assert.ok(counts.BlockCalls <= counts.FastCalls);
    assert.ok(counts.BlockZero <= counts.BlockCalls);
    assert.equal(counts.BlockCalls, counts.BlockCacheHits + counts.BlockMemoizedMisses
        + counts.BlockAdmissionRejects + counts.BlockDiscoveryMisses + counts.BlockDiscovered);
    assert.ok(counts.BlockExecutionRejects <= counts.BlockCacheHits + counts.BlockDiscovered);
    assert.ok(counts.BlockCompileAttempts >= counts.BlockDiscovered + counts.BlockDiscoveryMisses);
    assert.ok(counts.CachedRunCalls <= counts.BlockZero);
    assert.ok(counts.CachedRunZero <= counts.CachedRunCalls);
    assert.ok(counts.CachedRunCacheStops + counts.CachedRunExecutionRejects <= counts.CachedRunCalls);
    assert.ok(counts.BlockRetired + counts.CachedRunRetired <= counts.FastRetired);
    assert.ok(counts.GpioNoEdgeDevices <= counts.GpioColdCalls);
    assert.ok(counts.GpioHostedServices <= counts.GpioDevicesVisited);
    const fraction = (value, total) => total ? value / total : null;
    return {fastZeroFraction: fraction(counts.FastZero, counts.FastCalls),
        blockZeroFraction: fraction(counts.BlockZero, counts.BlockCalls),
        gpioNoEdgeFraction: fraction(counts.GpioNoEdgeDevices, counts.GpioColdCalls),
        countedRetired: counts.FastRetired + counts.OrdinaryRetired};
}
