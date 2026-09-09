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

## Selective scheduling iteration

Pure evaluators now use reverse net-to-evaluator adjacency, deduplicated in
original part order. They still evaluate against the same delta snapshot, and
throwing evaluators do not poison the next scheduling attempt.

`memoryScheduling:true` is a separate, default-off option requiring compiled
connectivity. Published logic/conflict changes wake subscribed memory banks.
Idle banks watch power, commands and selection; active banks watch every pin.
A model requesting another solve pass is always evaluated again. All required
bank previews still precede all commits, including late peer-bank failures.
Replacing the registered memory update function invalidates its explicit
event-driven contract and disables skipping for that model. Arbitrary devices
are not inferred to be pure. Watchers live for the immutable circuit's lifetime.

This is memory scheduling only: CPU, controller, DMA master, oscillator and
peripheral updates still retain their original invocation order. It is not
virtual-time fast-forwarding. The original unscheduled compiled path remains
selectable for differential testing and workloads where subscriptions cost more.

```sh
HARRIS_BUS_TRACE=off node bench/harris-wired-backends.mjs 10000 4 --scheduled
HARRIS_NET_BACKEND=compiled HARRIS_MEMORY_SCHEDULING=on HARRIS_BUS_TRACE=off node scripts/probe-harris-dos.mjs 10000000
node bench/harris-owned-workloads.mjs 3
```

The owned benchmark needs no DOS files or network access. It grades memory,
I/O, physical DMA, interrupt-driven HLT and masked idle separately, warms each
mode, checks full reported state and every mapped memory-bank hash, and reports
host/build context. It uses the same populated 640 KiB reference board in all
scenarios. ROM assembly and construction are excluded from throughput; reset
initialization is included. Its clock ratio is explicit (PIT half-period four);
that does not certify instruction or silicon timing.

## Transactional write journal

`memoryWriteJournal:true` independently opts into one-byte write staging for the
registered SRAM/EEPROM models. The model's existing update algorithm decides
the write and its edge; storage is changed only after all peer previews succeed.
This avoids cloning 32 KiB for a byte write. The copy-based path remains the
default and the fallback for replaced/custom update functions. Analog callers
keep immediate edge writes and their existing timestamp argument.

The DOS probe exposes `HARRIS_MEMORY_JOURNAL=on`; the owned benchmark reports a
fourth `journal` mode (compiled + scheduled + journal) separately from the
other three. This preserves an unscheduled and a non-journal comparison path.

## Net-bound decoder specialization

`decoderSpecialization:true` (compiled backend only, default off) uses scalar
and address-vector readers bound once to the actual decoder terminal nets.
No part-name or pin-name lookup occurs inside its address-bit loop. The same
delta snapshot, byte-lane selection, ROM alias, unknown-state rules and output
validation apply. Generic evaluators remain the default and the fallback for
parts without an explicit `compileEvaluate` implementation. Rebuild after
changing a part's logic or wiring; compiled closures are not a live-edit API.

The DOS probe accepts `HARRIS_DECODER_SPECIALIZATION=on`. The owned benchmark
adds `specialized` (scheduled + decoder specialization, without write journal).
For a focused comparison with no other variant changes:

```sh
node bench/harris-owned-workloads.mjs 3 memory,io,dma,interrupt,idle scheduled,specialized
```

The [recorded repeat](HARRIS-DECODER-SPECIALIZATION-BENCH.json) shows mixed
results: about 1.11x memory, 1.16x I/O, 0.93x DMA, 1.08x interrupt and 1.02x idle.
All states match; a concurrent DOS run and variable host load limit attribution.
Do not enable specialization by default on the strength of these results.

## Read-dependent peripheral scheduling

`deviceScheduling:true` (compiled only, default off) tracks the resolved pins
actually read by owned PIT, FDC and keyboard updates. A change to a subscribed
net, or an explicit external revision, causes the next scheduled update to run.
Successful evaluations replace their dependencies; faults remain invalidated,
not cached as successes. Public reset, media replacement, key press and keyboard
write actions invalidate the adapter. Internal fields/private helper methods are
not a supported state-edit API. Host revision counters are scheduling metadata,
not virtual clocks or serialized guest state.

