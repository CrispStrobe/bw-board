# Same-instance native memory bus fixture

This default-off P7-R1 prototype joins the owned 286 **memory bus sequencer**,
actual digital nets, controller/latch and registered-memory-compatible native
banks in **one private Wasm instance**. It is not an instruction core, complete
PC/AT, DOS runner, app backend or throughput qualification. No CPU instructions,
events or periods are skipped. No guest media or third-party implementation is
included.

It requires the phase ABI 2 captured-preview/finish seam documented in
`NATIVE-END-CLOCK-SEAM.md`. The standalone bus constructor remains available and
isolated; this joined path creates its bus through the memory factory's own
private instance, never through public raw-instance injection.

## Explicit admission

```js
const fixture = await createNativeMemoryCircuit({
  enabled: true, circuit, banks, wasmBytes,
  phase: {
    kind: 'owned-latched-memory-v1',
    controller: 'controller', latch: 'latch'
  },
  bus: {
    kind: 'owned-286-memory-bus-v1',
    cpu: 'cpu', inputPart: 'host', maxWaitStates: 1024
  }
});
```

`bus` defaults to `null`, preserving the previous memory/phase-only paths. Joined
admission requires exact owned CPU pin/output contracts, one explicitly named
ideal external-driver part, the memory-only controller/latch and declared banks.
Only already-certified pure evaluators may exist beyond those named components.
Undeclared stateful/external parts, extra bus options, I/O/interrupt phase modes
and a simultaneous bypass phase schedule are refused. Actual input-net and
output-driver IDs come from captured connectivity; there is no hidden CPU
address-to-RAM shortcut. A wrong supported wire remains a wrong wire and is
simulated rather than silently corrected.

The owned C bus state permits one bus per instance. No live JS CPU/device state
or resumable snapshot is imported. Neither the module's raw memory nor a private
instance handle is returned. `nativeMemoryBus` marks this capability; `cpu` and
`board` remain false to avoid declaring a complete machine.

## Exact period order

Begin:

1. Apply validated external driver updates and settle actual nets.
2. Gather CPU input nets; run native bus begin and stage its actual output-driver
   values; settle.
3. Begin controller, settle, update latch, then settle memory banks and their
   resulting net drives.

End:

1. Preview the controller, capturing READY without releasing commands.
2. Verify that the CPU and controller see the same required READY value.
3. Sample the bus transfer and its actual resolved data nets.
4. Only after successful sampling, finish the controller and settle the trailing
   command transition that commits pending memory writes.

A controller preview fault or READY mismatch does not advance the bus clock.
A CPU sampling fault may already advance it, matching the reference; it prevents
controller finish and memory's trailing-edge write commit. Board faults latch
and require reconstruction, even where standalone bus reset could recover.
Earlier completed odd-word bytes and writes are not rolled back. Full nets,
drivers, pending memory state and controller/bus phase history are compared by
the oracle, including these failure cases.

The raw bus input bridge adds a private resolved-contention marker (`4`) distinct
from unknown `X`; this is gathered from resolver conflict metadata, not a fifth
user-supplied logic level. Public standalone images retain `0/1/X/Z`, with no
getter/callback ordering guarantee. Both JS wrappers recognize `CONTENTION`.

## Bounded host transactions

The public joined methods are `beginClock(externalUpdates)`, `endClock()`,
`submit(transaction)`, `runUntilCompletion(options)`, and defensive inspectors.
They do not expose phase preview/finish, schedule or arbitrary driver injection
methods that could bypass bus sequencing.

After the required 17 reset plus 50 init periods:

```js
fixture.submit({kind: 'memory-write', address: 1, width: 2, value: 0xabcd});
const result = fixture.runUntilCompletion({maxPeriods: 20, inputs: {ready_n: 0}});
// {completed, stopReason: 'completed' | 'budget', periods, completions}
```

`maxPeriods` is 1..8192. External input levels stay fixed throughout this bounded
call; the native loop still performs every begin/end period and memory edge.
Budget exhaustion is a resumable stop, not a fault; a caller may change READY
before the next bounded call. Each result contains only that call's physical
completions, including a first odd-word byte if the second has not completed.
Invalid updates and open-period/order errors do not mutate pending state.

A failing run throws the specific fault with immutable `error.progress`:
`{stopReason:'fault', periods, completions, busClock}`. `periods` and completions
count **fully successful earlier period boundaries**, not the faulting partial
period. `busClock` reports its possibly already-advanced state separately. This
does not claim that a whole failed period was atomic or that memory writes from
earlier periods were undone.

## Tests and limitations

`scripts/lib/harris-native-bus-circuit-oracle.mjs` has no Node dependencies and
constructs the owned JS reference board pipeline from the existing bus,
controller, latch, actual-net circuit and registered memory adapters. Its main
fixture compares **830 boundaries, 48 transactions, 63 physical completions**,
including complete 64 KiB memory and net/driver/state agreement.

The focused bridge suite passes **10/10, no skips** with an explicit native build.
The combined `test/harris-native-*.test.mjs test/bus-memory.test.mjs` selection
passes **97/97 tests across 4 suites, no failures/skips** on the component build.
It covers checked/admitted/incremental settling, swapped address wiring, bounded
wait/odd-word resume, ordered READY and sampled-data faults, no trailing-edge
commit on failures, malformed admission, bypass refusal and immutable partial
progress. Without a supplied native build, those native tests explicitly skip.
No browser validation of this joined fixture or full-board capacity measurement
is claimed here.

```sh
HARRIS_NET_WASM=/path/to/wired-net-kernel.wasm \
  node --test test/harris-native-bus-circuit.test.mjs
```

The next architectural work is CPU instruction integration and required device,
interrupt and DMA scheduling, with complete-board reference comparisons. This
small memory-only host transaction fixture does not satisfy those requirements.

## Driver-writer frontier integration warning

All new bridge driver writes pass through the single C `stage_bus_driver` seam.
This version targets the existing scan-discovered incremental backend. When
integrating a producer-marked dirty frontier, replace that seam with its
authoritative `write_owned_driver(context,id,code)` path and check returned
errors. Do not leave direct array writes that bypass dirty marking. Root's
separate frontier lane owns that integration; no unverified frontier dependency
has been pulled into this component branch.
