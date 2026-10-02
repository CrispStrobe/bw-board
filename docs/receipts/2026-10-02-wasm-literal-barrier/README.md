# WASM unsupported-literal probe bypass: not production-qualified

The occurrence census suggested skipping repeated fast-path probes for a T16
literal load which none of the specialized executors supports. The isolated
WASM-only experiment passes correctness, but **does not deliver a repeatable
cross-workload performance benefit**. It remains unmerged. Core main, app pins,
production artifacts and all seven physical drift acknowledgements are unchanged;
their existing 2026-10-31 expiry is not extended and hardware re-capture remains owed.
The all-target ≥1× goal and CP13 are still open.

## Sources and verification

- Baseline: `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, original build
  [36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
- Candidate: `45463b863decbe085ffb890edb8d11041594b7f2`, isolated branch
  `perf/wasm-literal-barrier-20261002`, original build
  [37013838628](https://github.com/CrispStrobe/bw-board/actions/runs/37013838628).
- Both builds pass independent determinism and **101 actual-WASM integration
  tests**, with publishing skipped. The baseline run is correctly retained as
  **failed** overall because its unchanged motion floor failed, not because its
  build or integration failed. The candidate's separate fresh motion test passed:
  **1.236514× median / 1.170159× minimum**. That is not a same-runner speedup and
  does not erase the subsequent paired floor failures below.
- [Native correctness run 37013735063](https://github.com/CrispStrobe/labwired-core/actions/runs/37013735063)
  passes exhaustive 65,536-halfword classification and existing T16 differential
  checks. The bypass matches precisely `LdrLit`, leaves native dispatch unchanged,
  and returns to the ordinary interpreter for the live load, bus/fault and cycle
  semantics. It does not cache literal values or dynamic MMIO failures.
- All paired tests use unchanged harness
  `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, original modules and original build
  glue. No optimizer recipe, profiling instrumentation, forced tier or census is
  stacked into these timings. Node 20.20.2 and 22.23.3 are pinned in CI.

Original node module SHA-256: baseline
`7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`, candidate
`8971cf34cd228ec9f4e94bb843b1f37acbe978986a1379a17a7f4d5deaa5340f`.
Both original glue hashes are
`b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73`.
Build manifests and source/API receipts are archived; experiment WASM bytes are
not published here.

## Complete order-controlled results

Each row aggregates two runs of five windows per artifact on the same runner;
different hosted rows can use different CPUs. Values are **median / minimum RTx**.
Δ is candidate median divided by baseline median minus one, not a confidence
interval. The last column retains the unchanged **every-window ≥1×** verdict.

| Runner/order | Guest | Baseline | Candidate | Median Δ | Floor |
| --- | --- | --- | --- | --- | --- |
| GH Node 20 ABBA | motion | 0.620981 / 0.609778 | 0.619038 / 0.570404 | -0.31% | both fail |
| GH Node 20 ABBA | RAM | 2.822403 / 2.762432 | 2.846335 / 2.798749 | +0.85% | both pass |
| GH Node 20 ABBA | GPIO | 0.539823 / 0.495891 | 0.591488 / 0.587678 | +9.57% | both fail |
| GH Node 20 BAAB | motion | 0.604115 / 0.599473 | 0.651277 / 0.642867 | +7.81% | both fail |
| GH Node 20 BAAB | RAM | 2.842236 / 2.789470 | 2.840664 / 2.822634 | -0.06% | both pass |
| GH Node 20 BAAB | GPIO | 0.533383 / 0.515618 | 0.566599 / 0.547190 | +6.23% | both fail |
| GH Node 22 ABBA | motion | 0.828910 / 0.803057 | 0.816323 / 0.793669 | -1.52% | both fail |
| GH Node 22 ABBA | RAM | 2.808919 / 2.753617 | 2.860923 / 2.815749 | +1.85% | both pass |
| GH Node 22 ABBA | GPIO | 0.627689 / 0.580287 | 0.628057 / 0.578819 | +0.06% | both fail |
| GH Node 22 BAAB | motion | 0.989234 / 0.947491 | 0.967936 / 0.939683 | -2.15% | both fail |
| GH Node 22 BAAB | RAM | 3.902094 / 3.692729 | 3.784298 / 3.657402 | -3.02% | both pass |
| GH Node 22 BAAB | GPIO | 0.783560 / 0.760099 | 0.797375 / 0.785448 | +1.76% | both fail |
| VPS Node 20 ABBA | motion | 0.445124 / 0.420390 | 0.448684 / 0.432839 | +0.80% | both fail |
| VPS Node 20 ABBA | RAM | 1.937644 / 1.756971 | 1.963934 / 1.273884 | +1.36% | both pass |
| VPS Node 20 ABBA | GPIO | 0.400835 / 0.341563 | 0.397562 / 0.360410 | -0.82% | both fail |
| VPS Node 20 BAAB | motion | 0.452267 / 0.413223 | 0.440570 / 0.416753 | -2.59% | both fail |
| VPS Node 20 BAAB | RAM | 1.969098 / 1.713362 | 1.976161 / 1.616598 | +0.36% | both pass |
| VPS Node 20 BAAB | GPIO | 0.402437 / 0.379556 | 0.379405 / 0.358059 | -5.72% | both fail |

Hosted runs: [Node 20 ABBA](https://github.com/CrispStrobe/bw-board/actions/runs/37017029132),
[Node 20 BAAB](https://github.com/CrispStrobe/bw-board/actions/runs/37019844810),
[Node 22 ABBA](https://github.com/CrispStrobe/bw-board/actions/runs/37020291459),
[Node 22 BAAB](https://github.com/CrispStrobe/bw-board/actions/runs/37020750279).
All four diagnostic workflows succeeded while preserving failed qualification
windows; workflow success does not mean the performance floor passed.

GPIO regresses in **both VPS orders**, and motion regresses in both Node 22
orders. Even RAM is mixed across hosted orders; its VPS ABBA minimum worsens
from 1.756971× to 1.273884× despite its small median gain. Do not promote this
candidate or update hardware drift acknowledgements from these results.

## Scope, raw evidence and next work

These are selected motion and active F0 RAM/GPIO workloads, not browser/UI,
debugger, circuit-solving, every board, silicon-calibrated CPI or blanket
LabWired ratings. RTx scales engine-reported cycles at the guest's nominal clock.
The old VPS timings preceded the later resource guard: their high shared-host
load is retained verbatim, not relabelled as an idle-host measurement. No owned
compiler, optimizer, profiler or integration job overlapped those timings, but
other users' activity was uncontrolled. New substantial local work must first
check load, MemAvailable and free space on every output/temp filesystem.

`manifest.json` binds 179 original/reversibly wrapped evidence files. Empty logs,
files without a final newline and CR-containing text use `.utf8.json` wrappers
which decode to the original bytes. The initial read-only monitoring TLS failure
and pre-resume state are preserved; no duplicate benchmark was dispatched.
The portable evidence test re-parses all **48 ordinary child runs / 360 windows**
from their actual output, validates guest equivalence, original artifact hashes,
runtime/order and recomputed summaries/floors. Parser tests are not new timings.

Next isolate the MMIO instruction's repeated unsupported RAM probes, using
live effective-address checks rather than a persistent negative cache. First
prove access/fault/bus boundaries and native equivalence; measure the isolated
change on main, without stacking this rejected experiment. A no-edge GPIO
inventory optimization additionally needs an explicit mutation/invalidation
contract: the public, dynamically mutable device vector makes a naive cached
"empty" flag unsafe. Neither proposal is implemented or performance-qualified
by this archive.
