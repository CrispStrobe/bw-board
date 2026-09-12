/** Pure clock-domain arithmetic. No timers, target imports, or global counters. */
const MAX_TICKS = BigInt(Number.MAX_SAFE_INTEGER);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ticks = value => typeof value === 'bigint' ? value >= 0n ? value : null :
  Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
const duration = value => typeof value === 'number' && Number.isFinite(value) &&
  value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const frequency = value => value == null || typeof value === 'number' &&
  Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
const refuse = (code, reason) => Object.freeze({accepted: false, code, reason});

/**
 * Measure one uninterrupted slice in one target clock domain/epoch.
 * before/after: {ticks: safe integer | bigint, domain: string, hz?: number|null}.
 * activeMS is measured execution time; wallMS includes waits/pacing/host work.
 * Missing frequency or zero duration yields null for undefined rates, not 0/∞.
 * See docs/EXECUTION-MEASUREMENT.md for target/domain and caller obligations.
 */
export function measureExecutionSlice (slice) {
  if (!record(slice) || !record(slice.before) || !record(slice.after)) {
    return refuse('invalid-slice', 'Supply before/after clock stamps and explicit durations.');
  }
  const {before, after, activeMS, wallMS} = slice;
  const first = ticks(before.ticks), last = ticks(after.ticks);
  if (first === null || last === null) {
    return refuse('invalid-ticks', 'Ticks must be nonnegative bigint or safe integer numbers.');
  }
  if (![before.domain, after.domain].every(value => typeof value === 'string' && value.trim().length > 0)) {
    return refuse('invalid-domain', 'An explicit nonempty target clock domain is required.');
  }
  // Never strip reset/rewind suffixes: equal logical families do not make an
  // execution slice spanning two epochs a valid elapsed-time measurement.
  if (before.domain !== after.domain) {
    return refuse('clock-domain-changed', 'Clock domains or reset/rewind epochs differ.');
  }
  if (!frequency(before.hz) || !frequency(after.hz)) {
    return refuse('invalid-frequency', 'Hz must be positive finite numeric frequency, or null/omitted if unknown.');
  }
  const hz = before.hz ?? null;
  if (hz !== (after.hz ?? null)) {
    return refuse('clock-frequency-changed', 'Frequency changed or became known/unknown during this slice.');
  }
  if (last < first) return refuse('clock-rewound', 'The tick counter moved backwards.');
  const exactDelta = last - first;
  if (exactDelta > MAX_TICKS) {
    return refuse('unsafe-tick-delta', 'Split the measurement: its exact tick delta exceeds safe numeric rate conversion.');
  }
  if (!duration(activeMS) || !duration(wallMS)) {
    return refuse('invalid-duration', 'Durations must be finite nonnegative milliseconds no larger than MAX_SAFE_INTEGER.');
  }
  if (activeMS > wallMS) return refuse('active-exceeds-wall', 'Active execution time cannot exceed this slice wall time.');
  const elapsedTicks = Number(exactDelta);
  const activeTicksPerSecond = activeMS === 0 ? null : elapsedTicks / activeMS * 1000;
  const wallTicksPerSecond = wallMS === 0 ? null : elapsedTicks / wallMS * 1000;
  const simulatedMS = hz === null ? null : elapsedTicks / hz * 1000;
  const capacityRealTimeFactor = hz === null || activeTicksPerSecond === null ? null : activeTicksPerSecond / hz;
  const pacingRealTimeFactor = hz === null || wallTicksPerSecond === null ? null : wallTicksPerSecond / hz;
  if ([activeTicksPerSecond, wallTicksPerSecond, simulatedMS, capacityRealTimeFactor, pacingRealTimeFactor]
    .some(value => value !== null && !Number.isFinite(value))) {
    return refuse('unrepresentable-measurement', 'The supplied durations/frequency overflow finite rate arithmetic.');
  }
  return Object.freeze({accepted: true, code: 'measured', domain: before.domain, hz,
    elapsedTicks, activeMS, wallMS, activeTicksPerSecond, wallTicksPerSecond,
    simulatedMS, capacityRealTimeFactor, pacingRealTimeFactor});
}
