# Actual WASM fast-path census, 2026-10-02

These are instrumented occurrence diagnostics, **not RTx measurements**. They
do not establish a speed gain, replace order-controlled timing or qualify an
engine/app pin change. No hardware acknowledgement was changed.

Core diagnostic source: `16c501c0506d4bde312a04fc4f9d4ae5f8e4b2ec`, based on
unchanged main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, with explicit
`fastpath-census` enabled. The feature is off by default. The
[diagnostic CI run](https://github.com/CrispStrobe/labwired-core/actions/runs/37009962397)
passed formatting, feature-off T16 tests, instrumented T16/counter/bus tests,
and the WASM build. The first attempt failed only because rustfmt was missing;
the corrected run installed it. Compiler and matching bindgen versions, original
module/glue hashes, exact source head and API provenance are retained here.

Harness head: `7214666498c52f4db1b3ee90d97803a5a7caf30d` (individual source hashes
are bound in each receipt). Two separate VPS Node 20.20.2 runs each execute
three 2,000,000-cycle windows per workload after a 200,000-cycle warm-up. GPIO
inputs are held low/high/low. Every window validates actual guest progress,
RAM checksum/mirror consistency and, for GPIO, actual input and BSRR output.
**All counters and guest observations are identical between the two runs.**
Guest binary images and manifest hashes also match. Original ELF container
hashes differ between compilations and are retained individually, not normalized
or presented as byte-identical ELF builds.
An additional actual-artifact integration run passes **101 tests, zero failures,
zero skips**; its complete merged tool output is archived. These correctness
checks do not qualify instrumented throughput.

| Per 2M-cycle window | RAM (all three) | GPIO low (first) | GPIO high | GPIO low (last) |
| --- | ---: | ---: | ---: | ---: |
| Fast-path attempts | 1,995 | 553,084 | 419,688 | 553,113 |
| Zero-progress fast attempts | 0 | 330,876 | 209,058 | 331,121 |
| Zero-progress fraction | 0% | 59.8238% | 49.8127% | 59.8650% |
| Block attempts | 1,995 | 553,084 | 419,686 | 553,113 |
| Memoized block misses | 0 | 553,084 | 419,667 | 553,112 |
| Instructions retired by blocks | 2,000,000 | 0 | 0 | 0 |
| Instructions retired by cached runs | 0 | 1,660,666 | 1,783,590 | 1,660,898 |
| Ordinary successful steps | 0 | 339,334 | 216,410 | 339,102 |
| GPIO cold-hook calls | 0 | 111,111 | 105,263 | 111,112 |
| Cold hooks with no edge-driven devices | 0 | 111,111 | 105,263 | 111,112 |
| Hosted edge services | 0 | 0 | 0 | 0 |

RAM uses the positive block cache throughout the counted windows. GPIO uses
the bounded cached-run fallback; its block probes are already overwhelmingly
memoized failures. Reimplementing discovery-miss caching is therefore not the
next useful experiment. Cached-run executor barriers can occur after positive
progress and must not be equated with zero-progress calls.

The empty-edge GPIO inventory scan is another candidate, but not permission to
cache device membership unsafely: the public device list and live addresses can
change. Preserve routing, edges, debugger/observer guards and cycle ordering.
Occurrence frequency alone cannot say how much cost is removable.

## Next uninstrumented experiment

The unchanged GPIO fixture includes unsupported T16 literal loads on its low
branch. A narrowly scoped candidate bypasses fast-path probing only for that
opcode class; the ordinary interpreter still executes the live load. Native
dispatch is unchanged. Exact opcode classification is checked across all 65,536
halfwords alongside existing T16 differential tests.

Candidate: `45463b863decbe085ffb890edb8d11041594b7f2`, experimental branch
`perf/wasm-literal-barrier-20261002`. Its
[source-test run](https://github.com/CrispStrobe/labwired-core/actions/runs/37013735063)
and [independent WASM build/integration/floor run](https://github.com/CrispStrobe/bw-board/actions/runs/37013838628)
were queued when this report was authored. This is **not yet qualified**; repeated
uninstrumented Node 20/22 and VPS A/B evidence remains required. No Binaryen
recipe or register-inlining experiment is stacked onto it. Do not publish it,
update pins or restamp acknowledgements from these counters.

## Archive

`manifest.json` hashes all 17 evidence files. Two API responses that lacked a
final newline are wrapped reversibly as UTF-8 strings; original bytes are not
normalized. Guest ELF/binary files are wrapped as base64 with original sizes and
hashes. Original module bytes remain in the linked CI artifact/local evidence
directory, not in this repository. The two raw receipts contain complete counts,
guest observations and source/artifact provenance.
