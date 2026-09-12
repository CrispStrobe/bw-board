import test from 'node:test';
import assert from 'node:assert/strict';
import {measureExecutionSlice} from 'bw-board/execution-measurement';
const stamp = (ticks, domain = 'owned-cycles', hz = 1000) => ({ticks, domain, hz});
const slice = overrides => ({before: stamp(0), after: stamp(1000), activeMS: 1000, wallMS: 1000, ...overrides});

test('active capacity and wall pacing are distinct measurements of the same target ticks', () => {
  const result = measureExecutionSlice(slice({activeMS: 250, wallMS: 2000}));
  assert.deepEqual(result, {accepted: true, code: 'measured', domain: 'owned-cycles', hz: 1000,
    elapsedTicks: 1000, activeMS: 250, wallMS: 2000, activeTicksPerSecond: 4000,
    wallTicksPerSecond: 500, simulatedMS: 1000, capacityRealTimeFactor: 4, pacingRealTimeFactor: 0.5});
});

test('wired modeled periods and processor-cycle domains require their own frequencies, not instruction counts', () => {
  const periods = measureExecutionSlice(slice({before: stamp(0, 'harris-modeled-periods', 9545454),
    after: stamp(9545454, 'harris-modeled-periods', 9545454)}));
  const cycles = measureExecutionSlice(slice({before: stamp(0, 'owned-processor-cycles', 4772727),
    after: stamp(4772727, 'owned-processor-cycles', 4772727)}));
  assert.equal(periods.capacityRealTimeFactor, 1);assert.equal(cycles.capacityRealTimeFactor, 1);
  assert.equal(periods.activeTicksPerSecond, 9545454);assert.equal(cycles.activeTicksPerSecond, 4772727);
  const mismatched = measureExecutionSlice(slice({before: stamp(0, 'harris-modeled-periods', 9545454),
    after: stamp(4772727, 'owned-processor-cycles', 4772727)}));
  assert.equal(mismatched.code, 'clock-domain-changed');
  const instructions = measureExecutionSlice(slice({before: {ticks: 0, domain: 'retired-instructions'},
    after: {ticks: 100, domain: 'retired-instructions'}}));
  assert.equal(instructions.capacityRealTimeFactor, null);
});

test('exact bigint absolute stamps and mixed safe numeric stamps preserve a small elapsed delta', () => {
  const large = 10n ** 30n;
  const result = measureExecutionSlice(slice({before: stamp(large), after: stamp(large + 1000n)}));
  assert.equal(result.elapsedTicks, 1000);assert.equal(result.capacityRealTimeFactor, 1);
  assert.equal(measureExecutionSlice(slice({before: stamp(0n), after: stamp(1000)})).elapsedTicks, 1000);
  assert.equal(measureExecutionSlice(slice({before: stamp(0), after: stamp(1000n)})).elapsedTicks, 1000);
  assert.doesNotThrow(() => JSON.stringify(result));
});

test('unknown Hz permits throughput but makes no simulated-time or RT-factor claim', () => {
  const result = measureExecutionSlice(slice({before: {ticks: 0, domain: 'unscaled'},
    after: {ticks: 1000, domain: 'unscaled', hz: null}}));
  assert.equal(result.accepted, true);assert.equal(result.activeTicksPerSecond, 1000);
  assert.equal(result.simulatedMS, null);assert.equal(result.capacityRealTimeFactor, null);
  assert.equal(result.pacingRealTimeFactor, null);assert.equal(result.hz, null);
});

test('zero durations yield null rates and zero elapsed ticks with positive durations yield zero rates', () => {
  const empty = measureExecutionSlice(slice({after: stamp(0), activeMS: 0, wallMS: 0}));
  assert.equal(empty.accepted, true);assert.equal(empty.activeTicksPerSecond, null);
  assert.equal(empty.wallTicksPerSecond, null);assert.equal(empty.capacityRealTimeFactor, null);
  assert.equal(empty.pacingRealTimeFactor, null);assert.equal(empty.simulatedMS, 0);
  const noActive = measureExecutionSlice(slice({activeMS: 0}));
  assert.equal(noActive.activeTicksPerSecond, null);assert.equal(noActive.capacityRealTimeFactor, null);
  assert.equal(noActive.wallTicksPerSecond, 1000);assert.equal(noActive.pacingRealTimeFactor, 1);
  const noProgress = measureExecutionSlice(slice({after: stamp(0)}));
  assert.equal(noProgress.activeTicksPerSecond, 0);assert.equal(noProgress.capacityRealTimeFactor, 0);
  assert.equal(noProgress.pacingRealTimeFactor, 0);
});

