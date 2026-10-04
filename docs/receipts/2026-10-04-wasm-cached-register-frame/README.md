# WASM cached low-register frame — unqualified, not promoted

Keep candidate `098c99cf6b6a176a44c83b37ce77a1881909c767` on `perf/wasm-cached-register-frame-20261004` **unmerged/unqualified**. It is a direct child of production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, not stacked on rejected experiments. Four ordinary paired runs retain all **240 original windows**: motion changes -6.25% to 1.33%, RAM -1.23% to 0.47%, GPIO -5.14% to 1.61%. This is not a dependable general improvement and does not meet all-target ≥1×. CP13 remains open.

## Source and correctness

The existing checked cached run captures r0–r7 in a private eight-element array for at most 16 instructions. A cloned scalar executor changes only register accesses. Every normal/partial run exit commits low registers before returning to the caller. High registers, SP, PC, flags and xPSR remain live through original accessors. Original admission, budget, PC/tag/width, RAM/MMIO and debugger/IRQ/scheduler/observer boundaries are retained. There is no persistent register mirror, unsafe indexing or Rust-layout assumption. **Fatal panic/trap rollback is not established** by the normal-exit guard.

[Native run 37182764493](https://github.com/CrispStrobe/labwired-core/actions/runs/37182764493) passes 13 event-enabled focused checks, 13 feature-off checks, 4,235 library tests (three existing ignored) and 16 GPIO integrations. The added regression covers all 256 indices × five seeds × five written values, ordinary and PC+4 reads, high/special/default behavior and complete post-commit snapshots. Existing exhaustive cached-scalar and live RAM/MMIO regressions are unchanged.

[Independent WASM build 37183167316](https://github.com/CrispStrobe/bw-board/actions/runs/37183167316) passes both original builds, byte determinism and all 108 actual-WASM integrations, zero skips. All seven same-PC fixture budgets (1,7,8,16,31,64,257) retain exact image/PCs, five live RAM→MMIO→RAM phases, safe interval 1024, alignment/bounds checks and 1,572 guest loops. No reset or host register/memory mutation clears its decode cache. These are semantic proofs, not hit counts or performance measurements.

The separate fresh motion floor **fails**: 0.792109× median / 0.787231× minimum. Overall build workflow failure and skipped publication are preserved. A correctness pass never waives this floor.

## Ordinary paired measurements

Frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, Node20.20.2/22.23.3, ABBA/BAAB, default flags, original built modules. No profiler/census, forced tier or extra optimizer. Ten windows per engine/workload/pair retain exact cycle-indexed guest observations, hashes, minima and verdicts. **Original generated glue differs** between engines; explicit paired-glue receipts bind both hashes. Measurements compare complete built artifact pairs, not an isolated WASM-only causal effect. Different runner VMs also do not establish Node-version causality or statistical significance.

| Runtime/order | Workload | Baseline median / min RTx | Candidate median / min RTx | Median change | Candidate floor |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.557380 / 0.517254 | 0.564802 / 0.544029 | 1.33% | FAIL |
| 20.20.2 ABBA | RAM | 2.808807 / 2.740918 | 2.821923 / 2.803820 | 0.47% | PASS |
| 20.20.2 ABBA | GPIO | 0.539888 / 0.530372 | 0.548556 / 0.538409 | 1.61% | FAIL |
| 20.20.2 BAAB | motion | 0.610228 / 0.581451 | 0.598604 / 0.586327 | -1.90% | FAIL |
| 20.20.2 BAAB | RAM | 2.826500 / 2.794278 | 2.835864 / 2.809895 | 0.33% | PASS |
| 20.20.2 BAAB | GPIO | 0.539274 / 0.512221 | 0.545768 / 0.544120 | 1.20% | FAIL |
| 22.23.3 ABBA | motion | 1.464630 / 1.429595 | 1.373156 / 1.312992 | -6.25% | PASS |
| 22.23.3 ABBA | RAM | 6.868925 / 5.587289 | 6.825981 / 6.571861 | -0.63% | PASS |
| 22.23.3 ABBA | GPIO | 1.290173 / 1.207350 | 1.223808 / 1.066823 | -5.14% | PASS |
| 22.23.3 BAAB | motion | 0.983398 / 0.942683 | 0.954772 / 0.937528 | -2.91% | FAIL |
| 22.23.3 BAAB | RAM | 3.939819 / 3.821068 | 3.891225 / 3.758934 | -1.23% | PASS |
| 22.23.3 BAAB | GPIO | 0.779623 / 0.768794 | 0.763814 / 0.758406 | -2.03% | FAIL |

Runs: [37183516765](https://github.com/CrispStrobe/bw-board/actions/runs/37183516765), [37183630522](https://github.com/CrispStrobe/bw-board/actions/runs/37183630522), [37183750591](https://github.com/CrispStrobe/bw-board/actions/runs/37183750591), [37183829404](https://github.com/CrispStrobe/bw-board/actions/runs/37183829404).

RAM floors pass all four pairs. Motion/GPIO floors pass only Node22 ABBA, failing the other three; the passing pair still regresses against its own baseline. No favorable subset replaces the complete result.

## Compiled-code check, not a speed claim

[Hosted candidate inspection 37183521683](https://github.com/CrispStrobe/bw-board/actions/runs/37183521683) uses unchanged inspector `ad05b8ec01309dba79e7cf9435c6b0b5424d50fc`. The [comparison](compiled-comparison.json) reassembles and checks lengths/SHA-256 of every original chunk and both selected roots, using the [production archive](../2026-10-03-wasm-cpu-hotpath-inspection/README.md) for the baseline. No engine executes during inspection.

Cached-run changes from 107 eighteen-target tables to 97 ten-target tables. Non-whitespace WAT text changes 169,856→120,130 bytes; generic read/write static occurrences change 2/2→3/9. Frame helpers are inlined without direct-call labels, not absent work. Batch text changes 495,684→495,682 bytes, with unchanged table histogram and generic read/write counts 395/256.

These counts are static text shape, **not binary/code-cache size, dynamic frequency or runtime cost**. Table width alone does not identify every table as register dispatch. Smaller dispatch did not produce a dependable measured improvement.

## Preserved evidence and verification

The [manifest](manifest.json) binds 158 original/losslessly wrapped members by bytes and SHA-256: source/tests/contracts, native results, both independent builds, 108 integrations, fresh floor failure, every paired stream/receipt/config, seven same-PC proofs, full selected candidate code, comparison and controllers. Trailing whitespace, carriage returns and missing final newlines are preserved, never trimmed.

Run `node --test test/wasm-cached-register-frame-evidence.test.mjs` for six portable checks: original source reconstruction/executor substitution tokens/native counts, complete corpus/config hashes, original deterministic builds/fresh floor, all 240 timing windows, seven same-PC proofs, and reassembled compiled roots. Hosted CI verifies these before documentation landing. Do not rerun completed measurements.

Large original evidence and archive staging live on `/mnt/storage` CIFS; the fast Git working tree lives on `/mnt/volume1`. `/tmp` has only a compatibility symlink. All engine builds/execution/measurements remain hosted. Production, engine/app pins, seven physical captures and acknowledgements/expiry remain unchanged. Hardware recapture is still owed.

Next investigate a separate, profile-supported peripheral-service/admission hypothesis from the unchanged production base rather than stacking or retesting these rejected register variants. Any proposal still needs exact semantics, full same-host paired results and every-window floors before promotion; no speedup is promised.
