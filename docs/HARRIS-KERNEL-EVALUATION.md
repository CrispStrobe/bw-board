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

The first native-kernel component will be an owned freestanding four-state net
resolver and a typed connectivity image derived from an already validated
circuit. This deliberately does not claim to port the CPU, phase controller,
memory or peripherals. It is a serialization/resolution correctness gate for
the eventual whole loop. Do not install it as a per-period JS/Wasm replacement
or use its isolated rate as wired emulator throughput. Keep build products in
an explicit temporary build directory until there is an admitted execution
kernel; no production Wasm asset or backend default changes.

## Native resolver prototype gate

Implemented `captureWiredNetImage`, an isolated native wrapper and owned C
resolver. The image captures current driver levels and actual net membership;
it does **not** settle the circuit or promise a resumable device/CPU snapshot.
The wrapper checks dimensions and unique/consistent membership. C validates
offsets, indices and every four-state code before writing any output. Tests
include direct sentinel checks for late native validation failures.

Build in an existing empty temporary directory with Clang and a WebAssembly
linker (the linker's executable name must select its Wasm personality):

```sh
WASM_LD=/absolute/path/to/wasm-ld node scripts/build-wired-net-kernel.mjs /explicit/build/directory
HARRIS_NET_WASM=/explicit/build/directory/wired-net-kernel.wasm node --test test/harris-native-net-kernel.test.mjs
```

The build refuses existing outputs and writes a source/compiler/binary hash
manifest ([recorded build](HARRIS-NATIVE-NET-KERNEL-BUILD.json)). The local run
used Clang 18.1.3 and the existing Rust LLD via a
temporary `wasm-ld` symlink; invoking its generic `rust-lld` name initially
failed before linking. No package installation or new runtime library was
needed. The resulting module has no imports/WASI/host callbacks.

All five explicit tests pass with the module supplied: typed image independence,
four-state/edited-wire agreement against reference and compiled backends,
malformed-image rejection, native output atomicity, and resolution agreement
through populated-board memory transaction periods. Without `HARRIS_NET_WASM`,
the four native tests are explicitly skipped, not passed; the image test runs.
No isolated performance number is promoted to emulator throughput. Porting
combinational evaluation, stateful devices, CPU and chunk execution remains open.

Next prototype step: typed operations for the owned memory decoder, READY OR
and bus-owner mux. Admission must verify the original evaluator identity, not
guess semantics from a part name. Changed/custom evaluators refuse native
admission. All operations read one delta snapshot, stage outputs together, and
publish only on convergence. Validate edited-wire and X/Z behavior and preserve
the previous published result on nonconvergence before considering any board
integration. This still is not the stateful/CPU whole execution loop.

The combinational prototype now has private factory-issued admission
certificates, typed operation/dependency tables, same-delta output staging and
published-state preservation on failure. Native construction first admits the
owned implementations, refuses custom resolve/settle overrides, then settles
that pure-logic source to a canonical compilation boundary. The separate
`captureWiredNetImage` function remains non-settling and read-only.

Only changed **resolved values** schedule an evaluator. A driver change hidden
by another driver must not spuriously reschedule/repair an evaluator output.
This is tested explicitly, alongside decoder window/lane/alias boundaries,
every X/Z address bit, READY chains, bus ownership, nonconvergence and recovery.
The native resolver is not substituted for the full stateful board loop.

Next stateful port: the owned digital SRAM/EEPROM bridge, as an isolated
component first. Preserve its one-pass bus release on cycle changes, write
arming, pending-byte sampling and trailing-edge commitment. All banks must
preflight before any bank state, output or byte write commits. Power, command,
select, address and data faults must retain their original validation order;
inactive address/data pins remain don't-cares. Read-only EEPROM and SRAM
semantics differ deliberately. Compare each preview/commit pass with the
existing registered models and digital adapters before net-kernel integration.
Do not import an arbitrary/custom memory update function into this native port
or claim a full board/CPU snapshot from an isolated bank-state image.

The combinational [build receipt](HARRIS-NATIVE-COMBINATIONAL-BUILD.json) and
[Chromium oracle receipt](HARRIS-NATIVE-BROWSER-ORACLE.json) are preserved. The
browser checks 2,366 actual settle boundaries across 118 periods/11 transactions,
plus all five owned-workload hashes and complete-period cancellation. It is a
one-round correctness smoke run, not a new repeated native throughput claim.
The combined suite with that local module enabled passes **484 tests, four
suites, zero skips/failures**. The native tests include raw malformed-operation,
dependency and limit checks before published output mutation.

Two initial browser runs passed emulation checks but failed temporary-profile
cleanup; they are not the recorded clean receipt. Chrome now runs in a fresh
process group, shutdown covers its own utility children, and an accepted receipt
is written only after profile removal succeeds. This fixes the harness lifecycle,
not an emulator correctness failure. Enable the browser oracle explicitly with
`HARRIS_NET_WASM` pointing to the locally built module; its adjacent build
manifest and current C source hash must agree. No default browser/backend path
loads the native module.

### Isolated native memory component

Implemented the owned ideal-digital 62256/28C256 bridge in `memory-banks.c`,
with an explicitly gated wrapper. This is not a new board backend. The analog
models, JavaScript adapters, application pin and all default paths are unchanged.
The build now links both owned C components without WASI/runtime imports; its
manifest records both source hashes as well as the module hash.

The memory component retains RAM/EEPROM fill differences, one-pass release on
cycle changes, power-on write arming, latest pending-byte sampling and trailing
edge writes. Read-only protection applies to EEPROM, not SRAM. Every peer bank
preflights before actual bank state or storage commits. Inactive address/data
remain don't-cares; active X/Z/contention and power faults remain errors. Private
preview buffers are not published on a failed pass. Safe-integer write counts
carry beyond 32 bits; overflow is explicitly refused before any peer commits.

Nine focused Node tests pass with the native module enabled. They include a
portable oracle: 1,795 passes against the registered JavaScript adapters, four
banks, all 256 byte values and a late-peer failure while writes are pending.
Other tests cover fault pin order, defensive copies and raw native counter
overflow atomicity. The [build](HARRIS-NATIVE-MEMORY-BUILD.json) and
[Chromium receipt](HARRIS-NATIVE-MEMORY-BROWSER-ORACLE.json) are preserved:
both component oracles pass, all five JS workload hashes match, complete-period
cancellation passes and the temporary profile is removed. This is one warmup
and one measured correctness smoke round, not a native throughput result.
The combined wired/x86, memory and peripheral command passes **493 tests,
four suites, zero failures/skips** with this native module enabled.

Limits: at most 32 initialized owned banks, no arbitrary model admission, no
live-state import or resumable board snapshot, no analog electrical semantics.
Detailed net-driver fault diagnostics still belong to the circuit layer.
Separate per-call oracle bridges are deliberately test machinery, not the
intended production hot path.

Next integration gate: one private native arena containing actual-net mappings,
owned combinational operations and memory state; a native memory-settle loop
must preserve all-peer preflight and the existing settle/commit order. Validate
edited wiring, shared data buses, byte lanes, failures and convergence before
porting the controller/latch, CPU bus sequencer and remaining devices. Only a
complete chunk runner can support the whole-kernel throughput comparison.

### Coupled memory/net loop checkpoint

The next prototype now keeps net resolution, owned combinational evaluation,
memory pin gathering, all-peer previews/commits and memory-drive publication in
one native arena. `settle_memory_circuit` repeats the existing two-settle memory
pass order without crossing into JavaScript between passes. Explicit owned
bank descriptors are bound to actual validated terminal/driver IDs; no address
callback or hidden RAM read substitutes for the wires. The standalone component
and reference paths remain available.

Eight new focused tests pass, including 1,026 full-net/full-storage comparisons
each with normal and swapped address wiring, compiled-reference agreement,
read-only EEPROM, byte-lane selects, contention, a late peer power fault,
nonconvergence/retry, defensive arrays, rejected live/custom model imports and
raw malformed-mapping rejection before any state/net mutation. All native
components plus the existing memory-model tests pass together: **41 tests,
four suites, zero failures/skips**. The complete combined wired/x86, memory and
peripheral checkpoint passes **501 tests, four suites, zero failures/skips**.
The coupled [build](HARRIS-NATIVE-MEMORY-CIRCUIT-BUILD.json) and
[Chromium receipt](HARRIS-NATIVE-MEMORY-CIRCUIT-BROWSER.json) are preserved.
Chromium passes 1,026 coupled memory/net comparisons, both earlier component
oracles, all five JS workload hashes, cancellation and profile cleanup. This
remains a one-round correctness smoke run, not native execution throughput.

Failure semantics are per pass, not transactional across an entire settling
call: a failed peer preview commits no peer; a later convergence failure does
not roll back an earlier successfully committed pass. Published and pending
net states retain the reference distinction. Mapping/limit admission happens
before execution. This is still not a clock runner, board backend, live-state
importer, complete fault-diagnostic replacement or performance result.

Do not stitch this into the JS board by copying just final net levels back:
doing so could lose intermediate evaluator dependency history and scheduler
state. The next port must own the controller/latch and the explicit settle
boundaries, then the bus sequencer and peripheral clock interactions, before
claiming a complete execution backend.

### Isolated controller/latch port

The owned ideal address latch and memory-phase controller now have a native
component prototype. These retain the existing model's limitations: this is
not a full 82C288, AC-timing model or CPU/bus sequencer. Defaults are unchanged.
Seven focused Node tests pass, including all 16 binary status encodings under all
I/O/INTA gate combinations; TS/TC progression, READY waits, first-INTA-cycle
wait, reset behavior, clock/status faults and preview-before-finish ordering.
The latch samples only under ALE and validates the complete word before
changing retained bits. X/Z/contention remain errors on sampled pins.

A portable oracle covers 360 modeled controller periods and 128 latch
observations against the existing JS components. The [build](HARRIS-NATIVE-PHASE-BUILD.json)
and [Chromium receipt](HARRIS-NATIVE-PHASE-BROWSER.json) are preserved. Chromium
passes this oracle, all earlier native oracles, the five JS workload hashes,
cancellation and profile cleanup. The combined wired/x86, memory and peripheral
suite passes **508 tests, four suites, zero failures/skips** with this module.
This is still a correctness checkpoint, not a native board throughput receipt.
The controller counter uses two words; raw tests verify 32-bit carry and refusal
of unsafe-integer overflow before state/output mutation.
No live/custom controller state import or whole-board clock backend is exposed.

Next: bind these components to the existing actual-net/memory arena and compare
every begin/preview/end boundary. Keep READY acceptance before trailing-edge
memory commitment, retain clock-order/fault latching, and validate reset during
an outstanding write. Only then add the CPU bus sequencer and device clock
interactions; component-level success does not close the 4.77 MHz gate.

### Actual-net latched-memory clock prototype

An explicit `owned-latched-memory-v1` descriptor now binds the controller and
latch to the same native arena as the actual-net/memory loop. Each begin/end
boundary retains pure settling, controller commands, transparent latch sampling
and memory-settle ordering. Native state owns the intermediate transitions;
final levels are not copied into a JS execution backend. The standalone
memory-only API remains available when this descriptor is absent.

Six focused tests pass: 1,532 begin/end comparisons over 128 reads/writes with
waits; changed host addresses after ALE; compiled-reference reset during an
armed write; TC2 READY faults without trailing-edge writes; clock-order
recovery versus latched circuit faults; disconnected latch wiring; and I/O/
INTA keeping memory deselected. All native components plus registered memory
tests pass together: **54 tests, four suites, zero failures/skips**.
The broader wired/x86, memory and peripheral checkpoint passes **514 tests,
four suites, zero failures/skips**. The [build](HARRIS-NATIVE-PHASE-CIRCUIT-BUILD.json)
and [Chromium receipt](HARRIS-NATIVE-PHASE-CIRCUIT-BROWSER.json) are preserved;
Chromium passes all 1,532 phase boundaries plus the prior component oracles,
five JS workload hashes, cancellation and temporary-profile cleanup.

This clock path deliberately lacks the CPU bus sequencer and peripheral clock
interactions. It is not selectable as a complete board or application backend.
Full CPU acceptance, READY cross-checks, DMA ownership and IRQ sequencing must
be integrated before it can replace the existing board begin/end loop.

Before expanding the port, `bench/harris-native-phase.mjs` measures this small
two-bank controller/latch/net/memory circuit against reference and compiled JS.
It excludes construction and final hashes, includes sampled read checks and
the current native wrapper's input/output copies, alternates modes with warmup,
and compares final net/driver/storage hashes. This is a component cost probe,
not full-board throughput, an RT ceiling estimate or the 4.77 MHz acceptance
test. Its ratio must not be extrapolated to CPU/DMA/peripheral-heavy workloads.

The first [component cost receipt](HARRIS-NATIVE-PHASE-COST.json) passes all
final hashes and sampled reads over one warmup plus three alternating measured
rounds. Each run executes 4,098 periods with 1,024 byte-bank writes and 1,024
read observations. Median periods/s: reference 11,269; compiled JS 12,968;
native 31,063 (about 2.40x compiled). Native elapsed spread is 85.9–181.7 ms,
so shared-host noise is substantial. No whole-board performance claim follows.

This is not enough to support the RT target. The current native wrapper still
validates/copies complete driver images and allocates diagnostic arrays at every
begin/end boundary. Next cost-isolation step: a bounded, prevalidated native
schedule runner for this owned fixture, retaining every modeled period and
actual-net read check inside the module. Compare with the same schedules and
hashes to separate host-boundary costs from native settling costs before
assuming that porting more components alone solves throughput. This synthetic
schedule is test machinery, not a substitute for the eventual CPU/device runner.

### Bounded native fixture schedule

The cost-isolation runner is implemented behind an additional explicit
`phase.schedule` descriptor. It admits only one named ideal input-driver part,
actual read-pin nets and bounded capacities (at most 8,192 periods per call).
Compiled schedules are private, defensive and tied to their native instance;
callers cannot forge a handle to drive internal controller/latch/memory outputs.
The native entry validates the entire schedule before modifying pending drives
or clock state, then executes every begin/end boundary and selected net read.
No CPU instruction, wait period or memory transition is fast-forwarded.

Five focused tests pass: final net/phase/full-memory agreement with the
every-period oracle over 258 periods; defensive/instance-owned admission;
read-mismatch stopping at its real boundary without rolling back earlier writes;
and raw late-invalid-update rejection before pending-drive mutation. Read-check
failures deliberately stop and fault the test runner; this diagnostic contract
is not presented as a guest CPU fault. All native components and registered
memory tests pass together: **59 tests, four suites, zero failures/skips**.
The [build](HARRIS-NATIVE-SCHEDULE-BUILD.json) and
[Chromium receipt](HARRIS-NATIVE-SCHEDULE-BROWSER.json) are preserved. Chromium
passes the 258-period/64-read schedule oracle, all earlier native oracles, all
five JS workload hashes, cancellation and profile cleanup. These component
checks extend the prior 514-test broader checkpoint; they are not a claim of a
new full DOS run or a newly measured whole-board backend.

The repeated [batched cost receipt](HARRIS-NATIVE-BATCHED-PHASE-COST.json)
passes all reads and final hashes in every mode. In this run, median periods/s
are reference 8,280; compiled JS 7,776; per-boundary native 14,303; native-batched
50,682. Batching is about 3.54x the per-boundary native wrapper in this run,
including schedule upload/admission but excluding schedule compilation. The
native-batched elapsed spread is 50.0–81.7 ms for 4,098 periods. Host load is
uncontrolled; do not compare absolute speeds with the earlier receipt as a
regression or multiply gains across runs.

Even this CPU-free two-bank circuit is far from the requested full-board
capacity. Next, profile native schedule execution separately from preparation
and JS diagnostics. In particular, test the cost of repeated invariant graph
validation and whole-net scans before choosing the next optimization. Neither
Wasm alone nor removing host calls has demonstrated the required capacity.

The [native schedule profile](HARRIS-NATIVE-SCHEDULE-PROFILE.json), pinned to
`061465b`, attributes 451 of 623 schedule-stack samples (72.4%) to `settle_owned`.
Two JS upload frames account for 75 samples (12.0%). Inlining prevents treating
the first figure as validation alone: it also includes resolution/evaluation.
The filter includes warmup and measured schedule calls, excludes setup/other
modes, and cannot attribute GC samples lacking schedule ancestry. This is one
sampled profile, not a repeated timing result.

Next measured experiment: preserve the fully checked native entry, but add an
explicitly gated private-context admission path that validates immutable graph
tables once. Runtime input codes must still be validated at host/schedule
boundaries, and every native writer must preserve four-state codes. No caller
may access or mutate the admitted arena through the returned wrapper. Refuse
unadmitted fast execution, compare all fault/state/net oracles, and measure
against the fully checked path before selecting it. Dirty-net/event work may
still be needed; the profile does not prove which settling substep dominates.

### Private immutable graph admission experiment

Implemented default-off `admittedGraph` for the private native memory/phase
context. It validates graph/dependency/operation tables and limits once, then
uses the same settling body as the fully checked entry. Dynamic host and
schedule input-code checks remain enabled; native writers retain four-state
codes. The wrapper exposes only defensive observations, not module memory or
mutable context tables. Raw native pointers are still a trusted internal ABI,
not a sandbox for arbitrary caller-mutated tables.

Admission is bound to the exact context pointer in its private module instance;
unadmitted execution fails, and a failed re-admission revokes the previous grant.
Three new tests pass, including memory/phase/schedule oracles, edited wiring,
contention/nonconvergence, invalid host inputs and raw admission/refusal cases.
The focused admitted/net/evaluator/memory-circuit set passes **24 tests, no
failures/skips**.
All native components and registered memory tests also pass together:
**62 tests, four suites, zero failures/skips**. The
[Chromium receipt](HARRIS-NATIVE-ADMITTED-BROWSER.json) passes admitted memory,
phase and schedule oracles, all earlier oracles/workload hashes, cancellation
and profile cleanup. The fully checked path remains available and default.

The first [repeated component measurement](HARRIS-NATIVE-ADMITTED-PHASE-COST.json)
shows only a small median gain:
68,236 periods/s admitted versus 63,527 fully checked batched (about 1.074x),
with overlapping elapsed ranges. This is not strong evidence of a stable gain,
and neither path is selected as a board backend. Retain the valid experiment
behind its gate. Repeated whole-net scanning/resolution remains the next
candidate; validation alone did not account for the profiled settling cost.

The cost harness now chunks prepared schedules against both period and update
capacities, rather than only the period cap. This preserves larger workload
counts without exceeding the private schedule arena; compilation remains
outside the timed region and every period/read is still verified.
The [larger capacity smoke run](HARRIS-NATIVE-SCHEDULE-CAPACITY-SMOKE.json)
passes 8,194 periods in all five modes, using multiple bounded schedule calls
with identical final hashes and read counts. It is one smoke round, not another
repeated performance result. The [native build](HARRIS-NATIVE-ADMITTED-BUILD.json)
uses memory-context ABI 2 and records source/module hashes.

### Current cooperative hybrid attribution

The current [hosted producer receipt](HARRIS-HYBRID-PRODUCER-ATTRIBUTION.json)
measures the real cooperative memory-only CPU path after incremental dirty-net,
operation-bitset and phase-schedule-delta work. Harris qualification run
`34696776443` and ordinary CI run `34696776489` are green at exact source
`1144fd8`. Alternating control and instrumented executions preserve the same
57,392 periods, 6,148 retirements, 57,459 physical clocks, CPU/memory hash and
all twelve native work counters. The receipt also reconciles returned native
periods, the initialized pending transaction, chunks/yields and completion hash.

Native work remains the primary measured cost. The CPU profile's leading native
self samples are settling 161, memory preview 71, incremental settling 61,
driver publication 52 and bus-begin work 45. JS `runUntilCompletion` records 43
self samples and about 200 KB of sampled self allocation, so a compact result
reader is plausible but is not selected by this evidence. The combined nested
timer around native execution and JS result construction has a 176.2 ms median
versus 20.9 ms instruction pumping, 7.2 ms submission and 10.9 ms CPU receipt
control. It cannot split native execution from result materialization.

The next bounded experiment is diagnostic per-producer counting in the native
bus, phase and memory publication paths. Record attempts and actual value changes
for each producer, preserve all existing semantic and work-counter receipts, and
use the result to decide whether sparse bus-output publication has enough causal
weight to implement. Do not infer that choice from the aggregate 5,749,404
driver comparisons or from profiler self samples alone.
