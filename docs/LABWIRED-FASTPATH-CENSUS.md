# WASM fast-path census

This is a separate, explicitly instrumented diagnostic lane, **not a benchmark**.
It identifies zero-progress dispatch attempts, discovery work and GPIO hook
activity before selecting the next source-level optimization. It cannot report
RTx, qualify an optimization, or justify hardware acknowledgement changes.

The experimental core branch `perf/fastpath-census-20261002` adds the explicit
`fastpath-census` feature, off by default in core and WASM. Its workflow runs
feature-off/instrumented T16 correctness and instrumented bus tests, then uploads
an unpublished module with source/version/hash receipts. The production build
workflow, artifact defaults and app pins are unchanged.

Download the `fastpath-census` artifact from a successful run in
`CrispStrobe/labwired-core`, retaining its metadata beside `nodejs/`. Run with an
exact full source commit from `source-head.txt`:

```sh
node scripts/probe-labwired-fastpath-census.mjs \
  --wasm /absolute/path/to/artifact/nodejs \
  --source FULL_40_HEX_COMMIT \
  --out /absolute/path/to/new-evidence-directory
```

The harness verifies source metadata and original module/glue hashes, refuses
overwrites, compiles the unchanged F0 RAM and GPIO fixtures, warms each machine
for 200,000 engine cycles, then records three separate 2,000,000-cycle windows.
Held GPIO input changes low/high/low. Counters reset **after** changing the
input and are captured **before** reading RAM/GPIO receipts. Only one machine
runs in a reset window. Actual guest progress, checksum/mirror consistency,
input readback and BSRR output are checked alongside exact counter accounting.
Raw counts are saved before validation so failed captures remain diagnosable.

`receipt.json` retains the compiler, runtime, artifact hashes, harness/source
file hashes, compiled guest hashes, raw counts, fractions and guest observations.
The original guest ELF/binary files are saved alongside it. No clock timing is
collected: instrumentation changes layout and adds overhead, while occurrence
frequency alone does not establish cost. Native dispatch is not equivalent to
WASM dispatch and cannot substitute for these captures.

`FastRetired` includes all successful fast paths; `BlockRetired` and
`CachedRunRetired` are overlapping subsets, not additional retirement.
`OrdinaryRetired` covers successful ordinary calls only in the concrete
SystemBus batch loop. Empty denominators produce `null`, not zero-cost claims.
The census is thread-local, not per-machine, and cannot attribute interleaved
machines. The existing uninstrumented order-controlled performance and fidelity
lanes remain necessary before any source candidate can be promoted.
