# Live GPIO edge gate: complete mixed results, not qualified

Candidate core `ccd283065d29e7ecca5a9a00a75f16005a746d63` starts directly from production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`; no earlier word/literal/optimizer variants are stacked. It moves the identical LIVE edge-address inventory query into the already-inline WASM caller, after analog-mux and timer-edge delivery, to avoid an outlined call for no-edge devices. Native production keeps its original gate. No device/address cache is introduced; registration, mutation, routing, service order and cold body remain live.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37092970610) passed all four new gate cases, 4,238 library tests (three pre-existing ignored) and 16 real GPIO integration tests. The initial shallow-checkout CI failed merge-base ratchets; the replacement fixes full-history checkout without weakening tests. [Replacement WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37093327002) passes two independent builds, byte determinism and exactly 108 actual integrations, including seven same-PC word cases. Its fresh motion median/minimum is **1.004303× / 0.987461×**, so the unchanged all-window floor FAILS. Overall workflow failure and skipped publication are retained.

## All ordinary paired results

Each row contains ten windows per artifact on the same runner, with original WASM/glue hashes checked before execution, frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, pinned Node versions and no profiling, forced tiers, census or extra optimizer. Different rows use different hosted CPUs: do not infer Node-version causality, significance, or speedup from separate fresh runs.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.605659 / 0.590141 | 0.613908 / 0.584285 | 1.36% | FAIL / FAIL |
| 20.20.2 ABBA | RAM | 2.831075 / 2.804570 | 2.827147 / 2.788965 | -0.14% | pass / pass |
| 20.20.2 ABBA | GPIO | 0.544850 / 0.527480 | 0.569443 / 0.526334 | 4.51% | FAIL / FAIL |
| 20.20.2 BAAB | motion | 1.371169 / 1.282464 | 1.390237 / 1.303456 | 1.39% | pass / pass |
| 20.20.2 BAAB | RAM | 7.166685 / 5.544441 | 5.191134 / 3.225497 | -27.57% | pass / pass |
| 20.20.2 BAAB | GPIO | 1.221944 / 1.114312 | 1.274447 / 1.240632 | 4.30% | pass / pass |
| 22.23.3 ABBA | motion | 0.789402 / 0.779141 | 0.819449 / 0.808658 | 3.81% | FAIL / FAIL |
| 22.23.3 ABBA | RAM | 2.830525 / 2.780769 | 2.881414 / 2.808105 | 1.80% | pass / pass |
| 22.23.3 ABBA | GPIO | 0.635446 / 0.625832 | 0.601018 / 0.586669 | -5.42% | FAIL / FAIL |
| 22.23.3 BAAB | motion | 0.825412 / 0.805530 | 0.795104 / 0.786406 | -3.67% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 2.893049 / 2.841886 | 2.847720 / 2.640847 | -1.57% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.635819 / 0.585149 | 0.588187 / 0.571977 | -7.49% | FAIL / FAIL |

- [Original run 37093765526](https://github.com/CrispStrobe/bw-board/actions/runs/37093765526): Node 20.20.2, ABBA.
- [Original run 37093896970](https://github.com/CrispStrobe/bw-board/actions/runs/37093896970): Node 20.20.2, BAAB.
- [Original run 37093988565](https://github.com/CrispStrobe/bw-board/actions/runs/37093988565): Node 22.23.3, ABBA.
- [Original run 37094122130](https://github.com/CrispStrobe/bw-board/actions/runs/37094122130): Node 22.23.3, BAAB.

These are selected active F0 RAM/GPIO and micro:bit motion guests scaled by nominal 48/64 MHz engine cycles, not all targets, silicon CPI calibration, browser/UI/debugger throughput or hardware qualification. Every loss and minimum is retained. Conflicting GPIO direction and the RAM regression mean this source stays **unmerged and unqualified**; production/app pins and seven physical drift acknowledgements are unchanged. Hardware re-capture remains owed; CP13/all-target ≥1× remains open.

## Reproducible evidence

`manifest.json` binds original/reversibly wrapped native/build/integration/floor logs, exact source/config/controller, all four paired receipts and 240 ordinary timing windows. Portable tests independently reparse measurements, hashes, guest observations, runtime/order, child signals/exits, minima and floor verdicts. No engine was downloaded or executed on this VPS: local load and disk failed headroom (03:41 load 4.17/3.82/3.62 on four CPUs, workspace 730 MB free). Only small receipt/metadata work was allowed.

Next experiments need a separate profile-backed hypothesis and their own correctness plus repeated ordinary acceptance. Do not cache public mutable device inventories, stack mixed source variants, restamp physical acknowledgements, or relax floors to promote this candidate.
