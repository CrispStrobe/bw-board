# Cached executor inlining: complete results, not promoted

Candidate `68747bf0b2cc50989af9ee28907719709a053aa8` starts directly from production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, without stacking rejected experiments. The **only engine change** is a WASM-only `inline(always)` attribute replacing `inline(never)` on `run_t16_cached_run`. Its body, 16-instruction cap, per-retirement cache tag/width/live-address checks and MMIO refusal are unchanged, as are every caller's IRQ, observer, debug, trace, IT, reset and scheduler guards. Native production does not call this primitive; host tests retain the original outlined version. The hypothesis is to expose the checked loop to its caller, not remove or bypass its work. Prior whole-process GPIO profiles attributed about 20% to this frame, but that is not removable cost, a steady-state estimate or a predicted speedup. Inlining can also increase code size and harm tiering.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37101693500) passes the existing exhaustive halfword/flag comparison, read-only declines, budget/branch/live-RAM comparisons and dynamic cache/MMIO barriers, **4234 library tests** (three pre-existing ignored) and **16 real GPIO integrations**. These host tests do not establish the WASM inlining/code-generation effect. [Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37102087322) passes byte determinism and **108 actual integrations**, including seven same-PC RAM/MMIO cases. Those semantics checks do not prove executor hit counts or that the emitted call was eliminated. Original Node WASM sizes are baseline **27556189 bytes**, candidate **27529635 bytes**. Fresh motion median/minimum is **0.805111× / 0.800217×**; the unchanged all-window ≥1× floor **FAILS**. Actual workflow conclusion and skipped publication are retained.

## Every ordinary paired result

Each row has ten timing windows per artifact on the same runner. Original WASM/glue hashes are checked before execution, with frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, pinned Node versions and no profiles, forced tiers, census or extra optimizer. Rows use different hosted CPUs, so do not infer Node-version causality, statistical significance or speedup from separate fresh captures.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 1.389462 / 1.370611 | 1.382597 / 1.340673 | -0.49% | pass / pass |
| 20.20.2 ABBA | RAM | 6.924932 / 6.544849 | 7.295897 / 7.088521 | 5.36% | pass / pass |
| 20.20.2 ABBA | GPIO | 1.236573 / 1.170378 | 1.039615 / 1.012142 | -15.93% | pass / pass |
| 20.20.2 BAAB | motion | 0.551352 / 0.529210 | 0.629806 / 0.618037 | 14.23% | FAIL / FAIL |
| 20.20.2 BAAB | RAM | 2.822009 / 2.794239 | 2.823697 / 2.721331 | 0.06% | pass / pass |
| 20.20.2 BAAB | GPIO | 0.543736 / 0.531213 | 0.469176 / 0.455578 | -13.71% | FAIL / FAIL |
| 22.23.3 ABBA | motion | 1.526941 / 1.423649 | 1.529499 / 1.412412 | 0.17% | pass / pass |
| 22.23.3 ABBA | RAM | 6.654811 / 6.131571 | 6.752912 / 6.440569 | 1.47% | pass / pass |
| 22.23.3 ABBA | GPIO | 1.308469 / 1.214275 | 1.129293 / 1.073361 | -13.69% | pass / pass |
| 22.23.3 BAAB | motion | 0.799251 / 0.769959 | 0.779034 / 0.749388 | -2.53% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 2.879588 / 2.849149 | 2.839407 / 2.754971 | -1.40% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.648045 / 0.597281 | 0.588057 / 0.564999 | -9.26% | FAIL / FAIL |

- [Original run 37102531936](https://github.com/CrispStrobe/bw-board/actions/runs/37102531936): Node 20.20.2, ABBA.
- [Original run 37102619970](https://github.com/CrispStrobe/bw-board/actions/runs/37102619970): Node 20.20.2, BAAB.
- [Original run 37102752251](https://github.com/CrispStrobe/bw-board/actions/runs/37102752251): Node 22.23.3, ABBA.
- [Original run 37102838525](https://github.com/CrispStrobe/bw-board/actions/runs/37102838525): Node 22.23.3, BAAB.

These selected active F0 RAM/GPIO and micro:bit motion guests use nominal 48/64 MHz engine cycles, not all targets, calibrated silicon CPI, browser/UI/debugger performance or physical qualification. Every measured gain, loss, minimum and floor verdict is retained. Source remains **unmerged and not promoted**; production/app pins and all seven physical drift acknowledgements/captures/expiry are unchanged. Hardware re-capture remains owed; CP13/all-target ≥1× remains open.

GPIO medians regress in **all four pairs (−9.26% to −15.93%)**. Motion and RAM are mixed, with lower motion/RAM minima in the reverse Node 22 pair. Candidate GPIO and motion floors fail in two of four paired runs, and fresh motion also fails. This is not a production-qualified speedup: smaller output and native/functional correctness do not compensate for the repeated GPIO loss. Do not promote this global inlining attribute or update hardware acknowledgements from these results.

## Evidence and resource constraints

`manifest.json` binds the complete original/reversibly wrapped source/build/integration/floor logs, exact source-diff contract, immutable configuration/controller, four paired receipts and all 240 ordinary timing windows. Five portable evidence checks reparse measurements, hashes, guest observations, runtime/order, exits, minima and floor verdicts, and assert that the engine diff contains only the specified comment/attribute change; evidence direction is not chosen as an assertion for promotion. No engine was downloaded, built or executed on the VPS. At 05:59 UTC, load was 1.45/1.75/2.31 on four CPUs and available memory 5,202,235,392 bytes, but workspace free space was only 3,939,618,816 bytes, below the 4 GiB benchmark reserve. Only small source edits, metadata/receipt orchestration and portable evidence checks were local; no new agents or heavy local tasks ran.