test('fractional millisecond measurements and simulation-nanosecond domains remain explicit', () => {
  const result = measureExecutionSlice(slice({before: stamp(0n, '8051-simulation-ns', 1e9),
    after: stamp(500000n, '8051-simulation-ns', 1e9), activeMS: 0.25, wallMS: 0.5}));
  assert.equal(result.simulatedMS, 0.5);assert.equal(result.capacityRealTimeFactor, 2);
  assert.equal(result.pacingRealTimeFactor, 1);assert.equal(result.hz, 1e9);
});

test('reset/rewind epochs and backward ticks refuse even when the logical clock family is unchanged', () => {
  for (const domain of ['owned-cycles-reset-1', 'owned-cycles-rewind-1', 'different']) {
    assert.equal(measureExecutionSlice(slice({after: stamp(1000, domain)})).code, 'clock-domain-changed');
  }
  assert.equal(measureExecutionSlice(slice({before: stamp(1000), after: stamp(0)})).code, 'clock-rewound');
  assert.equal(measureExecutionSlice(slice({before: stamp(1000n), after: stamp(999n)})).code, 'clock-rewound');
});

test('frequency changes, including becoming known or unknown, cannot be averaged silently', () => {
  for (const hz of [500, null, undefined]) {
    const after = {ticks: 1000, domain: 'owned-cycles', hz};
    assert.equal(measureExecutionSlice(slice({after})).code, 'clock-frequency-changed');
  }
  assert.equal(measureExecutionSlice(slice({before: {ticks: 0, domain: 'owned-cycles'}})).code, 'clock-frequency-changed');
});

test('invalid/unsafe tick counters and oversized exact deltas refuse lossy arithmetic', () => {
  for (const value of [-1, -1n, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1, '1000', null, undefined]) {
    assert.equal(measureExecutionSlice(slice({after: stamp(value)})).code, 'invalid-ticks');
  }
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  assert.equal(measureExecutionSlice(slice({after: stamp(maximum)})).accepted, true);
  assert.equal(measureExecutionSlice(slice({after: stamp(maximum + 1n)})).code, 'unsafe-tick-delta');
});

test('malformed slices, domains, durations and frequencies return named refusals', () => {
  for (const value of [null, undefined, [], {}, {before: null, after: stamp(0)}]) {
    assert.equal(measureExecutionSlice(value).code, 'invalid-slice');
  }
  for (const domain of ['', ' ', null, 10]) {
    assert.equal(measureExecutionSlice(slice({after: stamp(1000, domain)})).code, 'invalid-domain');
  }
  for (const value of [-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null, undefined]) {
    assert.equal(measureExecutionSlice(slice({activeMS: value})).code, 'invalid-duration');
    assert.equal(measureExecutionSlice(slice({wallMS: value})).code, 'invalid-duration');
  }
  assert.equal(measureExecutionSlice(slice({activeMS: 1001})).code, 'active-exceeds-wall');
  for (const hz of [0, -1, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1000', 1000n]) {
    assert.equal(measureExecutionSlice(slice({before: stamp(0, 'owned-cycles', hz)})).code, 'invalid-frequency');
  }
});

test('extreme finite durations/frequencies cannot return Infinity or NaN rates', () => {
  assert.equal(measureExecutionSlice(slice({activeMS: Number.MIN_VALUE})).code, 'unrepresentable-measurement');
  assert.equal(measureExecutionSlice(slice({before: stamp(0, 'owned-cycles', Number.MIN_VALUE),
    after: stamp(1000, 'owned-cycles', Number.MIN_VALUE)})).code, 'unrepresentable-measurement');
});

test('inputs and results are immutable from the helper perspective and calls retain no history', () => {
  const before = Object.freeze(stamp(0)), after = Object.freeze(stamp(1000));
  const input = Object.freeze(slice({before, after}));
  const first = measureExecutionSlice(input);measureExecutionSlice(slice({after: stamp(1)}));
  assert.deepEqual(measureExecutionSlice(input), first);
  assert.ok(Object.isFrozen(first));assert.throws(() => { first.elapsedTicks = 4; }, TypeError);
  assert.ok(Object.isFrozen(measureExecutionSlice(null)));
  assert.equal(before.ticks, 0);assert.equal(after.ticks, 1000);
});
