# WASM short cached-budget experiment — not qualified

Baseline core: `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`. Candidate: `565dce2b35c67c4661055443ce9bb5d47039249e`, direct baseline child on `perf/wasm-short-cached-budget-20261003`. No earlier rejected experiment is stacked.

WASM previously excluded every fast executor below eight remaining instructions. This experiment admits the existing checked cached-run executor for budgets 1–7 while bypassing loop discovery there. The 16-instruction cap and live tag/width/RAM checks are unchanged. MMIO, unsupported and unmapped operations decline before retirement. Original observer, IRQ, debugger, IT, trace, tap, decode and scheduler guards remain. Native production dispatch is unchanged; the original CPU is reconstructed byte-exact by reversing just the two edits. No inventory cache, trait-layout change, new instruction semantics, engine pin or physical acknowledgement change.

This is a tested hypothesis, not evidence that short budgets were the dominant hotspot. **Do not merge/promote it:** RAM medians and minima regress in all four comparisons; motion and GPIO gains are mixed. Motion/GPIO fail every-window ≥1× in all four pairs; RAM passes all four. All-target ≥1× / CP13 remains open.

## Correctness and independent builds

[Native run 37136338904](https://github.com/CrispStrobe/labwired-core/actions/runs/37136338904) passed 13 event-enabled focused checks, 13 feature-off checks, 4,235 library tests (three existing ignored), and 16 GPIO integrations. The new regression compares budgets 0–7 against the interpreter, including live RAM, cold/collided/wide cache entries, MMIO/unmapped addresses, and sleep/event barriers.

[Independent WASM build 37136931155](https://github.com/CrispStrobe/bw-board/actions/runs/37136931155) passed both builds, byte determinism and all 108 actual-WASM integrations, zero skips. The real same-PC word fixture retains seven budget cases (1, 7, 8, 16, 31, 64, 257), identical image/PCs, five live RAM→MMIO→RAM phases, safe interval 1024, alignment/bounds checks and 1,572 guest loops. No reset or host register/memory mutation clears its decode cache. These are semantic observations, not fast-path hit counts.

The unchanged separate fresh motion floor **fails**: 0.995947× median / 0.911775× minimum. Overall build-workflow failure is retained; publication was skipped. This fresh value is not a paired speedup.

## Ordinary paired measurements

Frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`; original module and glue, default runtime flags, no sampling, census, forced tier or extra optimizer. Each pair uses one runner, ten windows per engine/workload. Across four pairs, all **240 windows** are independently reparsed with cycle-indexed guest observations, hashes, minima and floor verdicts preserved. Different runner VMs do not establish Node-version causality or statistical significance.

| Runtime/order | Workload | Baseline median / min RTx | Candidate median / min RTx | Median change | Candidate floor |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.578383 / 0.522789 | 0.576022 / 0.554284 | -0.41% | FAIL |
| 20.20.2 ABBA | RAM | 2.842249 / 2.810414 | 2.806091 / 2.780147 | -1.27% | PASS |
| 20.20.2 ABBA | GPIO | 0.555122 / 0.521885 | 0.534285 / 0.522912 | -3.75% | FAIL |
| 20.20.2 BAAB | motion | 0.634083 / 0.618462 | 0.590329 / 0.584039 | -6.90% | FAIL |
| 20.20.2 BAAB | RAM | 2.855941 / 2.836167 | 2.838921 / 2.601045 | -0.60% | PASS |
| 20.20.2 BAAB | GPIO | 0.552419 / 0.524574 | 0.555071 / 0.540627 | 0.48% | FAIL |
| 22.23.3 ABBA | motion | 0.810672 / 0.767378 | 0.812146 / 0.790452 | 0.18% | FAIL |
| 22.23.3 ABBA | RAM | 2.866760 / 2.713050 | 2.841351 / 2.592838 | -0.89% | PASS |
| 22.23.3 ABBA | GPIO | 0.646338 / 0.639872 | 0.602782 / 0.576098 | -6.74% | FAIL |
| 22.23.3 BAAB | motion | 0.806796 / 0.779043 | 0.818331 / 0.793080 | 1.43% | FAIL |
| 22.23.3 BAAB | RAM | 2.859642 / 2.801137 | 2.825533 / 2.749546 | -1.19% | PASS |
| 22.23.3 BAAB | GPIO | 0.608928 / 0.581916 | 0.620955 / 0.600876 | 1.98% | FAIL |

Runs: [37138305268](https://github.com/CrispStrobe/bw-board/actions/runs/37138305268), [37138500572](https://github.com/CrispStrobe/bw-board/actions/runs/37138500572), [37138907128](https://github.com/CrispStrobe/bw-board/actions/runs/37138907128), [37139101890](https://github.com/CrispStrobe/bw-board/actions/runs/37139101890).

## Retained evidence and reproduction

The [manifest](manifest.json) binds 127 original/losslessly wrapped files by size and SHA-256. It includes native/build/integration/floor logs, all paired stdout/stderr and receipts, source snapshots/contracts, controller/config sources, and the independent short-budget guest proof. Wrapped files preserve original bytes rather than normalizing carriage returns or trailing newlines. No engine binaries were downloaded or executed on the VPS.

From the repository root, run `node --test test/wasm-short-cached-budget-evidence.test.mjs`: five portable checks reparse all windows and preserve regressions/failures. Synthetic parser guard fixtures are not timing evidence. Do not restart completed controllers or dispatch duplicate measurements. Production engine, app pins, seven physical capture results and acknowledgement expiry remain unchanged; hardware re-capture is still owed.
