# Cached run64: complete results, not qualified

Candidate core `f16a4f3da13a6267a0618824a0c172bd643b3081` starts directly from production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`; no earlier GPIO/word/literal/optimizer variants are stacked. The WASM-only bounded cached executor cap changes from 16 to 64 instructions. Each iteration still validates the live PC/tag/width/address; the scheduler budget remains an upper bound and MMIO/unsupported instructions stop before retirement. Native production does not call this path. Expanded host differential tests compile the same primitive, including long RAM/branch sequences and late barriers at offsets 17/31/63/64/65.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37095691659) passed 4,235 library tests (three pre-existing ignored), the exhaustive scalar test, expanded cached-run comparisons, new late-barrier invariants and 16 real GPIO integrations. [Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37096084052) passes byte determinism and exactly 108 actual integrations, including seven same-PC word cases. Those actual-WASM tests prove deployed semantics, not cap saturation or fast-path hit counts. Fresh motion median/minimum is **0.809596× / 0.783265×**; the unchanged all-window floor FAILS. The overall workflow failure and skipped publication are retained.

## Every ordinary paired result

Each row contains ten windows per artifact on the same runner, with original WASM/glue hashes checked before execution, frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, pinned Node versions and no profiling, forced tiers, census or extra optimizer. Different rows use different hosted CPUs; do not infer Node-version causality, significance or speedup from separate fresh runs.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.655968 / 0.649005 | 0.666328 / 0.659541 | 1.58% | FAIL / FAIL |
| 20.20.2 ABBA | RAM | 2.932502 / 2.849407 | 3.003567 / 2.977291 | 2.42% | pass / pass |
| 20.20.2 ABBA | GPIO | 0.557102 / 0.552521 | 0.555903 / 0.551515 | -0.22% | FAIL / FAIL |
| 20.20.2 BAAB | motion | 1.316105 / 1.252052 | 1.322999 / 1.085393 | 0.52% | pass / pass |
| 20.20.2 BAAB | RAM | 6.910772 / 6.632301 | 6.909329 / 6.527839 | -0.02% | pass / pass |
| 20.20.2 BAAB | GPIO | 1.176656 / 1.152571 | 1.190709 / 1.100924 | 1.19% | pass / pass |
| 22.23.3 ABBA | motion | 1.467157 / 1.392729 | 1.481725 / 1.433612 | 0.99% | pass / pass |
| 22.23.3 ABBA | RAM | 6.853956 / 6.524914 | 6.830332 / 6.637577 | -0.34% | pass / pass |
| 22.23.3 ABBA | GPIO | 1.287095 / 1.228561 | 1.287884 / 1.255618 | 0.06% | pass / pass |
| 22.23.3 BAAB | motion | 0.818453 / 0.803479 | 0.808702 / 0.780407 | -1.19% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 2.829792 / 2.748029 | 2.846638 / 2.794327 | 0.60% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.634755 / 0.615019 | 0.655065 / 0.625929 | 3.20% | FAIL / FAIL |

- [Original run 37096516516](https://github.com/CrispStrobe/bw-board/actions/runs/37096516516): Node 20.20.2, ABBA.
- [Original run 37096648041](https://github.com/CrispStrobe/bw-board/actions/runs/37096648041): Node 20.20.2, BAAB.
- [Original run 37096734503](https://github.com/CrispStrobe/bw-board/actions/runs/37096734503): Node 22.23.3, ABBA.
- [Original run 37096831288](https://github.com/CrispStrobe/bw-board/actions/runs/37096831288): Node 22.23.3, BAAB.

These selected active F0 RAM/GPIO and micro:bit motion guests are scaled by nominal 48/64 MHz engine cycles, not all targets, silicon CPI calibration, browser/UI/debugger throughput or hardware qualification. Every measured loss and minimum is retained. The source remains **unmerged and unqualified**; production/app pins and seven physical drift acknowledgements are unchanged. Hardware re-capture remains owed; CP13/all-target ≥1× is open.

## Interpretation and evidence

The prior instrumented GPIO census shows almost every cached call stops at an instruction/address barrier (552,867/553,084; 419,371/419,686; 552,665/553,113), not its cap. It has no cap-saturation histogram. Raising the cap does not eliminate those barriers; the prior ~20% whole-process profile attribution is not a removable-cost or speedup prediction. RAM already uses a positive general block cache. Any throughput changes here must be read as measured outcomes, not assumed amortization or evidence of greater cap use.

`manifest.json` binds original/reversibly wrapped native/build/integration/floor logs, exact source/config/controller, four paired receipts and all 240 ordinary timing windows. Portable tests independently reparse measurements, hashes, guest observations, runtime/order, signals/exits, minima and floor verdicts. No engine was downloaded or executed on the VPS. At 04:25 UTC, load 5.83/9.76/7.75 on four CPUs failed headroom despite 5,149 MiB available memory and 4.2/5.0 GB disk free. Only small receipts, metadata and portable evidence checks were allowed; no extra agents, local builds, profiles or benchmarks.

Further experiments need a separate profile-backed hypothesis and their own repeated acceptance. Do not stack mixed variants, bypass live admission/IRQ/debug/scheduler guards, restamp physical acknowledgements, or relax floors to promote this candidate.
