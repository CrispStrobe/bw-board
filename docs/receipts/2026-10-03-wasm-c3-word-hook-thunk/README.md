# Outlined C3 word-write admission: complete results, not promoted

Candidate `a40c1dfccddc77ff6e8adf04930176997e04040e` starts directly from production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`; no rejected variants are stacked. Only the successful nonplain 32-bit peripheral-store C3 call gets a WASM/test-only outlined admission thunk. The thunk is marked `inline(never)`; its live predicate is inlined into that small thunk, not the word accessor. The original C3 hook still runs whenever its INTC cache exists, including routing-disabled cache updates. With the event scheduler, it also runs whenever the legacy walk is deleted and C3 routing is active, even without an INTC cache, to preserve scheduler-source refresh. Its state is queried at each successful store, not memoized chip/device eligibility. Native production retains the original unconditional call. CPU, original hook body, cycle/reset/IRQ/scheduler logic, reads and byte/halfword accessors are byte-identical to production.

This follows the [caller-inlined gate experiment](../2026-10-03-wasm-c3-word-hook-gate/README.md), which had four positive GPIO medians but mixed motion/RAM results. Keeping the new conditional branch out of `write_u32` is a compiler/layout hypothesis, not an established explanation for that earlier tradeoff. The separate prior candidate is not stacked into this source; correctness tests are reused and strengthened with direct inactive-thunk execution, including invalid indexes. Prior whole-process `write_u32` samples (7.21–7.76%) do not measure this individual hook or predict removable cost.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37108051017) passes four focused cases with the event scheduler, three without it, **4,238 library tests** (three existing ignored), and **16 GPIO integrations**. Cases cover live cache/routing/walk-state transitions; inactive thunk and original-hook state equivalence; actual stores asserting/deasserting uncached scheduler sources; and actual C3/C6 doorbell stores with immediate cache/IRQ updates, including routing-disabled cache updates. No ratchet or allowlist was weakened. Native test execution is not actual-WASM performance or full C3/C6 firmware qualification.

[Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37108738331) passes byte determinism and **108 actual integrations**, including seven same-PC RAM/MMIO guests. These establish their guest semantics, not gate hit counts or every C3/C6 firmware's behavior. Fresh motion median/minimum is **0.825183× / 0.821529×**; the unchanged all-window ≥1× floor **FAILS**. The actual workflow verdict and skipped publication are retained. A separate fresh capture is not a paired speedup.

## Every ordinary paired result

Ten windows per artifact/row run on the same hosted CPU. Original module/glue hashes are verified before timing. Frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, Node 20.20.2/22.23.3, ABBA/BAAB: no forced tiers, profiling, census or extra optimizer. Different rows use different hosted CPUs; neither Node-version causality nor statistical significance follows from those separate hosts.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.860179 / 0.854379 | 0.860334 / 0.847078 | 0.02% | FAIL / FAIL |
| 20.20.2 ABBA | RAM | 3.782493 / 3.449825 | 3.775533 / 3.362086 | -0.18% | pass / pass |
| 20.20.2 ABBA | GPIO | 0.725300 / 0.703058 | 0.718799 / 0.709472 | -0.90% | FAIL / FAIL |
| 20.20.2 BAAB | motion | 0.615588 / 0.601694 | 0.565166 / 0.522977 | -8.19% | FAIL / FAIL |
| 20.20.2 BAAB | RAM | 2.840809 / 2.784876 | 2.843840 / 2.785132 | 0.11% | pass / pass |
| 20.20.2 BAAB | GPIO | 0.550510 / 0.506388 | 0.540591 / 0.525745 | -1.80% | FAIL / FAIL |
| 22.23.3 ABBA | motion | 0.817450 / 0.713882 | 0.792259 / 0.766731 | -3.08% | FAIL / FAIL |
| 22.23.3 ABBA | RAM | 2.841850 / 2.806958 | 2.885165 / 2.696849 | 1.52% | pass / pass |
| 22.23.3 ABBA | GPIO | 0.632756 / 0.595759 | 0.671781 / 0.629190 | 6.17% | FAIL / FAIL |
| 22.23.3 BAAB | motion | 0.998011 / 0.983912 | 0.982910 / 0.914549 | -1.51% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 3.827769 / 3.743036 | 3.961701 / 3.813256 | 3.50% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.791700 / 0.770636 | 0.786676 / 0.771268 | -0.63% | FAIL / FAIL |

- [Original run 37109178803](https://github.com/CrispStrobe/bw-board/actions/runs/37109178803): Node 20.20.2, ABBA.
- [Original run 37109308273](https://github.com/CrispStrobe/bw-board/actions/runs/37109308273): Node 20.20.2, BAAB.
- [Original run 37109440138](https://github.com/CrispStrobe/bw-board/actions/runs/37109440138): Node 22.23.3, ABBA.
- [Original run 37109573063](https://github.com/CrispStrobe/bw-board/actions/runs/37109573063): Node 22.23.3, BAAB.

All gains, losses, minima and floor verdicts remain retained. Selected F0 RAM/GPIO and micro:bit motion use nominal 48/64 MHz engine cycles, not silicon CPI, all supported targets, browser/UI/debugger throughput or physical qualification. Source remains **unmerged and not promoted**; production/app pins and all seven physical drift acknowledgements/captures/expiry are unchanged. Hardware re-capture remains owed; CP13/all-target ≥1× remains open.

## Evidence and resource constraints

The [initial native run](https://github.com/CrispStrobe/labwired-core/actions/runs/37107852690), at `3b959f5193a2773648fe9c12f0e36042a71a7df0`, failed during compilation: the new sibling-module test could not call the private thunk (E0624). No tests, real integrations, WASM builds or timings ran from that failed head. The correction changes only that WASM/test-only method's visibility to `pub(super)`, within the bus module. Its body, test assertions, native production and ratchets are unchanged. Both the full failed log and the exact one-line correction remain retained; the timed source is corrected a40c, not failed 3b.

`manifest.json` binds original/reversibly wrapped source/build/integration/floor logs, both native feature configurations, initial failure/correction proof, exact source contracts, immutable controller/configuration, all four paired receipts and all **240 timing windows**. Six portable evidence tests reparse hashes, guest observations, versions/orders, exits, medians/minima/floors, the isolated source diff, and the failed/corrected-source distinction. No direction of performance is selected as an assertion for promotion.

At 07:51 UTC the VPS had load 2.18/2.67/3.45 on four CPUs, 4,148 MiB available memory, but only approximately 1.5 GiB workspace free, below the 4 GiB benchmark and 20 GiB build reserves. No local engine builds, downloads, execution, benchmarks, profiling, new agents or cleanup ran. Only small source edits, cached rustfmt, metadata/receipt orchestration and portable evidence checks were local. All heavy work used hosted runners.
