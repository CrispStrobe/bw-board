# Wired x86 performance: iterative execution plan

2026-09-09. Requested scope: document the strategy, then implement and validate
it iteratively. This is not a completed-performance claim. Keep the reference
interpreter and valid experiments; no production pin change, merge, deployment,
guest-media hosting, or automatic backend replacement is authorized here.

## Measurements versus targets

The [startup receipt](HARRIS-WIRED-STARTUP-BENCH.json) measures 10,000 modeled
system-clock periods in a median 7,504 ms after the first overhead pass,
versus 12,713 ms before: 1.69x throughput, with identical reported guest/device
state. Shared-host noise is substantial. This is not a whole-boot benchmark.

One fresh `node scripts/bench-i8086.mjs --json` sample on the same busy host
reported 7.1x XT for the functional core, 6.0x for its synthetic machine workload,
and 1.1x for its service-assisted DOS workload. These are distinct workloads,
not a universal speed ranking. The script's boot implementation uses DOS service
hooks despite its introductory historical wording. Browser pacing limits are
not execution ceilings. Existing functional results are not wired results.

Planning targets, not predicted hard ceilings, on a named modern desktop:

- Functional execution: 5–20x XT across selected tuned workloads, not every app.
- Compiled wired execution: first establish 1x on the reference board; 1–3x is
  an ambitious subsequent target, not a promise or an arbitrary-circuit guarantee.
- Full per-net tracing and unusually large/custom circuits have separate costs.

The Harris [phase contract](HARRIS-80C286-BUS-CONTRACT.md) models one complete
system CLK period per board step, with two periods per processor/bus state.
For a 4,772,727 Hz processor-equivalent target, the capacity gate is therefore
**9,545,454 modeled system periods per wall second**, not 4.77 million retired
instructions. Current startup capacity is roughly 1,330 periods/s: about a
7,200-fold gap. These ratios measure simulation capacity; the existing ideal
phase model does not certify complete silicon instruction/prefetch/AC timing.

## Non-negotiable execution contract

The user's edited netlist remains the source of connectivity. Compiling it
must not replace wired memory accesses with an unrelated functional machine.
Preserve known/X/Z/conflict resolution, named faults, delta ordering, address
latching, byte lanes, READY waits, HOLD/HLDA, interrupt acknowledgement, DMA
ownership and terminal count, reset, and atomic peer-bank write preflight.
Faulting/differing cases are failures, not candidates for silently disabling
checks. The reference interpreter remains selectable behind the experiment gate.

Stable intervals may be skipped only if their state evolution and next event
are known and all observable results are preserved. Timer edges, pending input,
interrupt qualification, memory strobes and debugger stops bound such intervals.
Wire edits invalidate compilation. Traces must describe real modeled events;
do not invent an after-the-fact bus trace from architectural memory callbacks.

## Ordered implementation and evidence gates

1. **Baseline and boot receipt.** Preserve the original in-flight wired DOS run;
   require loaded COMMAND.COM/PSP evidence and actual `A>` output. Record its
   original source hashes separately from optimized revisions. Establish owned
   CPU/memory, I/O, DMA and idle/timer benchmark workloads with useful progress.
2. **Oracle harness.** Follow [the oracle plan](X86-ORACLE-STRATEGY.md). Pin tools,
   use owned probes, normalize only specified undefined fields, retain first
   divergence and minimize failures. External comparison complements rather
   than replaces hardware-derived tests and reference-vs-compiled comparisons.
3. **Compiled connectivity.** Add an explicitly selected backend with integer
   terminal/net/driver IDs and packed/indexed levels. Compile the actual edited
   netlist. Keep public diagnostics defensive and differential-test all logic
   combinations, missing/shorted wires and complete bus traces.
4. **Compiled device bindings and event scheduling.** Remove per-clock pin-name
   lookup/object reconstruction and unnecessary device calls. Schedule only
   affected devices or explicit clock events. Preserve the stateful commit order
   and fail-closed behavior. Do not infer purity for arbitrary custom devices.
5. **Bus/board specialization.** Compile validated bus-phase transitions and
   memory decode into the execution kernel. Preserve ownership and write edges.
   Specialization is derived from connectivity, with explicit fallback/refusal
   for unsupported constructions, not a hidden topology-independent fast path.
