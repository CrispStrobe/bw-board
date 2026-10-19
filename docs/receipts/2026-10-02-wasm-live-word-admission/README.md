# WASM live word admission: consistent hosted GPIO gains, still unqualified

The isolated live-address check improves GPIO medians in **all four hosted
runtime/order comparisons (+1.24–9.12%)**. It moves one Node 22 GPIO run from a
failed minimum of **0.983296×** to a passing **1.032780×** minimum. However, motion
loses **2.24%** in that same comparison, its reverse-order minimum also worsens,
and no new VPS repeat was permitted by the user's resource constraint. This is
promising **partial progress**, not production qualification or an all-target ≥1×
claim. Source remains unmerged; core main, app pins and published artifacts are
unchanged. All seven physical drift acknowledgements and their 2026-10-31 expiry
remain unchanged; hardware re-capture is still owed. CP13 remains open.

## Isolated change and verification

- Baseline: actual core main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, original
  [build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
- Candidate: `03302546de866ae00e805b0a4c791c684c2903c0`, branch
  `perf/wasm-live-word-admission-20261002`, based directly on main. It does **not**
  stack the rejected literal barrier, register-inlining or optimizer experiments.
- The WASM-only admission check rejects a tagged T16 word immediate load/store
  if its **current** effective address cannot fit a primary RAM word. It matches
  `LinearMemory::{read,write}_u32` bounds, including checked subtraction/end,
  target `usize` conversion, unaligned admission and guest address wrapping.
  It reads no bus data, writes no state and performs no bus accounting. No dynamic
  rejection is cached: registers, RAM base and length are queried every time.
  The ordinary interpreter still performs the access/fault/cycle/device handling.
  Native production dispatch and all existing caller guards remain unchanged.
- [Source correctness 37023196876](https://github.com/CrispStrobe/labwired-core/actions/runs/37023196876)
  passes exhaustive 65,536-opcode classification, live boundary/wrapping/register
  checks, RAM rebase/resize admission, primed-block MMIO rejection without
  architectural effects, subsequent RAM re-admission and existing T16 differential
  tests. Native tests compile the same admission primitive deliberately.
- [Candidate build 37023948776](https://github.com/CrispStrobe/bw-board/actions/runs/37023948776)
  passes **two independent builds, byte determinism and all 101 actual-WASM
  integration tests**; publishing is skipped. Its separate fresh motion run
  **fails**: **0.761460× median / 0.758614× minimum**. The overall build workflow is
  therefore correctly retained as failed; it is not relabelled as qualified.
  Baseline also passes build/determinism/integration and fails its motion floor.
- Builds and all comparisons use unmodified pinned tooling. Candidate build and
  paired runs use `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`; build script/workflow
  content was verified identical to the baseline's `1cac10ba...` tooling.
  No instrumentation, optimizer recipe, forced tier or profiling is stacked.

Original node module SHA-256: baseline
`7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`, candidate
`15a8ec726b87c220eb53379e82c5feea32df53445fb50173200a5e8a175f4394`.
Their original glue differs, so every runner explicitly loads its own build glue:
baseline `b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73`,
candidate `339deaca58b4c5a5319f95168b8356a9d0b495905383d1d2166e527c8f2cb3cd`.
Each paired runner verifies the actual module/glue byte lengths and hashes before
timing. Both independent build manifests and the CI verifier step results are
retained. No experiment engine binaries are downloaded to the VPS or published
in this archive.

## All runtime/order results

Every row aggregates two runs of five windows per artifact on the **same runner**.
Values are median / minimum RTx; Δ is candidate median / baseline median minus
one. Node versions are pinned; rows can run on different CPUs and are not a
controlled Node-version comparison. No confidence interval or statistical
significance is claimed. Floor is the unchanged **every-window ≥1×** verdict.

| Runtime/order | Guest | Baseline | Candidate | Median Δ | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| Node 20.20.2 ABBA | motion | 0.592700 / 0.586159 | 0.606127 / 0.601819 | +2.27% | fail / fail |
| Node 20.20.2 ABBA | RAM | 2.811425 / 2.720437 | 2.818067 / 2.763902 | +0.24% | pass / pass |
| Node 20.20.2 ABBA | GPIO | 0.554522 / 0.521912 | 0.593609 / 0.570470 | +7.05% | fail / fail |
| Node 20.20.2 BAAB | motion | 0.860251 / 0.850137 | 0.875598 / 0.860842 | +1.78% | fail / fail |
| Node 20.20.2 BAAB | RAM | 3.834144 / 3.646590 | 3.893416 / 3.698341 | +1.55% | pass / pass |
| Node 20.20.2 BAAB | GPIO | 0.717177 / 0.714005 | 0.782554 / 0.757178 | +9.12% | fail / fail |
| Node 22.23.3 ABBA | motion | 1.251953 / 1.235224 | 1.223947 / 1.188679 | -2.24% | pass / pass |
| Node 22.23.3 ABBA | RAM | 4.241802 / 4.169642 | 4.275214 / 4.222111 | +0.79% | pass / pass |
| Node 22.23.3 ABBA | GPIO | 1.016039 / 0.983296 | 1.061097 / 1.032780 | +4.43% | fail / pass |
| Node 22.23.3 BAAB | motion | 0.812956 / 0.800326 | 0.815102 / 0.788127 | +0.26% | fail / fail |
| Node 22.23.3 BAAB | RAM | 2.829104 / 2.670888 | 2.829449 / 2.764207 | +0.01% | pass / pass |
| Node 22.23.3 BAAB | GPIO | 0.667135 / 0.631766 | 0.675397 / 0.665655 | +1.24% | fail / fail |

Hosted runs: [Node 20 ABBA](https://github.com/CrispStrobe/bw-board/actions/runs/37025192245),
[Node 20 BAAB](https://github.com/CrispStrobe/bw-board/actions/runs/37025469655),
[Node 22 ABBA](https://github.com/CrispStrobe/bw-board/actions/runs/37025757935),
[Node 22 BAAB](https://github.com/CrispStrobe/bw-board/actions/runs/37025951418).
Each diagnostic workflow succeeds while retaining every floor result; workflow
success does not imply qualification. GPIO minima improve in all four runs.
RAM medians rise only **0.01–1.55%**, with no claim that the smallest differences
exceed noise. Motion's Node 22 BAAB minimum drops **0.800326× → 0.788127×** despite
its small median gain; preserve that loss rather than summarizing only medians.

## Scope and next verification

These are selected active F0 RAM/GPIO and micro:bit motion guests at their nominal
48/64 MHz, scaling engine-reported cycles. They are not silicon-calibrated CPI,
browser/UI/debugger/circuit-solving or every-board qualification. The overloaded
VPS was used only for lightweight API orchestration, small receipt downloads
and portable receipt tests. Its preflight at 15:05 UTC refused large work:
four CPUs, load **17.46/15.25/9.06**, approximately **5 GiB MemAvailable** but only
**5.9 GiB volume / 2.7 GiB root free**. No local engine build, optimization,
profile or benchmark was started. Never treat absent VPS repeats as passing ones.

`manifest.json` binds **112** original/reversibly wrapped evidence files:
timestamped build/integration/floor logs, native test output and source metadata,
all paired child output and receipts, job/artifact provenance and controller
state/source. Empty/CR-containing/non-final-newline text uses `.utf8.json` wrappers
which decode to the original bytes. Portable tests re-parse all **32 ordinary
child runs / 240 windows**, recompute medians/minima/floors, validate guest
equivalence and retain actual paired-glue/hash-verification provenance. Synthetic
pipeline guard tests are not measured engine performance.

A separate selective-placement revision moves the same live query inside the
already RAM-eligible entry selector, so unrelated opcodes avoid its extra test.
It also exhaustively proves that word opcodes cannot enter any preceding fast
selector and mutate state before the rejection. That revision requires its own
source/WASM correctness and repeated performance checks; no speedup is claimed
from moving source code. Keep hardware/app pins unchanged until verification
actually supports promotion, and obtain resource headroom before a VPS repeat.
