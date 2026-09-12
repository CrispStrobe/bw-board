# Wired x86 performance: iterative execution plan

2026-09-09. Requested scope: document the strategy, then implement and validate
it iteratively. This is not a completed-performance claim. Keep the reference
interpreter and valid experiments; no production pin change, merge, deployment,
guest-media hosting, or automatic backend replacement is authorized here.

## Current status — not complete

| Gate | Evidence/status |
| --- | --- |
| Baseline and wired DOS boot | Reference and compiled/scheduled boots accepted at `A>`; exact source receipts preserved. Newer packed/layout variants still need their own full boot receipt. |
| Oracles | Full recorded real-mode SST286 run and 125 pinned PCjs comparisons; broader device/interrupt/protected-mode external comparisons remain open. |
| Compiled connectivity | Implemented and gated; four-state, edited-wire and fault comparisons pass. |
| Bindings/scheduling | Memory and selected peripherals scheduled; packed drives and cached layouts measured. Not a complete whole-board event kernel. |
| Bus/board specialization | Partial; actual-net decoder/vector binding exists, complete specialized execution kernel does not. |
| Whole-kernel Wasm evaluation | Typed-net/combinational/memory components and coupled net/memory fixed-point prototype validated in Node and Chromium. Controller/CPU/device clock kernel and throughput comparison pending. |
| Worker boundary | Owned-workload Chromium worker, bounded chunks, heartbeat and cancellation verified; not production GUI integration. |
| End-to-end capacity | **Failed/unmet**: latest active browser workloads sustain 10,903–26,218 modeled periods/s versus 9,545,454 required. Calibrated full DOS/browser timing remains open. |

Latest runtime: `14cd743`; [Node receipt](HARRIS-DRIVE-LAYOUTS-BENCH.json),
[browser receipt](HARRIS-BROWSER-LAYOUTS-BENCH.json). No defaults, application
pins, merge or deployment changed. These are reproducible incremental results,
not a claim that all eight gates or the user's requested final outcome are done.

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
instructions. At the first startup checkpoint capacity was roughly 1,330
periods/s: about a 7,200-fold gap. Later measurements are in the ledger below.
These ratios measure simulation capacity; the existing ideal
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
- Profile-guided drive-layout experiment: compiled-only bounded layout cache,
  typed batch staging, original cold fault order and reentrant accessor safety.
  All five owned workloads still match state/memory hashes. Per-period trace,
  READY, peer-bank fault and DMA validation precede repeated measurements.
  The old uncached path and all default gates remain unchanged.
- Drive-layout [three-round Node receipt](HARRIS-DRIVE-LAYOUTS-BENCH.json), runtime
  `14cd743`: all 40 executions match. Relative to packed alone, median ratios
  are 1.18x memory, 1.12x I/O, 1.13x DMA, 1.13x interrupt and 1.07x idle. Active
  throughput is 6,018–10,416 modeled periods/s. The capacity gate remains open.
- Drive-layout [browser repetition](HARRIS-BROWSER-LAYOUTS-BENCH.json), sources
  verified at `14cd743`: all 40 state/memory comparisons and actual cancellation
  pass. Active ratios versus packed alone are 1.04–1.19x; throughput is
  10,903–26,218 modeled periods/s, still about 364–875 times short. No whole-kernel
  Wasm, calibrated full DOS/browser performance or completed capacity claim.
- Combined wired/x86, memory-model and peripheral regression at `14cd743`:
  **471 tests pass, 4 suites, zero skips/failures**. This is the explicitly
  selected combined command, not the repository-wide suite. The pinned PCjs
  oracle was rerun: 125/125 pass. CPU hash still matches the recorded complete
  SST286 run (1,477,997 passed, three upstream revocations); vectors were not
  rerun because the CPU source is unchanged.
