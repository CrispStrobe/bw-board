# WASM discovery memo: 1,024 slots — unqualified, not promoted

Keep `30131a9068e7c4aff6540092bce0a019f3b5c021` on `perf/wasm-discovery-memo1024-20261004` **unmerged/unqualified**. It is a direct child of production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, not stacked on rejected register/inline/vtable variants. Increasing the bounded negative discovery memo from 64 to 1,024 entries **does not establish a general speedup**. Four ordinary pairs retain every one of their **240 original timing windows**: motion -4.76% to 1.19%, RAM -1.59% to -0.33%, GPIO -0.61% to 5.32%. RAM medians are lower in all four pairs. Motion/GPIO every-window ≥1× floors fail all four pairs; RAM passes all four. CP13 remains open.

## Hypothesis, source and memory tradeoff

The 64-slot table aliases halfword PCs 128 bytes apart. A larger table could reduce repeated structural block discovery if those aliases occur in hot code. **Hot miss frequency or thrashing was not measured**; source arithmetic alone does not establish that bottleneck. WASM now has 1,024 entries, native still 64. The cost is 960 additional inline tuples per Cortex-M instance in WASM; peak memory/allocation behavior was not measured. No new source-level allocation call was added.

Only the capacity declaration and its comment change production CPU source. The [contract](source-contract.json) and portable test reconstruct the entire original CPU file byte-for-byte after removing those two changes. Exact PC/generation keys, modulo-index formula, positive-cache precedence, every discovery/admission/invalidation/reset/snapshot body, live register-dependent RAM/MMIO failure rules, instruction execution, native policy and public/snapshot schemas remain unchanged. No mutable device-eligibility cache, unsafe field indexing or trait-layout change is introduced.

The added host regression checks the compiled primitive's exact-PC/generation alias replacement, unchanged architectural snapshots/access counts and capacity policy. Its 1,024-PC distribution check is **symbolic arithmetic**, not execution of the WASM primitive or a hit census. Original discovery/cache/reset/generation-wrap and cached-scalar/MMIO/observer regressions remain intact.

## Correctness and independent builds

