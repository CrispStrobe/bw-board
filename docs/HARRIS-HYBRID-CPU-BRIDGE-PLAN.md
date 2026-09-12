# R1 hybrid CPU bridge: bounded implementation plan

Implementation update: see HARRIS-HYBRID-CPU-IMPLEMENTATION.md for the completed
bounded memory-only bridge, qualification and remaining full-native/peripheral
work. The following text is the original pre-implementation design checkpoint.

2026-09-12, read-only design review. This is **not implemented**. The reviewed
bus binding was in-flight work in `native-286-memory-bus`, based at `3a1efb6`;
its final exported contract must be rechecked after that lane lands. No CPU core,
application factory, GUI, default or deployment change accompanies this note.

## Smallest file envelope

1. New `src/experimental/harris-native-memory-board.js`: async owned board factory
   and adapter, reusing the authoritative JS topology without executing it.
2. One explicit bounded method in `harris-80c286-boot-cpu.js`, tentatively
   `runTransactions({maxPeriods, maxBatchPeriods, ready_n})`. Do not alter existing
   `stepClock()` or `run()` behavior or make them silently execute larger batches.
3. New `test/harris-native-boot-bridge.test.mjs`: boot/loop differential tests,
   budget/resumption/ordering faults, unsupported transactions and observation gates.
4. Portable owned bridge oracle only if needed by the combined browser harness;
   documentation and explicit opt-in capabilities. No new catalog qualification.

## Actual ROM/RAM topology and initial contents

Use `createHarrisMemoryBoard` with a copied owned ROM, explicit alias setting,
64 KiB RAM, no text RAM, no peripherals/interrupts/HOLD, reference connectivity
and bus tracing disabled. Its `circuit` and frozen `memoryMap` supply the existing
CPU, input driver, controller, latch, actual decoder and memory wiring. Do not
clock or initialize this JS board; it is a construction recipe only.

Feed that circuit to `createNativeMemoryCircuit` with four explicit descriptors:
`rom0/rom1` as read-only 28C256 and `ram0/ram1` as 62256. Populate descriptors from
the copied ROM's even/odd bytes or the unclocked constructor's initial bank bytes.
Neither approach imports a live runtime snapshot. Use the existing high ROM
window `0xff0000..0xffffff` and optional low alias `0xf0000..0xfffff`; RAM remains
the two actual x8 lanes at `0..0xffff`.

The reviewed native binding requires:

```js
phase: {kind: 'owned-latched-memory-v1', controller: 'controller', latch: 'latch'},
bus: {kind: 'owned-286-memory-bus-v1', cpu: 'cpu', inputPart: 'inputs', maxWaitStates}
```

It refuses I/O/interrupt phase options, schedules and undeclared stateful parts.
Keep those admission limits rather than weakening them for this bridge. All
post-construction reads/writes must go through the native bus, resolved actual
nets, decoded selects, latch and command strobes. The adapter's transaction
completion callback must **never** write backing RAM directly.

Do not expose the now-stale construction circuit as live GUI/debugger state.
Expose native inspection and, if useful, a clearly static topology mapping.
Keep bank ID-to-index conversion inside the adapter so `inspectMemory('ram0')`
returns a defensive native-memory view. Construct a separate reference board for
tests; it must not share evolving state or memory with the native instance.

## Adapter methods and exact clock meaning

- `initialize()` drives 17 complete RESET periods then 50 deasserted periods,
  using native `beginClock/endClock`. The current bounded bus runner requires a
  pending transaction and cannot replace this initialization loop. Sixty-seven
  one-time host crossings are acceptable for R1; do not fake them by assigning
  counters. The factory itself does not initialize, avoiding double reset.
- `clock(inputs)` is exactly one native begin/end pair and returns that period's
  physical completion or null. This satisfies `HarrisBootCPU.stepClock()` without
  changing debugger/period stepping semantics.
- `submit(transaction)` delegates to native validation and submission. Logical
  odd words may produce two physical completions; only the final completion
  carries the complete operand consumed by the JS generator.
- `runUntilCompletion({maxPeriods,inputs})` uses the reviewed native operation,
  currently bounded to 1..8192 periods, returning `periods`, `completed` and ordered
  `completions`. Static external inputs remain static for that call. Do not imply
  per-period callback/input-event support inside it.
