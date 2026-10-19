# WASM shared-register-helper experiment — not qualified

Baseline core: `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`. Candidate: `0d32815a28b1cf7e27a87ba760ec7acd34cb4086`, direct baseline child on `perf/wasm-register-helper-sharing-20261003`. No rejected experiment is stacked. Only two WASM-only `inline(never)` attributes are added to `read_reg` and `write_reg`; their bodies, special/invalid register semantics and native compilation policy are unchanged. Reversing just those two attributes reconstructs the production CPU byte-exact. No unsafe register-layout indexing, new instruction semantics or guest-memory cache.

**Do not merge/promote this candidate:** the ordinary pairs retain RAM regressions and sub-1× motion/GPIO windows. The smaller cached-loop code does not establish faster execution. Median changes across the four pairs are motion -8.67% to 5.43%, RAM -49.69% to -41.85%, GPIO -14.15% to 2.54%. All-target ≥1× / CP13 remains open.

## Correctness and independent builds

[Native run 37144959430](https://github.com/CrispStrobe/labwired-core/actions/runs/37144959430) passes 12 focused event-enabled checks, 12 focused feature-off checks, 4,234 library tests (three existing ignored), and 16 GPIO integrations. Native production compilation is unchanged.

[Independent WASM build 37145743957](https://github.com/CrispStrobe/bw-board/actions/runs/37145743957) passes both builds, byte determinism and all 108 actual-WASM integrations, zero skips. The original same-PC guest fixture retains all seven budgets (1, 7, 8, 16, 31, 64, 257), identical image/PCs, five live RAM→MMIO→RAM phases, safe interval 1024, alignment/bounds checks and 1,572 guest loops. No reset or host register/memory mutation clears its decode cache. These prove semantic observations, not fast-path hit counts.

The separate fresh motion floor passes: **1.451189× median / 1.371520× minimum**. Its actual verdict is preserved; publication is skipped. This fresh value is not a paired speedup or all-target qualification.

## Ordinary paired measurements

Frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, original module/glue, default runtime flags: no sampling, census, forced tier or extra optimizer. Ten windows per engine/workload/pair; all **240 timing windows** are reparsed with cycle-indexed guest observations, hashes, minima and floor verdicts preserved. Different runner VMs do not establish Node-version causality or statistical significance.

| Runtime/order | Workload | Baseline median / min RTx | Candidate median / min RTx | Median change | Candidate floor |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.597763 / 0.578043 | 0.620069 / 0.614949 | 3.73% | FAIL |
| 20.20.2 ABBA | RAM | 2.863134 / 2.759921 | 1.577916 / 1.552030 | -44.89% | PASS |
| 20.20.2 ABBA | GPIO | 0.522350 / 0.510670 | 0.535627 / 0.513406 | 2.54% | FAIL |
| 20.20.2 BAAB | motion | 0.584428 / 0.569040 | 0.616174 / 0.588833 | 5.43% | FAIL |
| 20.20.2 BAAB | RAM | 2.813473 / 2.791264 | 1.592694 / 1.560264 | -43.39% | PASS |
| 20.20.2 BAAB | GPIO | 0.553619 / 0.548168 | 0.527016 / 0.497686 | -4.81% | FAIL |
| 22.23.3 ABBA | motion | 0.818360 / 0.777120 | 0.747410 / 0.730950 | -8.67% | FAIL |
| 22.23.3 ABBA | RAM | 2.854434 / 2.836280 | 1.659841 / 1.624496 | -41.85% | PASS |
| 22.23.3 ABBA | GPIO | 0.641007 / 0.615708 | 0.595828 / 0.581186 | -7.05% | FAIL |
| 22.23.3 BAAB | motion | 0.841006 / 0.828757 | 0.786943 / 0.777518 | -6.43% | FAIL |
| 22.23.3 BAAB | RAM | 3.372114 / 3.246804 | 1.696677 / 1.636390 | -49.69% | PASS |
| 22.23.3 BAAB | GPIO | 0.666291 / 0.657703 | 0.571993 / 0.557541 | -14.15% | FAIL |

Runs: [37146567431](https://github.com/CrispStrobe/bw-board/actions/runs/37146567431), [37146886697](https://github.com/CrispStrobe/bw-board/actions/runs/37146886697), [37147392946](https://github.com/CrispStrobe/bw-board/actions/runs/37147392946), [37147538203](https://github.com/CrispStrobe/bw-board/actions/runs/37147538203).

## Original compiled-code comparison

[Candidate inspection 37146586058](https://github.com/CrispStrobe/bw-board/actions/runs/37146586058) uses unchanged static inspector `ad05b8ec01309dba79e7cf9435c6b0b5424d50fc`, verifies original candidate module/glue hashes before disassembly, and executes no engine. Original selected bodies are preserved as bounded, hash-checked text chunks. The existing [production inspection archive](../2026-10-03-wasm-cpu-hotpath-inspection/README.md) supplies the independently bound baseline bodies.

Cached-run's 107 eighteen-target tables become zero; its non-whitespace WAT text decreases from 169,856 to 32,357 bytes, while static direct read/write helper calls change from 2/2 to 74/40. Batch text instead increases from 495,684 to 529,282 non-whitespace bytes, with read/write calls 395/256→541/334. These are static code-shape observations, **not binary/code-cache sizes, runtime call frequencies or proof of removable cost**. Eighteen targets alone do not identify every table as a register access. Complete paired timing, not text size, decides performance.

## Reproduction and next experiment

The [manifest](manifest.json) binds 154 original/losslessly wrapped files by length and SHA-256, including original source/native/build/integration/floor logs, all timing stdout/stderr and receipts, same-PC semantic proof, complete candidate selected code, exact source snapshots/contracts and controller/config sources. Wrapped files preserve original bytes, including carriage returns and trailing-newline differences. No engine binaries were downloaded or executed on the VPS.

Run `node --test test/wasm-register-helper-sharing-evidence.test.mjs` from the repository root: six portable checks reproduce the original source, all 240 windows and compiled comparison. Synthetic guards are not timing evidence. Do not restart completed controllers or duplicate measurements.

The next hypothesis should avoid forcing calls for every register access. A narrowly scoped, safe low-register accessor for validated Thumb operands could reduce generic dispatch while retaining inlining; it must preserve high/SP/PC/xPSR/default semantics, decline unsupported instructions, and pass the same exhaustive correctness, live-MMIO, debugger and paired gates. This is an untested proposal, not a claimed fix. Do not rely on Rust field adjacency or unsafe pointer indexing.

Production core, engine/app pins, seven physical capture results and acknowledgement expiry remain unchanged; hardware re-capture is still owed. Local resource guards remain in force; heavy builds/measurements ran on GitHub.
