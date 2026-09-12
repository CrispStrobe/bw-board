# Execution slices: capacity is not wall-time pacing

2026-09-12. P4 arithmetic prerequisite; no runtime consumer, new benchmark or
performance claim. `bw-board/execution-measurement` exports the dependency-free
pure `measureExecutionSlice` helper. It reads no clocks and stores no state.

```js
const result = measureExecutionSlice({
  before: {ticks: 0n, domain: 'harris-modeled-periods', hz: 9545454},
  after: {ticks: 9545454n, domain: 'harris-modeled-periods', hz: 9545454},
  activeMS: 250,
  wallMS: 2000
});
// capacityRealTimeFactor: 4; pacingRealTimeFactor: 0.5
```

Those numbers are an arithmetic example, not an observed Harris benchmark.

## Input contract and target clocks

Supply actual stamps from the same target clock: `{ticks, domain, hz}`. Existing
`emu8051-debug.js` `time()` uses BigInt oscillator ticks when configured with a
valid frequency, otherwise simulation nanoseconds at 1e9 Hz; domains include
reset epochs. `i8086-debug.js`/`z80-debug.js` publish `debugTime()` cycle stamps,
while common instruction-event stamps can contain BigInt ticks. This helper
accepts both safe integer numbers and nonnegative BigInt values, including mixed
representations. Absolute BigInt counters can be large: subtraction is exact,
but a delta above `Number.MAX_SAFE_INTEGER` is refused rather than rounded into
a rate. There is no conversion from instructions to cycles.

The full domain string must match, **including reset/rewind epoch suffixes**.
Do not apply `logicalTimeDomain` when measuring a slice: that function is useful
for replay family identity, not elapsed time across resets. Backward ticks within
one domain refuse too. The helper cannot detect a reset if its producer preserves
the same domain and returns a counter that has already caught up; callers must
close measurement slices at reset/reconstruction and use epoch-aware stamps.

Frequency must be the same positive finite number at both ends (fractional Hz is
allowed), at most `MAX_SAFE_INTEGER`. Omitted/null Hz means unknown: throughput
is measured, but simulated milliseconds and both RT factors are null. A change
from known to unknown or vice versa is a frequency change and refuses. Zero Hz
is invalid, not a shorthand for unknown.

`activeMS` and `wallMS` are finite nonnegative milliseconds, at most
`MAX_SAFE_INTEGER`; fractional milliseconds are allowed. Active time cannot
exceed wall time. They must cover the same before/after interval. Worker execution
duration is not main-thread message latency; callers must instrument the worker
and choose interval boundaries consistently. Do not sum overlapping worker times
and call that this single-target active duration.

## Returned measurements

Accepted results are flat, frozen and JSON-serializable:

| Field | Meaning |
| --- | --- |
| `domain`, `hz` | Exact measured domain/epoch and its frequency, or null Hz |
| `elapsedTicks` | Exact safe numeric delta, not an instruction count conversion |
| `activeMS`, `wallMS` | The supplied interval durations |
| `activeTicksPerSecond` | Tick delta divided by active execution seconds |
| `wallTicksPerSecond` | Tick delta divided by total wall seconds |
| `simulatedMS` | Tick delta / domain Hz, expressed in milliseconds |
| `capacityRealTimeFactor` | Active ticks/second divided by domain Hz |
| `pacingRealTimeFactor` | Wall ticks/second divided by domain Hz |

Undefined rates for zero-duration denominators are **null**, not Infinity or
zero. Positive durations with no tick progress produce zero rates. Known Hz can
still yield simulated elapsed time even when a duration is zero. Nonfinite
derived arithmetic refuses as `unrepresentable-measurement`.

Capacity here means achieved throughput during the measured active slice, not
a proven hardware ceiling or a guarantee for another workload. Wall pacing also
includes deliberate throttling, waits, rendering and other host work. The helper
does not decompose CPU/device/rendering/allocation costs; future instrumentation
must collect those separately with nonoverlapping definitions.

## Named domains and limitations

- Harris wired modeled periods: the current reference convention requires
  **9,545,454 periods/s**, not 4,772,727 periods/s, for 4,772,727 Hz
  processor-equivalent capacity. Pass the modeled-period frequency directly;
  do not pretend each period is a retired CPU cycle/instruction.
- A genuine 4,772,727 Hz processor-cycle domain requires 4,772,727 ticks/s for
  1x. It is a different domain and cannot be mixed with modeled periods.
- `i8086-cycles` and `z80-cycles` inherit the fidelity of their producer's cycle
  accounting. This helper cannot certify bus/electrical timing from their names.
- `8051-oscillator` and its reset epochs use the target's configured oscillator
  frequency; `8051-simulation-ns` at 1e9 Hz measures simulated time without
  asserting an oscillator-cycle count.
- Instruction retirements without a clock-frequency contract can be reported as
  throughput in a separate unscaled domain, but do not acquire a clock RT factor.
- A caller can lie about domain or Hz. The helper validates consistency, not
  provenance; the integration owns the target/frequency authority. No domain
  name lookup silently supplies missing frequency or conversion factors.

Failure results are frozen `{accepted:false, code, reason}`. Codes:
`invalid-slice`, `invalid-ticks`, `invalid-domain`, `clock-domain-changed`,
`invalid-frequency`, `clock-frequency-changed`, `clock-rewound`,
`unsafe-tick-delta`, `invalid-duration`, `active-exceeds-wall`,
`unrepresentable-measurement`. No partial rate is published after refusal.

Verify with `node --test --test-concurrency=1 test/execution-measurement.test.mjs`.
This does not wire any existing target, GUI, worker or benchmark automatically.
