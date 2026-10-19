# WASM low/high register split — unqualified, not promoted

Baseline core: `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`. Candidate: `5fed1f735dd48c899395a74f0565451c38a03716`, direct baseline child on `perf/wasm-register-low-high-split-20261004`. No rejected source experiment is stacked. WASM keeps low registers 0–7 inline and shares only the high/special-register 8–16/default fallback. Native methods retain their original bodies and compilation policy. Original read/write arms, invalid-index semantics, SP/PC/xPSR behavior and existing regressions are unchanged. No unsafe field indexing, Rust-layout assumption, trait-layout change or guest-memory cache.

**Keep this candidate unmerged/unqualified.** It avoids the earlier shared-helper RAM collapse, but does not produce a general improvement or the requested all-target ≥1×. Motion changes -5.70% to 16.38%, RAM -1.20% to 4.54%, GPIO -3.74% to 10.66%. Both Node20 orders improve motion/GPIO with small RAM losses; both Node22 orders regress motion and one regresses GPIO. These runtime-group patterns across distinct runner VMs do not establish Node-version causality or statistical significance. Motion/GPIO fail the unchanged every-window 1× floor in all four pairs; RAM passes all four. CP13 remains open.

## Correctness and original builds

[Native run 37176557440](https://github.com/CrispStrobe/labwired-core/actions/runs/37176557440) passes 13 focused event-enabled checks, 13 feature-off checks, 4,235 library tests (three existing ignored) and 16 GPIO integrations. The added regression compares the exact WASM partitioned primitive against original native access for all 256 register indices, five initial seeds and five written values, including invalid indices, special registers, PC+4 and full snapshots. Existing exhaustive cached-scalar, live RAM/MMIO and observation regressions remain intact.

[Independent WASM build 37177028224](https://github.com/CrispStrobe/bw-board/actions/runs/37177028224) passes both builds, original byte determinism and all 108 actual-WASM integrations, zero skips. The original same-PC fixture retains seven budgets (1,7,8,16,31,64,257), identical image/PCs, five live RAM→MMIO→RAM phases, safe interval 1024, alignment/bounds checks and 1,572 guest loops. No reset or host register/memory mutation clears its decode cache. These are semantic observations, not fast-path hit counts.

The separate fresh motion floor **fails**: 0.779280× median / 0.741677× minimum. Overall workflow failure is retained; publication is skipped. This fresh value is not a paired speedup, and correctness passes do not waive performance gates.

## Ordinary paired measurements

Frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, original modules and identical original glue, default runtime flags. No sampling, census, forced tier or extra optimizer. Each pair uses one runner and ten windows per engine/workload. All **240 original timing windows** are reparsed with cycle-indexed guest observations, provenance, hashes, minima and floor verdicts retained.

| Runtime/order | Workload | Baseline median / min RTx | Candidate median / min RTx | Median change | Candidate floor |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.564945 / 0.513973 | 0.657489 / 0.618053 | 16.38% | FAIL |
| 20.20.2 ABBA | RAM | 2.850378 / 2.835897 | 2.844354 / 2.789947 | -0.21% | PASS |
| 20.20.2 ABBA | GPIO | 0.567322 / 0.539491 | 0.592321 / 0.585548 | 4.41% | FAIL |
| 20.20.2 BAAB | motion | 0.614228 / 0.609086 | 0.674343 / 0.641954 | 9.79% | FAIL |
| 20.20.2 BAAB | RAM | 2.898505 / 2.824163 | 2.863746 / 2.818060 | -1.20% | PASS |
| 20.20.2 BAAB | GPIO | 0.549151 / 0.544308 | 0.607699 / 0.587460 | 10.66% | FAIL |
| 22.23.3 ABBA | motion | 0.829720 / 0.807791 | 0.784679 / 0.768322 | -5.43% | FAIL |
| 22.23.3 ABBA | RAM | 2.847748 / 2.622324 | 2.976913 / 2.825203 | 4.54% | PASS |
| 22.23.3 ABBA | GPIO | 0.627717 / 0.617998 | 0.630842 / 0.605435 | 0.50% | FAIL |
| 22.23.3 BAAB | motion | 0.987458 / 0.949388 | 0.931137 / 0.870281 | -5.70% | FAIL |
| 22.23.3 BAAB | RAM | 3.927827 / 3.755434 | 4.016506 / 3.834653 | 2.26% | PASS |
| 22.23.3 BAAB | GPIO | 0.793731 / 0.771860 | 0.764070 / 0.754455 | -3.74% | FAIL |

Runs: [37177705131](https://github.com/CrispStrobe/bw-board/actions/runs/37177705131), [37177815725](https://github.com/CrispStrobe/bw-board/actions/runs/37177815725), [37177927874](https://github.com/CrispStrobe/bw-board/actions/runs/37177927874), [37178467302](https://github.com/CrispStrobe/bw-board/actions/runs/37178467302).

## Compiled-code check, not a runtime-cost claim

[Candidate capture 37177724078](https://github.com/CrispStrobe/bw-board/actions/runs/37177724078) uses unchanged static inspector `ad05b8ec01309dba79e7cf9435c6b0b5424d50fc`. Original module/glue hashes are verified before hosted disassembly. Complete selected bodies are retained as bounded, hash-checked text chunks. The existing [production archive](../2026-10-03-wasm-cpu-hotpath-inspection/README.md) binds the baseline; the new [comparison](compiled-comparison.json) independently reassembles both originals.

Cached-run contains 106 nine-target tables instead of 107 eighteen-target tables; its non-whitespace WAT text decreases from 169,856 to 106,131 bytes. Generic read/write calls remain 2/2 and high-register calls are 72/37 static occurrences. Batch non-whitespace text changes 495,684→495,041 bytes; generic calls remain 395/256 with 14/11 high-register calls. Generic, partitioned and high-register names are counted separately, not mistaken for eliminated calls.

These are static code-shape observations, **not binary/code-cache sizes, dynamic call frequencies or proof of removable cost**. A table's target count alone does not identify every table as register dispatch. Inlined helper labels may be absent without the work being absent. Actual ordinary paired timings decide performance; smaller code does not justify promotion.

## Evidence and safe next step

The [manifest](manifest.json) binds 160 original/losslessly wrapped members by length and SHA-256. It includes all source/native/build/integration/floor logs, all paired stdout/stderr and receipts, source and test snapshots/contracts, same-PC proof, complete candidate selected code, compiled comparison and exact controller/config sources. Raw trailing whitespace, carriage returns and missing final newlines are preserved in wrappers, never trimmed.

Run `node --test test/wasm-register-low-high-split-evidence.test.mjs`: six portable checks reproduce exact native source/arms/existing tests, complete hashes and config, independent builds/fresh floor, all 240 timing windows, seven same-PC proofs and complete compiled roots. Synthetic identity checks are not timing evidence. Do not duplicate completed measurements or restart completed controllers.

A further hypothesis is bounded cached-run local low-register storage with coherent writeback, to amortize per-operand dispatch without unsafe layout indexing. This is **unimplemented and unverified**. It must preserve exact partial retirement and decline semantics, special registers/flags, debugger/IRQ/scheduler/observer boundaries and live RAM/MMIO behavior before any performance claim. Do not introduce a stale architectural-state mirror. This experiment's mixed outcome does not prove that proposal will help.

All engine execution/builds/measurements were hosted on GitHub; no engine binary was downloaded or executed on the VPS. Local static checks were deferred during extreme load, then run bounded/low-priority after capacity recovered. Production core, engine/app pins, seven physical captures and acknowledgement expiry remain unchanged. Hardware re-capture is still owed; all-target ≥1× / CP13 is open.