- Native kernel prerequisite: owned freestanding four-state resolver and typed
  actual-connectivity image built and passed five explicit tests, no skips
  when the local module is supplied. Native malformed-input checks preserve
  output atomicity; populated-board period snapshots match both JS backends.
  This is an isolated resolver, not a selectable Wasm board or a throughput
  result. [Build/prototype details](HARRIS-KERNEL-EVALUATION.md). Full kernel
  implementation and the unchanged capacity gate remain open.
- Native combinational checkpoint: owned evaluator identity admission, typed
  dependencies, staged deltas, masked-output scheduling, nonconvergence/recovery
  and malformed-input atomicity pass. Full combined command with the native
  module enabled: **484 tests, four suites, no failures/skips**. Chromium checks
  2,366 settle boundaries and all five historical workload hashes; its clean
  [receipt](HARRIS-NATIVE-BROWSER-ORACLE.json) follows a harness process-group/
  temporary-profile cleanup fix. This is not a full native board or a capacity
  result. Coupled stateful memory, controller/CPU/device ports remain pending.
- Isolated native memory component: nine focused tests pass, including 1,795
  portable differential passes across four banks, all byte values and a late
  peer fault. Write-edge/arming, read-only EEPROM, X/Z validation, defensive
  copies and safe-integer write counts are covered. The native net/memory loop
  is not coupled yet; no board backend or throughput improvement is claimed.
  Chromium repeats both component oracles, preserves all five owned workload
  hashes and passes cancellation/profile cleanup. Build/browser receipts are
  linked in the kernel evaluation document. The combined checkpoint passes
  **493 tests, four suites, zero failures/skips** with the module enabled.
- Coupled native memory/net fixed-point prototype passes eight new tests;
  all component and registered memory-model tests pass together (41 total,
  four suites, zero failures/skips). Actual edited wiring, byte lanes, peer
  fault atomicity and per-pass convergence/recovery remain observable. There
  is still no native controller/CPU/device clock runner or capacity claim.
  The broader checkpoint passes **501 tests, four suites, zero failures/skips**;
  Chromium also passes the coupled oracle and earlier workload/component checks.
- Owned ideal controller/latch component port: seven focused tests and the
  combined **508-test/four-suite** checkpoint pass without failures/skips.
  Chromium repeats 360 controller periods and 128 latch observations plus all
  prior oracles/workload hashes. Actual-net phase integration and the CPU/bus/
  peripheral clock kernel remain pending; this is not a capacity improvement.
- Actual-net latched-memory clock prototype: six new tests, 1,532 begin/end
  oracle comparisons and Chromium validation pass. The broader checkpoint is
  **514 tests, four suites, zero failures/skips**. The small two-bank cost probe
  measures native at about 2.40x compiled JS (31,063 versus 12,968 periods/s),
  with substantial host noise. This excludes CPU/peripherals and still copies
  diagnostic/input arrays per boundary; it is not a full-board RT result.
  Next cost-isolation step is a bounded native fixture schedule, followed by
  the still-pending CPU bus/device clock runner and real capacity comparison.
- Bounded native fixture schedule passes five focused tests and the 59-test
  native-component/memory set with zero failures/skips. It executes every
  begin/end period and checks actual-net reads. The repeated component cost
  probe measures about 50,682 periods/s batched versus 14,303 per-boundary native
  in the same noisy run (3.54x). This is not a CPU runner or full-board RT claim;
  native settling/profile work and CPU/device integration remain outstanding.
- Native schedule profile attributes 72.4% of 623 schedule-stack samples to
  settling (validation/resolution/evaluation combined). Private graph admission
  now passes the 62-test native-component/memory set and Chromium oracles.
  Repeated small-circuit medians show only 1.074x admitted/checked-batched with
  overlapping ranges; retain the default-off experiment without claiming a
  stable win. A larger 8,194-period smoke verifies capacity-aware schedule
  chunking. Incremental net resolution and the actual CPU/device runner remain
  pending; the requested whole-board capacity is still unproven.
