# Native 286 memory bus sequencer component

This is a **default-off standalone component**, an owned port of the existing
`Harris80C286Bus` ideal-system-period memory subset. It is a prerequisite for
P7-R1, **not completion of P7-R1**, a CPU, registered backend, wired-board runner,
or a 4.77 MHz performance result. No guest media or third-party implementation
source is included.

## Boundary and API

`src/experimental/wired-kernel/bus-sequencer.c` owns transfer planning, persistent
bus state, reset/init counters, TS/TC/TI sequencing, READY waits, lane driving,
accepted transfer bytes and write-data hold. The JS wrapper owns only admission,
pin-image conversion, error/result conversion and defensive inspection. It does
not read or write a backing RAM array. Memory/controllers must still implement
their own actual wired write edges and the circuit must resolve before sampling.

```js
const bus = await createNative286MemoryBus({
  enabled: true, module: ownedWasmModule, maxWaitStates: 1024
});
bus.submit({kind: 'memory-read', address: 0x12345, width: 2}); // after reset/init
const drives = bus.beginClock(resolvedInputPinImage);
// Apply drives, run the circuit's settling/phase work, form its resolved image.
const completion = bus.endClock(resolvedEndPinImage);
const diagnostic = bus.inspect();
```

Each wrapper creates its own private Wasm instance; no memory/state pointer is
exposed through this JS API. The raw C ABI is trusted internal implementation
machinery, not a public mutable-state/snapshot interface. It is built optionally
with the existing owned native build script, with no imports or WASI dependency.
No production factory or app default selects it.

Inputs are **plain resolved pin-level images**, not callbacks. `0`, `1`, `X` and
`Z` are represented natively. Omitted/non-level values become unknown, not zero.
The wrapper copies the image without eagerly faulting on unknown/floating pins;
C samples relevant pins in reference order. It does **not** promise observation
ordering for getters, proxies or arbitrary callbacks while copying an image.
Contention must already be represented by the resolver's resulting `X` level;
this component is not a resolver and accepts no separate analog/conflict model.

## Supported semantics and explicit refusals

- Memory read, code read and memory write; byte, aligned word and odd word.
  Odd words split into high-lane then low-lane physical transfers. Address wrap
  beyond `0xffffff` is refused before accepting the request.
- Reset requires **17 complete system periods**, followed by **50 init periods**.
- TS/TC/TI phases and READY sampling at TC phase 2 match the JS reference.
  `maxWaitStates` is a host diagnostic limit, not a hardware timeout.
- Writes drive active lanes starting at TS phase 2; the accepted drive remains
  for one following complete period. Inactive lanes are high-impedance in this
  owned subset, not a claim about physical unused-lane silicon values.
- Completion data comes from sampled net data even for writes, not blindly from
  submitted values. Earlier completed odd-word bytes survive a later fault;
  bytes in a failing physical transfer are not partially accepted.
- Clock-order errors do not latch a bus fault. Sampling errors preserve the
  reference's already-applied counter/phase/open-state mutations and require
  reset recovery. Reset cancels pending transactions.

I/O, INTA and locked transactions are refused. Unknown transaction fields and
extra constructor features are refused rather than ignored. HOLD is checked
even during reset. Outside reset, PEREQ/INTR/NMI and active BUSY/ERROR inputs are
refused in the reference order. Reset suppresses the same unsupported input
checks as the reference. Unsupported transaction requests report
`UNSUPPORTED_TRANSACTION`; this deliberate subset refusal is not an assertion
that the broader JS reference rejects I/O or LOCK. Availability refusal precedes
transaction validation, and submission failures do not mutate bus state.

No interrupt, DMA/HOLD, NMI, LOCK, coprocessor, address pipeline, CPU execution,
protected mode, full pin-edge/AC timing, snapshot migration or bus trace API is
provided. UI backend selection must not register this component as a complete
machine. The per-period JS image uploads and returned objects are a correctness
boundary, not a proposed optimized full-runner hot loop.

## Verification and remaining integration

Portable helper: `scripts/lib/harris-native-bus-sequencer-oracle.mjs`.
Its normal fixture compares **782 begin/end boundaries, 30 transactions and 36
physical completions**, including every output pin, phase, pending bytes and
diagnostic state against JS. Node's focused suite adds all 256 byte values across
three transaction kinds, both address parities and odd-word operands; reset and
ordered fault cases; wait limits; active-lane sampling; write-data hold; and
unsupported request atomicity. No architectural instruction suite is implied.

```sh
WASM_LD=/path/to/wasm-ld node scripts/build-wired-net-kernel.mjs EXISTING_NEW_DIR
HARRIS_NET_WASM=EXISTING_NEW_DIR/wired-net-kernel.wasm \
  node --test test/harris-native-bus-sequencer.test.mjs
```

Without `HARRIS_NET_WASM`, native-dependent tests explicitly skip; gate validation
still runs. With the built module the focused suite passes **13/13, no skips**,
including added phase-by-phase reset, unknown-pin sampling matrix and private
instance/stale-completion checks. Before those three audit tests were added, the
complete `test/harris-native-*.test.mjs test/bus-memory.test.mjs` selection passed
**77/77 tests across 4 suites, no failures/skips** on the same unchanged C build.
The portable helper has no Node imports, but a browser run has **not** been
performed for this new component. Safe-integer wait-limit acceptance is tested;
exhausting the 53-bit clock/reset range is not practically exercised.

Next: integrate into one native actual-net execution region after controller
sample/finish ordering is established, add required CPU/peripheral scheduling
and interrupt/DMA semantics or refuse incompatible projects, compare complete
board traces/state, and only then assess whole-runner performance and admission.
Existing compiled/reference backends and all default gates remain unchanged.

## Audit and minimal same-instance integration seam

The audit found no differential implementation mismatch in the reviewed subset.
One raw-ABI pitfall is explicit: after a clock-order failure, completion storage
may retain the last successful result. Raw callers must check `bus_end` status
before consuming it. A sampling failure clears completion validity; the JS API
always checks status before reading any completion and never returns stale data.
Raw initialization requires a validated positive safe-integer wait bound; raw
pointers and mutable module memory are trusted, not hostile-input interfaces.

The current public bus constructor creates a **different private instance** from
the phase/memory constructor. Calling those wrappers in sequence does not form a
single native execution region. Minimal future integration is an explicit owned
descriptor admitted by the existing private memory/phase factory, not public
instance injection:

1. Validate all CPU input-net and output-driver IDs against actual connectivity;
   initialize one bus inside that already-owned module instance. The current C
   static state allows **one bus per instance**; do not attach a second bus or
   reinitialize a running one. Supporting several buses later requires separate
   allocated bus contexts.
2. On begin, settle external inputs, gather CPU pin levels, call bus begin, stage
   its actual driver levels, settle, then run controller/latch/memory begin.
3. On end, preview the controller first and compare controller/CPU READY; sample
   bus completion from current resolved nets **before** controller finish and
   trailing-edge memory settling. Preview/READY/bus sampling failures must abort
   without running the trailing-edge commit. Match board-level fault latching
   separately from standalone bus reset recovery.
4. Qualify this joined memory-only fixture before adding bounded host-request
   batches. That still does not supply CPU instructions, DMA/interrupt devices or
   admission for a full machine.
