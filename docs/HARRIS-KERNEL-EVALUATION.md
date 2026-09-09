# Whole wired execution kernel: evaluation contract

This is the next architectural evaluation, not an implemented backend. It
extends steps 5–6 of [the performance plan](WIRED-X86-PERFORMANCE-PLAN.md).
The existing compiled JS path and the reference path remain available.

## Why the boundary matters

The capacity target allows roughly 105 ns per modeled system period. The
source-pinned packed Node memory workload currently costs roughly 212 us per
period. Even removing half its execution cost would leave about a thousand-fold
gap. First obtain a sampled profile of the actual populated-board workload;
retain the source hashes and sample scope. Do not infer a complete speedup from
an isolated net resolver, bus loop, idle run or compiler microbenchmark.

The prospective kernel must own the hot CPU/bus/device/net-resolution loop.
Calling Wasm once per pin, period or fetched byte leaves the important boundary
in place. A bus-only implementation can be a correctness prototype, but cannot
satisfy the whole-kernel or end-to-end gate. An embedded interpreter running the
same JS is not automatically a faster kernel.

## Inputs and invariants

- Compile connectivity from the validated edited netlist into terminal, driver,
  net and dependency tables. Include topology/model fingerprints. Rebuild after
  edits; refuse unsupported devices explicitly or select the reference backend.
- Represent known, X, Z and opposing-driver contention separately. Preserve
  published versus pending delta state and original evaluator/fault ordering.
- Keep CPU phases, controller status interpretation, transparent latch state,
  actual memory selects/byte lanes, READY, HOLD, DMA, interrupt acknowledgement,
  PIT edges and keyboard/media input inside the execution contract. Memory
  accesses must still follow the compiled wires and strobes.
- Preflight peer writes before committing any bank; no partial byte/word write
  on a late peer fault. Preserve ROM protection and named fault diagnostics.
- Chunk only at complete periods. Stop at the earliest virtual input, debugger
  boundary, trace limit, fault or requested budget; no invented event trace.

## Validation before performance claims

1. Record a populated-board profile with setup separated from execution.
2. Establish typed state/diagnostic and event-boundary serialization with
   reference differential tests before replacing a device or CPU transition.
3. Port one bounded component at a time, retaining its original implementation
   behind an explicit gate. Compare all four-state inputs, edited wiring,
   fault behavior and state transitions, not merely successful output bytes.
4. Compare complete per-period bus traces through READY, DMA, INTA, NMI, reset
   and odd writes. Then compare full owned-workload CPU/device/memory hashes.
5. Any CPU semantic change requires refreshed hardware-derived instruction
   evidence and pinned external oracle comparisons. Earlier SST/PCjs receipts
   do not automatically apply to a newly ported CPU.
6. Repeat full DOS acceptance and Node/browser workloads on frozen sources,
   with clock calibration and observations enabled as claimed. Publish losing
   results and unsupported cases. The real-time gate remains unchanged.

No new fidelity compromise, third-party runtime embedding, distribution
obligation, production default or deployment is authorized by this document.

## First populated-board profile

[Execution-only memory profile](HARRIS-PACKED-MEMORY-PROFILE.json): runtime
`eeeffa3`, with the newly added `bench/harris-profile.mjs` harness identified by
its own recorded hash (it was not yet in that runtime commit). One warmup,
32,852 actual periods, 2,567 retired instructions, matching recorded guest/device
state and all mapped-memory hashes. Setup, initialization and verification are
outside profiling. The raw inspector profile is local, not a guest artifact.

The sample attributes substantial time to memory settling/preview, compiled
net driving/settling, decoder bit reads and peripheral evaluation. Garbage
collection occupies about 6.8% of sampled time. The CPU generator pump is only
about 3.3% inclusive in this workload; replacing only instruction arithmetic is
not supported as the next major lever. Inclusive stack entries overlap and
the same function can appear in several caller contexts; do not sum arbitrary
rows or treat sampled frames as exact expression costs.

Next bounded experiment: cache validated output layouts and reuse drive staging
storage behind a new compiled-only gate. Preserve full-batch validation before
any net mutation, support reentrant getters without sharing active scratch
buffers, and bound the cache for changing/custom output shapes. Differentially
test invalid levels/pins, partial updates, four-state contention and complete
owned workload states. Measure against packed, not against the old reference,
so this iteration's contribution is visible. It still cannot alone close the
capacity gap; the whole-kernel gates above remain pending.
