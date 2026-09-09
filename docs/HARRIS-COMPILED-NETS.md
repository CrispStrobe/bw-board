# Indexed connectivity backend: first compiled-wired iteration

2026-09-09. Explicit `netBackend:'compiled'` option on the experimental Harris
board. Default remains `reference`. This iteration compiles connectivity and
driver layout, not CPU instructions or stateful device scheduling.

`CompiledDigitalCircuit` uses the same validated, edited netlist and initial
pure-combinational settlement as `DigitalCircuit`, then assigns integer net
and driver indices. Current/published logic and conflict state live in typed
arrays. Driver lists retain deterministic diagnostic order. The public API
materializes defensive diagnostic maps only on request; ordinary reads avoid
building per-net diagnostic objects. Canonical pins and optional bound readers
retain the same case normalization, named errors and settled-read semantics.

The reference backend remains intact. Custom resolver replacement is explicitly
refused by the indexed backend, not silently ignored; select the reference
backend for that diagnostic hook. Topology is immutable after construction.
`snapshot` and `drives` are diagnostic views, not a supported mutation API.

## Evidence

- Exhaustive three-driver four-state resolution comparisons, reversed topology
  order, alias/atomic batch checks, omitted-output release, public resolution
  versus settled reads, and nonconvergence/recovery.
- Complete sampled net snapshots/bus outputs for wired RAM, bank boundaries,
  odd words, text RAM and READY waits; matching memory writes and traces.
- Per-period DMA ownership/data/controller-strobe comparisons for disk reads,
  writes/readback and verify, plus matching guest and memory state.
- The real BIOS disk and keyboard integration fixtures run on both backends.
- Targeted suite including the new oracle-adapter tests: **525/525 pass**,
  zero skips. This does not mean compiled DOS boot has yet been accepted.

The [four-pair startup receipt](HARRIS-INDEXED-NETS-BENCH.json) records median
10,000-period POST times of **6,145 ms reference / 5,347 ms indexed**, about
**1.15x throughput**. All eight reported-state hashes agree. Both modes retain
bounded per-period bus tracing. Shared-host noise and concurrent original boot
are recorded; this is not a steady-state ceiling or full-boot speed claim.

```sh
node bench/harris-wired-backends.mjs 10000 4
HARRIS_NET_BACKEND=compiled node scripts/probe-harris-dos.mjs 10000000 /tmp/compiled-dos-result.json
```

Existing local DOS inputs are required; neither command downloads or hosts
media. The latter command is a reproduction route, not an already-passed run.
Next: bound device access, explicit trace-off measurements, affected-device
scheduling, and whole-kernel execution under the [performance plan](WIRED-X86-PERFORMANCE-PLAN.md).

## Bound access and bus trace control

Board construction now caches all device and memory pin bindings. Reference
bindings still dynamically dispatch diagnostic overrides. `busTraceEnabled:false`
suppresses bus-record allocation, not resolution, sampling, faults or CPU history.
It defaults to true; the probe accepts `HARRIS_BUS_TRACE=off` explicitly.

The expanded targeted suite passes **526 tests**. The new
[four-pair bus-trace-off receipt](HARRIS-BOUND-NETS-BENCH.json) records median
6,387.5 ms reference / 5,390.5 ms compiled (1.18x), with identical reported state.
This compares current backends, not the isolated effect of disabling tracing;
the host load varies substantially. It does not establish a whole-boot result
or the real-time capacity gate. Stateful device scheduling remains unchanged.