6. **Whole-kernel Wasm evaluation.** Compare optimized JS with a release Wasm
   implementation of the hot loop if profiling still justifies it. Avoid a
   JS/Wasm boundary per pin, period or memory byte. Keep losing-but-valid paths
   gated; remove only demonstrably broken implementations.
7. **Worker and observation boundary.** Run long execution chunks off the UI
   thread, bounded by virtual events and debugger stops. Batch snapshots and
   rendering; measure trace-off, bounded trace and detailed trace separately.
   A worker is a responsiveness mechanism, not an intrinsic speed multiplier.
8. **End-to-end performance gate.** Repeat native/Node and browser measurements
   on a recorded host/build with warmup, medians/spread, useful work, memory
   hashes and bus-event agreement. Include CPU/memory, I/O, DMA, interrupts and
   DOS execution—not just idle fast-forward or a bus-only microbenchmark.

## Completion rule

Do not close the implementation loop merely after writing this plan, passing
unit tests, achieving a microbenchmark speedup, or exhausting one experiment.
Completion needs the supported reference board to sustain the stated capacity
gate in the named end-to-end workload set with tracing off, preserve the wired
contract, and produce reproducible correctness and performance receipts. Publish
unsupported cases and tracing/browser limitations explicitly. Calibrate CPU,
PIT and virtual-time units before describing a paced run as XT real time; the
current DOS diagnostic's laboratory timer ratio is not a stock-clock grade.

If a prototype misses the gate, record why and proceed to the next supported
optimization. A materially different fidelity compromise, third-party embedding,
new distribution obligation, or product-default change requires an explicit
decision rather than silently redefining success.

## Progress ledger

- Complete: first allocation/terminal-cache pass (`19c033d`), 510 targeted tests,
  four-pair startup receipt. This is not completion of the plan above.
- Complete: original wired DOS acceptance at `A>`, 5,930,000 modeled periods,
  with [source-pinned receipt](HARRIS-286-DOS-BOOT-REPORT.json). This is the
  pre-optimization reference implementation, not the compiled backend.
- Initial oracle iteration: [60 PCjs comparisons pass](PCJS-OWNED-ORACLE-REPORT.json);
  broader interrupt/device/protected-mode adapters and minimization remain pending.
- Initial connectivity iteration: [indexed backend](HARRIS-COMPILED-NETS.md),
  525 targeted tests and a 1.15x startup comparison. Stateful scheduling unchanged.
- Pending: completion of the eight implementation/evidence gates beyond these
  partial milestones; the real-time capacity gate has not been reached.
- Binding/observation iteration: cached device and memory bindings, explicit
  bus-trace opt-out, 526 passing targeted tests, and a
  [1.18x current-backend comparison](HARRIS-BOUND-NETS-BENCH.json). CPU history
  remains enabled; no full-boot or isolated trace-cost claim.
- Scheduling iteration: reverse pure-evaluator adjacency and separately gated
  memory-bank subscriptions; 546 targeted tests including analog bus-memory
  regressions pass. Scheduled BIOS disk/keyboard and late peer-bank fault tests
  pass. Peripheral/CPU clock scheduling remains unchanged.
- Owned workload harness added: CPU/memory, I/O, DMA, interrupt-driven HLT,
  masked idle. One warmup and one measured run per mode/workload all passed
  state/memory comparisons. Repeated performance receipts remain pending;
  no real-time-capacity claim follows from this smoke run.
- Write-journal iteration: gated single-byte staging through the existing
  memory model, copy fallback retained; **554 tests pass, 4 suites, zero skips**,
  including DMA/BIOS and analog memory regressions. The earlier scheduling-only
  count was 546 tests plus 4 suite markers, not 550 tests; corrected above.
- Repeated owned workload receipt at `03946c7`: one warmup plus three measured
  rounds across reference/compiled/scheduled/journal modes, all 80 executions
  agree on reported state and every mapped memory hash
  ([receipt](HARRIS-OWNED-WORKLOADS-BENCH.json)). Scheduled/reference speedups are
  1.58x memory, 1.83x I/O, 1.77x DMA, 1.70x interrupt and 1.56x idle. Scheduled
  active-workload capacity is only 2,855–4,332 system periods/s. Journal gains
  are not consistent overall on this noisy VM; keep it gated. Capacity gate
  remains thousands of times away. No DOS or browser claim from this harness.