- Expose actual native `inspectBus().clock/open` if benchmark consumers need
  stamps. Do not fabricate the entire JS bus's mutable `pending`/trace object:
  the reviewed native inspection intentionally exposes fewer fields.
- Capabilities explicitly say hybrid JS instruction execution/native memory bus,
  memory-only, no I/O, INTA, IRQ/NMI, HOLD/DMA, full native CPU, live snapshots,
  hot swap, prefetch, silicon instruction timing or bus-HLT signaling.

The current C `bus_submit` deliberately takes **double** address/value arguments
and validates their bounds before u32 conversion; large JS numeric inputs do not
silently wrap through i32 at that boundary. Preserve that contract when adding
adapter validation.

## Explicit bounded CPU method

Retain the existing JS generator and `_pump`. Validate the period budget and
native batch cap, require the explicitly supported board method/capability, and
reject unsupported observer/debugger options before executing.

While running and within budget:

1. Clear `instructionBoundary` as the one-period method does before execution.
2. Ask the board to run at most the remaining budget and per-call native cap.
3. Add the **actual completed periods** returned; reject impossible zero progress
   or count-over-budget rather than looping forever on a malformed adapter result.
4. If the final logical transfer completed, call `_pump(last.operand)` exactly
   once. A first odd-word physical completion alone must not resume the generator.
5. Continue or return budget-exhausted/halted/cancelled with accurate periods and
   retirements. Preserve existing fault-to-CPU-faulted behavior on any exception.

Budget exhaustion keeps the pending native transfer and JS generator intact.
There is no reconstruct/replay of a partial instruction. Every native period
still runs; the saving is fewer JS/native crossings, not instruction/cycle skips.
Browser yielding/cancellation occurs between bounded calls. Choose a conservative
initial cap and measure responsiveness; 8192 periods is an upper bound, not a
guaranteed short task on a slow host.

Register-only instructions still fetch bytes over the bus and can retire while
`_pump` advances to the next fetch. A future instruction breakpoint must be
checked after pumping and before executing that newly pending fetch. R1 should
not silently plug batching into the current circuit-session debugger: that
session's breakpoint/instruction-step loop explicitly uses `stepClock()`.

## Acceptance tests and deliberate refusals

- Boot ROM: ten retirements, RAM words `1234/5678/68ac` at `0500/0502/0504`,
  AX=`68ac`, flags=`6`, final IP=`0118`; reset fetch at `fffff0`, far-jump target
  at `f0100`, and three writes per RAM bank. Compare the complete mapped bytes,
  CPU history and defined state with independently stepped reference execution.
- Loop ROM: 47 retirements, words `[1,2,3,4]`, result 10 at `0510`; the owned
  mismatch variant must take its real failure branch, producing `dead` and 48
  retirements. No host-side success injection.
- Repeated budgets 1, 2, 3, an odd-sized budget and larger batches produce identical
  final results/period counts; alternate ordinary `stepClock` and the new method
  at closed boundaries. Compare ordered physical completions where exposed.
- Stall a fetch and an odd-word store with READY high, exhaust the budget, then
  resume: no premature IP advance, retirement or duplicate write. Preserve both
  halves and the trailing-edge commitment order.
- Removing the ROM low alias must fault after the far jump; disconnecting a RAM
  data wire must fault without a successful hidden write. Edited address wires
  must affect both paths identically. Test owned ROM content mutation after
  construction cannot mutate native storage.
- Owned programs containing IN/OUT, including word/string I/O, must stop with
  the named unsupported-transaction path and no fabricated device/DOS service.
  LOCK/locked transactions, active IRQ/NMI/HOLD/coproc inputs and extra stateful
  topology must remain refused according to the actual native profile.
- Unsupported debugger observation, checkpoint/restore, hot swap and native
  execution-policy selection must be absent or explicitly refused, not silently
  routed to another semantic machine. Ordinary single-period stepping remains
  usable through the unchanged CPU method.

Gate the same tests with checked/admitted/incremental implementations, including
the producer-frontier kernel after integration. **All native CPU and external
driver writes must use `write_owned_driver`** once that frontier is present.
Fresh combined module/source hashes and Chromium validation are required before
making any cross-runtime claim. Passing R1 remains a hybrid memory-only milestone,
not a native CPU, populated-board DOS boot or P7/P9 completion.
