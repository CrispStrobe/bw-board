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
