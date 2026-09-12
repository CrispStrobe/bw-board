# Harris browser measurement v2

2026-09-12. Implements a P4 browser-benchmark consumer of
`measureExecutionSlice`; no new timing receipt or speedup claim is implied.

## Corrected numerator and timing intervals

The prior browser worker timed `cpu.initialize()` and `runHarrisChunks`, including
awaited cooperative yields, but divided only by `run.clocks` (which excludes
initialization). The legacy `xtCapacityFactor` therefore used a wall-paced proxy,
not separately measured active execution capacity, and omitted initialization
periods from its numerator. Historical receipts remain unchanged.

The worker now captures the actual `board.bus.clock` before initialization,
after initialization and after chunk execution. Initialization normally takes
67 periods in this model; the counter difference is used rather than hardcoding
67 into the measurement. The post-initialization difference must equal the chunk
runner's successfully completed `clocks` or the receipt refuses.

The named domain is `harris-modeled-periods`, at **9,545,454 periods/s** for the
documented 4,772,727 Hz processor-equivalent convention. These are modeled board
periods, not instructions or a silicon timing certification. The benchmark owns
this explicit conversion; the generic measurement helper does not infer it.

`runHarrisChunks` returns accumulated `activeMS` from its synchronous chunk
boundaries. Awaited yield time is excluded. Worker active time is initialization
duration plus that chunk sum. Worker wall time spans initialization and all chunk
execution/yields. Both exclude fixture construction and final verification/hashes.
Synchronous chunk timings include loop/control/read checks and OS descheduling;
they are not process CPU-utilization time. Main-thread message latency is not
included and heartbeat remains a separate responsiveness observation.

## Receipt schema and compatibility

Browser receipts declare `measurementVersion: 2`. Each sample includes the
generic immutable-at-production `measurement` plus `initializationPeriods`.
Transported JSON is revalidated by `summarizeHarrisBrowserSamples` before the
Node host accepts summaries.

- `clocks` remains the **post-initialization** count. The hashed machine-state
  object and its historical clocks field are unchanged.
- `elapsedMS` and `periodsPerSecond` explicitly mean **wall** milliseconds and
  wall periods/second; the rate now includes initialization periods consistently.
- `measurement.activeTicksPerSecond` and `capacityRealTimeFactor` use active
  time. `wallTicksPerSecond` and `pacingRealTimeFactor` use wall time.
- Summaries retain `medianMS/minMS/maxMS` for wall duration, add active duration
  statistics, and expose both types of rate/factor. `xtCapacityFactor` is now an
  alias for **actual measured active** `capacityRealTimeFactor`; do not compare
  it directly with that differently calculated field in historical receipts.
- Summary rates/factors are medians of individual sample rates/factors. They are
  not reconstructed using a median duration; this matters for even sample counts.
- If a rate is undefined because duration is zero, null is preserved. A summary
  containing such a sample retains null for that rate, rather than silently
  dropping the unmeasured sample or returning Infinity.

The new portable `scripts/lib/harris-browser-measurement.mjs` is served by the
existing strict loopback whitelist, and it and its generic dependency are
source-hashed before the browser runs. The helper checks clock/count consistency
and rate arithmetic, not authenticity of hostile benchmark data. Normal source
hash, nonce, state hash and completed-period checks remain in place.

## Tests and remaining evidence

Focused tests cover fake-clock active/yield separation, early stop, exact period
counts, initialization inclusion, clock-domain/frequency rejection, transported
arithmetic validation, null-rate summaries and cancelled partial runs:

```sh
node --test --test-concurrency=1 test/execution-measurement.test.mjs \
  test/harris-run-chunks.test.mjs test/harris-browser-measurement.test.mjs
```

The combined real Chromium benchmark must still be run after integration with
other native/browser changes; no heavy browser run was started for this isolated
consumer change. Native fixture cost benchmarks remain separately scoped and
were not relabeled as full-board capacity measurements.
