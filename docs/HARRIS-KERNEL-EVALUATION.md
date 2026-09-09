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
