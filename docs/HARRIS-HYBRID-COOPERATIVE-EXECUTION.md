# R2 cooperative hybrid execution and sustained profiling

2026-09-12. User requested continued wired performance implementation and merge
into the GitHub remote default branch after qualification. No branch deletion,
application deployment or automatic backend promotion is implied.

The candidate incorporates upstream `536eb19`, including the reverse-indexed
native evaluator. It extends R1; it is still JS instruction execution over the
native actual-net memory/bus region, not a native CPU/peripheral machine.

## Implemented contracts

- `runHarrisTransactions` adds cooperative scheduling without changing existing
  one-period stepping. Every CPU call is bounded by remaining periods, the
  per-call cap and the next READY input event. No period is skipped.
- READY event offsets are relative to the invocation and applied before that
  period; events are validated and copied before execution. READY defaults to
  zero per invocation. Resumption must rebase remaining events and supply an
  event at zero if the intended input is still high. This is explicitly not
  a general peripheral/IRQ/DMA event scheduler.
- Wall time is checked after each CPU call. A host task can overshoot the wall
  target by one bounded call; the bound is not a hard millisecond guarantee.
  Host yields are excluded from active execution duration. Stopping after a
  yield executes no next period and leaves the pending CPU transfer resumable.
  The caller owns exclusive CPU use across awaits.
- Native fault progress is preserved; aggregate host progress is attached
  separately. Frozen errors and primitive host callback rejections are wrapped
  with their original cause instead of losing the failure or executed periods.
- Internal bus admission now reads only necessary scalar native state fields,
  removing full diagnostic snapshots and pending-byte allocations from ordinary
  submit/run checks. Public defensive inspections and error precedence remain.

## Real workloads and qualification

The new owned sustained ROM performs 1..65535 guest INC/store/LOOP iterations.
Assembler equivalence and a 64-iteration full native/reference comparison verify
the emitted program; each guest store must increment each RAM bank's write count.
The benchmark accepts explicit iterations, measured rounds and variant selection
for repeatable long runs and CPU profiling, retaining source/module identity.

An initial 1024-iteration run executes 28,720 periods with identical full CPU and
memory hashes across reference JS, compiled JS, hybrid single and hybrid batched.
It measured approximately 155k batched versus 16k compiled periods/s on this
shared host, before the scalar-admission cleanup. This is a memory-only workload,
not DOS, full-board RT, native instruction execution or browser throughput.
The final source-pinned three-round receipt, HARRIS-HYBRID-SUSTAINED-BENCH.json,
measured about 136k batched versus 17k compiled (8.09x). Run-to-run variation
means no isolated scalar-cleanup speedup is established; reduced snapshot work
is structural, not a claim that this edit alone improved measured throughput.

The longer profile identifies native memory settling/preview as major remaining
work, with JS bus submission/inspection also visible. It does not justify calling
the remaining gap solved by porting the decoder alone. Raw throughput must still
reach 9,545,454 modeled periods/s for the stated clock-equivalent target.
HARRIS-HYBRID-SUSTAINED-PROFILE.json records self-sample counts, source identity
and the raw profile digest. Reproduce with `node --cpu-prof
scripts/bench-harris-hybrid-cpu.mjs --experimental --iterations=8192 --rounds=1
--variants=hybrid-batched` and the matching HARRIS_NET_WASM build.

The later hosted [cooperative producer attribution](HARRIS-HYBRID-PRODUCER-ATTRIBUTION.json)
binds exact source `1144fd8`, Harris qualification run `34696776443`, the fresh
Wasm build, full CPU/memory/work identity, and raw CPU/heap profile digests. All
three measured control and instrumented runs halt after 57,392 successful periods,
6,148 retirements and 2,048 writes to each RAM bank; physical clock is exactly
57,459, including the 67 initialization periods outside the timed numerator.
The instrumented medians attribute about 176.2 ms to the combined native/result
boundary, 20.9 ms to instruction pumping, 7.2 ms to submission, 10.9 ms to CPU
receipt control and 0.7 ms to cooperative control. Timer instrumentation retains
about 85.6% of control active throughput, so these are coarse hotspot values,
not an acceptance-speed comparison.

The separate CPU profile still places native settling first: 161 self samples
in `settle_memory_circuit`, then 71 in memory preview, 61 in incremental settle
and 52 in native driver writes. The public JS `runUntilCompletion` has 43 self
samples, while its sampled heap allocation is about 200 KB of 2.83 MB across the
complete profiled process. Completion allocation remains a real secondary cost;
this evidence does not select it ahead of native settling. The next measurement
must count attempted and value-changing writes by native producer. Only those
causal counts can select or reject sparse bus-output publication; aggregate work
counters cannot identify which producer generated unchanged writes.

Node integration tests compare exact reference READY schedules and physical
completions across checked/admitted/incremental modes, plus actual asynchronous
stop/resume with pending fetch state. The browser oracle compares complete CPU
and all mapped bytes both at the paused state and after halt, using a deterministic
scheduler clock only for acceptance, never as a performance measurement.
The combined local selection passed 171 tests, zero failures/skips, including
native, boot CPU, memory board, cooperative scheduler, workflow and census checks.
The frozen-source local Chromium run passed: HARRIS-HYBRID-COOPERATIVE-BROWSER.json
records checked/incremental pause after 3 periods, 379 resumed periods, 47
retirements and complete state comparisons at both pause and halt. Existing
native oracles, workload hashes, heartbeat and cancellation checks also passed.

`.github/workflows/harris-native.yml` builds a fresh artifact, requires native
tests to have zero skips, and runs checked/incremental native and hybrid Chromium
oracles using the same module. Exact module, build manifest, logs and browser
receipts are uploaded. The ordinary CI job may still skip optional native tests;
its results must not be substituted for this dedicated qualification.

## Merge and remaining scope

The cooperative runner and the subsequent admitted, incremental and schedule
optimizations are present on the upstream default branch. The producer-attribution
qualification passed both dedicated native and ordinary CI at exact source
`1144fd8`; it changes measurement and qualification only and does not enable a
backend by default.

Remaining: sparse native memory scheduling, native peripheral/I/O events,
instruction execution inside the native region, full wired BIOS/DOS workloads,
debugger/replay compatibility and real browser capacity. Experiments stay gated.