- Expanded PCjs probes: 125/125 pass, with explicit undefined-flag masks and
  replayable first-difference inputs. Broader oracle scope remains pending.
- Decoder iteration: optional pin/vector binding of owned memory decoders;
  **559 tests pass, 4 suites, zero skips**, including changed-wire fault behavior,
  per-period DMA comparisons and BIOS disk execution. Performance receipt pending.
- A full compiled/scheduled, bus-trace-off DOS run completed using runtime
  `03946c7` (without decoder specialization or write journal). Its result must
  be recorded separately from later runtime revisions. Accepted at `A>` after
  5,930,000 periods and 513,244 retired instructions; every recorded guest/device
  field and landmark clock matches the original reference receipt. All 21 source
  hashes match the exact execution revision
  ([receipt](HARRIS-COMPILED-DOS-BOOT-REPORT.json)). Elapsed time was 1,946,641 ms
  (~32.4 minutes), versus ~105.5 minutes originally, under different host loads.
  This remains a lab-clock functional boot, not the real-time-capacity gate.
- Decoder [three-round receipt](HARRIS-DECODER-SPECIALIZATION-BENCH.json):
  approximately 1.11x memory, 1.16x I/O, 0.93x DMA, 1.08x interrupt, 1.02x idle
  versus scheduled generic decoders. All states match. Concurrent DOS and host
  noise limit causal claims; specialization is not an across-the-board win.
- Oracle reducer: bounded register/RAM deletion and bit clearing, fixed opcode
  and masks, replayable first-field/address mismatch. Synthetic tests pass;
  integrated PCjs CLI remains 125/125 with no mismatch to reduce.
- Peripheral scheduling iteration: explicit read-dependent PIT/FDC/keyboard
  scheduling and external wake revisions; unknown implementations fall back.
  CPU/controller/oscillator/DMA/PIC invocation timing unchanged. **576 targeted
  tests pass, four suites, zero skips**. Repeated performance receipt pending.
- Peripheral [three-round receipt](HARRIS-DEVICE-SCHEDULING-BENCH.json): about
  1.38x memory, 1.28x I/O, 1.08x DMA, 1.19x interrupt and 1.68x idle versus
  memory scheduling alone. All 40 executions (including warmup) agree on
  reported state and mapped-memory hashes. Concurrent DOS/host noise applies;
  this remains far below the capacity gate.
- Packed CPU drive iteration: default-off numeric address/data vectors bound to
  actual net drivers, with legacy output/trace compatibility. Complete trace,
  fault, DMA/BIOS and owned-state comparisons pass; repeated throughput pending.
- Worker iteration: a portable complete-period chunk runner and fresh-profile
  Chromium harness run all five owned workloads off the main thread. Smoke
  comparisons match recorded Node state and all mapped-memory hashes; posted
  cancellation stops at a complete period. This is a benchmark harness, not
  application integration or a full DOS browser result. Repeated Node/browser
  measurements and the capacity gate remain open.
- Packed [three-round Node receipt](HARRIS-PACKED-BUS-BENCH.json), exact runtime
  `eeeffa3`: all states match. Median packed/events ratios are 1.02x memory,
  1.00x I/O, 1.35x DMA, 1.29x interrupt, 1.08x idle. No other test/benchmark from
  this lane overlapped measurement; shared-host variation remains uncontrolled.
  Active packed throughput is 4,709–9,243 system periods/s, still approximately
  1,000–2,000 times short of the capacity target. More micro-optimizations alone
  must not be represented as a credible guarantee of closing that gap.
- Repeated [browser worker receipt](HARRIS-BROWSER-WORKER-BENCH.json), sources
  verified at `eeeffa3`: all 40 executions match recorded Node CPU/device and
  mapped-memory hashes. Active packed/reference ratios are 1.89–2.53x. Main
  heartbeat p95 is 17.3 ms; posted cancellation ends at a complete period.
  Throughput remains 526–1,156 times below the active-workload capacity gate.
  No UI/product integration, full browser DOS boot or stock-clock grade claimed.
- [Whole-kernel evaluation contract](HARRIS-KERNEL-EVALUATION.md) added. Obtain
  an execution-only sampled profile before choosing the next port/rewrite;
  retain actual-netlist and fault semantics, not an unrelated functional board.
