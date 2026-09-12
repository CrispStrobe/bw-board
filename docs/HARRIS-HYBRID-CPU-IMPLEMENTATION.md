# R1: actual-net hybrid CPU execution

2026-09-12. Implementation follows HARRIS-HYBRID-CPU-BRIDGE-PLAN.md. Root
integration starts at upstream `6e4327c393ae6f57beb09d345a3aa91be1393729`, including
the newly landed sparse publication/evaluator frontiers. The application remains
on its reviewed package pin; no default, GUI backend, merge or deployment changes.

## Implemented

- `createHarrisNativeMemoryBoard`: constructs the authoritative memory-only
  topology, copies owned ROM bytes before asynchronous instantiation, then uses
  the native bus/controller/latch/net/memory region exclusively. No hidden RAM
  writes or stale JS construction circuit are exposed. Initialization executes
  all 67 physical reset/init periods.
- `HarrisBootCPU.runTransactions`: explicit bounded execution with JS instruction
  semantics and native periods through each memory transaction. Existing
  `stepClock` and `run` are unchanged. Partial odd words, READY waits, budget
  resumption, ordered completions and partial-fault progress remain observable.
  It is synchronous: callers must yield between total-budget calls. A native
  batch cap is not an event-loop responsiveness guarantee.
- Portable browser oracle executes real owned boot, loop and deliberately
  mismatched loop ROMs against independently stepped reference boards. It checks
  complete defined CPU state/history, all mapped bytes, write state, physical
  completions and period counts. No expected result is injected into the guest.
- Repeatable Node benchmark compares reference JS, compiled JS, hybrid single
  periods and hybrid transaction batching, with a warmup round, alternating
  order, five measured rounds, exact state hashes and module/source identity.

## Evidence and interpretation

The combined native, CPU and memory-board selection passed **150 tests, zero
failures and zero skips**, using a fresh native module compiled from the current
upstream source. The module SHA-256 is
`e5b0efe3a31673c0008ba5db9d9eb6f8cf005bac8260f658da6971d089f41c6c`.
This is a targeted selection, not a full engine suite or hosted CI receipt.

Integration tests cover budgets 1/2/3/7/256 across checked, admitted and incremental
native modes; mixed single stepping; real READY-stalled odd guest stores; missing
ROM alias/disconnected RAM pins; and byte/word/string IN/OUT refusal. Boot retires
10 instructions in 136 periods; loop 47 in 372; mismatch 48 in 384. Initial
67 periods are reported separately. Entire ROM/RAM contents and ordered physical
completions match the reference, not merely an output marker.

Two short Node measurements on this shared Xeon host yielded hybrid batched
medians of about 87k and 76k periods/s, versus compiled-JS 11k and 13k: ratios
7.74 and 5.64 respectively. These are **memory-only owned loop** measurements,
not DOS, populated-board or browser capacity. Batching alone was only about
1.04x native single stepping in the second run; the larger gain is entering the
native region. Construction/reset are excluded from both timed periods and time.
Noise and short duration prohibit a stable speed guarantee.

The 4.77 MHz-equivalent target still requires 9,545,454 modeled periods/s under
this clock convention. It is not achieved. Browser receipt is recorded separately
when the combined harness finishes.

## Remaining actual coding

1. Profile longer CPU-bearing workloads: JS instruction/generator overhead,
   bus submission/publication, native settling and allocation separately.
2. Extend the same-instance native region with explicitly modeled I/O and
   time-driven peripheral events; preserve IRQ/NMI/READY/DMA ordering and faults.
3. Move instruction execution into a bounded native region only with equivalent
   architectural state, bus effects and reference/external-oracle comparisons.
4. Add event-bounded execution and worker scheduling without skipping externally
   observable transitions. Measure traced/untraced responsiveness separately.
5. Re-run full wired BIOS/DOS workloads, browser capacity and debugger/replay
   qualification before any production backend promotion.

No full native CPU, peripheral/DOS boot, snapshots, hot swap, instruction/silicon
timing or arbitrary-circuit throughput is claimed by this R1 milestone.