The opt-in identifies the exact owned update function and exact class; custom
updates/subclasses fall back to ordinary evaluation. CPU, controller, oscillator,
DMA master/register updates and PIC evaluation remain on their original call
schedule. In particular, the PIC exposes a mutable core, so this iteration does
not assume its inputs alone determine whether evaluation is needed.

Tests cover dynamic dependencies, external actions, custom fallback, retry after
faults, full owned-workload state/memory agreement, per-period DMA, timer-driven
HLT and READY waits, and BIOS disk/keyboard execution. The complete targeted
suite passes 576 tests, four suites, zero skips. No real-time claim follows.

The probe flag is `HARRIS_DEVICE_SCHEDULING=on`. The benchmark's `events` mode
uses memory + device scheduling, with decoder specialization and journal off.
Set `HARRIS_BENCH_REPORT` to a new path to save the JSON receipt without relying
on terminal scrollback; existing files are never overwritten.

## Packed CPU drives

`packedBus:true` (compiled only, default off) binds CPU address/data driver IDs
once and applies numeric value/Z masks to those actual nets. It avoids creating
24 address and 16 data properties on each period. The normal phase machine,
settling, control pins, bus ownership and physical memory remain unchanged.
Diagnostic output objects are materialized only when requested; tracing still
records real period events. The original object-drive path remains selectable.

The vector driver accepts four-state values, validates the complete masks before
changing any driver, and retains named-net conflict reporting. Tests compare
complete traces through odd writes, waits, HOLD, INTA, NMI and reset; exercise
missing READY/write wires and shorted drivers; and compare DMA/BIOS execution
and every owned workload's CPU/device state and mapped-memory hashes.

The DOS probe accepts `HARRIS_PACKED_BUS=on`; the owned benchmark adds `packed`
(events + packed bus, without decoder specialization or journal). This path has
not yet earned a full DOS boot receipt. The source-pinned successful compiled
DOS boot predates this change. Browser worker validation is described in
[the worker benchmark note](HARRIS-WORKER-BENCH.md).

The [three-round Node receipt](HARRIS-PACKED-BUS-BENCH.json), source-verified at
`eeeffa3`, compares events against packed with no overlapping test/benchmark
process from this lane. All 40 executions agree, including warmup. Median
ratios are 1.02x memory, 1.00x I/O, 1.35x DMA, 1.29x interrupt and 1.08x idle.
Shared-host variation remains large. This is a mixed incremental gain, not a
general throughput breakthrough or evidence to change defaults.

## Cached drive layouts

`driveLayouts:true` (compiled only, default off) caches up to eight validated
output-key layouts per part and reuses typed value staging for ordinary calls.
Keys and values are still validated; a changed shape takes the checked cold
path. The complete batch is staged before any driver changes. Cold misses retain
the original pin/value fault order. Reentrant accessors get independent active
staging, and exceptions release that staging for later calls. Partial drives,
case aliases and four-state resolution retain their original meaning.

This follows the populated-board profile, not a claim that a small cache closes
the capacity gap. The uncached path remains selectable. The DOS environment
flag is `HARRIS_DRIVE_LAYOUTS=on`; the Node and browser benchmark mode is
`layouts` (packed + cached layouts, other gates unchanged). For the browser,
the optional fourth CLI argument selects mode names, for example:

```sh
CHROME_BIN=/absolute/path/to/chrome HARRIS_BROWSER_REPORT=/new/receipt.json node bench/harris-browser.mjs 3 memory,io,dma,interrupt,idle packed,layouts
```

Focused tests cover changing/case-aliased layouts, invalid levels/pins, cold/warm
reentrant getters, every settled net and bus trace through odd writes/READY,
peer-bank atomic failure and owned workload state/memory agreement. Repeated
performance and a full DOS receipt for this new gate remain pending.