[Native 37196887603](https://github.com/CrispStrobe/labwired-core/actions/runs/37196887603) passes 13 event-enabled focused checks, 13 feature-off checks, 4,235 library tests (three existing ignored) and 16 GPIO integrations. [Independent build 37197590435](https://github.com/CrispStrobe/bw-board/actions/runs/37197590435) passes both original builds, byte determinism and **108 actual-WASM integrations**, zero skips. Seven same-PC fixture budgets 1,7,8,16,31,64,257 retain identical image/PCs, five live RAM→MMIO→RAM phases, safe interval 1024, alignment/bounds checks and 1,572 guest loops. No reset or host register/memory mutation clears its decode cache; these are semantic proofs, not hit counts.

The separate fresh motion floor **fails** at 0.823477× median / 0.818431× minimum. Overall workflow failure is preserved; publication is skipped. This independent runner is not a paired speedup measurement, and correctness does not waive any performance gate.

## All ordinary paired outcomes

Frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, Node20.20.2/22.23.3, ABBA/BAAB, default flags and original built bytes with **identical original generated glue**. No profiler/census, forced tier, extra optimizer or binary rewrite. Every pair uses one runner and ten windows per engine/workload. Guest observations, loaded hashes, provenance, all gains/losses/minima and exact floors are retained. Different runner VMs and small median differences do not establish runtime-version causality or statistical significance.

| Runtime/order | Workload | Baseline median / min RTx | Candidate median / min RTx | Median change | Candidate floor |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.665673 / 0.648108 | 0.673623 / 0.665853 | 1.19% | FAIL |
| 20.20.2 ABBA | RAM | 3.082197 / 2.785740 | 3.033219 / 3.003415 | -1.59% | PASS |
| 20.20.2 ABBA | GPIO | 0.556691 / 0.547565 | 0.553296 / 0.548176 | -0.61% | FAIL |
| 20.20.2 BAAB | motion | 0.610550 / 0.596693 | 0.581458 / 0.538167 | -4.76% | FAIL |
| 20.20.2 BAAB | RAM | 2.855308 / 2.843553 | 2.845925 / 2.756889 | -0.33% | PASS |
| 20.20.2 BAAB | GPIO | 0.539724 / 0.516340 | 0.539132 / 0.521351 | -0.11% | FAIL |
| 22.23.3 ABBA | motion | 0.819232 / 0.802896 | 0.823679 / 0.745199 | 0.54% | FAIL |
| 22.23.3 ABBA | RAM | 2.866733 / 2.741731 | 2.851627 / 2.688522 | -0.53% | PASS |
| 22.23.3 ABBA | GPIO | 0.652497 / 0.625607 | 0.656491 / 0.627398 | 0.61% | FAIL |
| 22.23.3 BAAB | motion | 0.794338 / 0.771504 | 0.787683 / 0.777205 | -0.84% | FAIL |
| 22.23.3 BAAB | RAM | 2.870650 / 2.709685 | 2.847084 / 2.756777 | -0.82% | PASS |
| 22.23.3 BAAB | GPIO | 0.623712 / 0.611244 | 0.656881 / 0.625864 | 5.32% | FAIL |

Runs: [37198270826](https://github.com/CrispStrobe/bw-board/actions/runs/37198270826), [37198408547](https://github.com/CrispStrobe/bw-board/actions/runs/37198408547), [37198546868](https://github.com/CrispStrobe/bw-board/actions/runs/37198546868), [37198766229](https://github.com/CrispStrobe/bw-board/actions/runs/37198766229).

The GPIO gain in the last pair does not replace the two earlier GPIO losses, the mixed motion results, all four lower RAM medians or failed floors. Do not compare the separate fresh baseline and candidate runners as a speedup.

## Compiled roots and preserved local-check corrections

[Hosted capture 37198283731](https://github.com/CrispStrobe/bw-board/actions/runs/37198283731) uses unchanged inspector `ad05b8ec01309dba79e7cf9435c6b0b5424d50fc`, source-bound original module/glue hashes, 16MiB selected-body bound and 512KiB chunks. The [comparison](compiled-comparison.json) checks every original chunk's length/SHA-256 and reassembles both selected roots against the [production archive](../2026-10-03-wasm-cpu-hotpath-inspection/README.md).

Batch non-whitespace WAT text changes 495,684→496,404 bytes, cached-run 169,856→169,913. Branch-table histograms remain unchanged, including cached-run's 107 eighteen-target tables; generic read/write static occurrences remain batch 395/256 and cached-run 2/2. These are **text-shape observations, not binary/code-cache size, dynamic frequency or runtime cost**. The two selected roots are not the full transitive discovery implementation and do not establish its miss frequency.

Two independent local receipt helpers initially used stale/missing fast-root paths. Strict source equality rejected the old cached-frame source before any native-observation write; the comparison stopped with ENOENT before its result write. [Native correction](native-observer-path-correction.json) and [comparison correction](compiled-candidate/local-comparator-path-correction.json) preserve those failures and exact fixes. Corrected helpers validate original saved logs/chunks; **no native test, hosted inspection, benchmark or raw original receipt was rerun or altered**. Fast-root links resolve to CIFS, not duplicate datasets.

## Reproducible evidence and next step

The [manifest](manifest.json) binds 172 original/lossless members by bytes/SHA-256: source/tests/contracts, native results, both deterministic builds, all integrations/fresh-floor failure, all 240 paired windows/streams/configs, seven same-PC proofs, selected compiled code/comparison, controllers and correction records. Raw trailing whitespace, carriage returns and missing final newlines are preserved in reversible wrappers, never trimmed.

Run `node --test test/wasm-discovery-memo1024-evidence.test.mjs` for six portable checks reproducing source/native invariants, corpus/config hashes, original build/floor verdicts, all paired outcomes, seven semantic proofs and compiled roots. Original large evidence and archive staging live on `/mnt/storage` CIFS; fast Git working data on `/mnt/volume1`; legacy `/tmp` is only a symlink. All engine builds/execution/benchmarks were hosted; local analysis is bounded/low-priority and resource-checked.

Do not blindly test another memo size or repeat the already-rejected interpreter outlining/register variants. A targeted, separate discovery-hit census would be needed before claiming this is a worthwhile capacity bottleneck; it must not alter the frozen ordinary harness or become timing qualification. No further engine change or speedup is promised here.

Production, engine/app pins, native dispatch, seven physical captures/acknowledgements and expiry remain unchanged. Hardware recapture remains owed; all-target ≥1× / CP13 is open.
