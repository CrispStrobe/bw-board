# Scalar word dispatch: complete results, not qualified

Timed core `ce3021331b8cd0ee623e0d50ed43562227f3bdcd` starts directly from production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`; no rejected cap64, GPIO gate, admission or optimizer changes are stacked. A WASM-only prefix in ordinary scalar execution selects only decoded 16-bit LDR/STR immediate words, outside IT blocks and with no CPU observers. It calls the unchanged canonical load/store handlers (including live MMIO, bus observers and errors) and the same PC advance. Wake/exception/decode/trace handling remains before this prefix; fault escalation and batch cycle/IRQ/reset guards remain outside it. This is not a RAM-only admission rule or block-cache widening. Native production dispatch is unchanged.

[Timed-source native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37098864660) passed all four dispatch tests, two scanner regressions, **4,240 library tests** (three pre-existing ignored) and **16 real GPIO integrations**. Exhaustive halfword classification executes 4,096 selected opcodes against the original full scalar match; other tests cover RAM/unaligned/MMIO/error, IT, CPU observer, debug halt, WFE and width refusals. [Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37099235200) passes byte determinism and **108 actual integrations**, including seven same-PC RAM/MMIO cases. Actual-WASM semantics do not prove dispatch hit counts. Fresh motion median/minimum is **0.793103× / 0.791293×**, below the unchanged all-window ≥1× floor; overall failure and skipped publication are retained.

## Every ordinary paired result

Each row contains ten windows per artifact on the same runner, with original WASM/glue hashes checked before execution, frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, pinned Node versions and no profiling, forced tiers, census or extra optimizer. Different rows use different hosted CPUs: these data do not establish Node-version causality, statistical significance or a general speedup.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.563190 / 0.513481 | 0.578911 / 0.569773 | 2.79% | FAIL / FAIL |
| 20.20.2 ABBA | RAM | 2.861464 / 2.808721 | 2.832385 / 2.809262 | -1.02% | pass / pass |
| 20.20.2 ABBA | GPIO | 0.546147 / 0.519520 | 0.574085 / 0.539601 | 5.12% | FAIL / FAIL |
| 20.20.2 BAAB | motion | 0.828351 / 0.812279 | 0.800397 / 0.761773 | -3.37% | FAIL / FAIL |
| 20.20.2 BAAB | RAM | 4.138107 / 4.114933 | 4.128776 / 4.114800 | -0.23% | pass / pass |
| 20.20.2 BAAB | GPIO | 0.706804 / 0.691125 | 0.731253 / 0.719660 | 3.46% | FAIL / FAIL |
| 22.23.3 ABBA | motion | 1.286159 / 1.260485 | 1.259228 / 1.216726 | -2.09% | pass / pass |
| 22.23.3 ABBA | RAM | 4.342032 / 4.061647 | 4.346571 / 4.291082 | 0.10% | pass / pass |
| 22.23.3 ABBA | GPIO | 1.036532 / 1.002808 | 0.999314 / 0.985899 | -3.59% | pass / FAIL |
| 22.23.3 BAAB | motion | 0.803459 / 0.794379 | 0.792972 / 0.783279 | -1.31% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 2.846282 / 2.759177 | 2.887212 / 2.771828 | 1.44% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.649312 / 0.637871 | 0.640488 / 0.619946 | -1.36% | FAIL / FAIL |

- [Original run 37099643578](https://github.com/CrispStrobe/bw-board/actions/runs/37099643578): Node 20.20.2, ABBA.
- [Original run 37099768455](https://github.com/CrispStrobe/bw-board/actions/runs/37099768455): Node 20.20.2, BAAB.
- [Original run 37099891492](https://github.com/CrispStrobe/bw-board/actions/runs/37099891492): Node 22.23.3, ABBA.
- [Original run 37099980431](https://github.com/CrispStrobe/bw-board/actions/runs/37099980431): Node 22.23.3, BAAB.

The selected active F0 RAM/GPIO and micro:bit motion guests use nominal 48/64 MHz engine cycles, not all targets, silicon CPI calibration, browser/UI/debugger performance or hardware qualification. Every measured loss and minimum remains included. Source is **unmerged/unqualified**; production/app pins and all seven physical drift acknowledgements remain unchanged. Hardware re-capture remains owed; CP13/all-target ≥1× is open.

## Distinct failure and supplemental proof

The [initial source run](https://github.com/CrispStrobe/labwired-core/actions/runs/37098198326), at `4b5a64d103692940861c2c68af2841cacf76450d`, passed its four new cases but failed the full library (4,237 passed, one failed, three ignored). The memory-contract scanner wrongly treated an indented test-only field as the start of a trailing test module, hiding production reset-vector reads. Tightening that boundary and adding two regressions fixed the ratchet without changing its allowlist or the dispatch prototype. No initial WASM build or timing was dispatched. The complete failed log is preserved, not relabelled as passing.

After launching ce302 timing, supplemental tests were added on the **separate** `c932c9921b25587e13f8ddd096847d24d4d9404b` branch. [Supplemental native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37099776518) passes **4,243 library tests**, seven focused dispatch cases and 16 real GPIO integrations. They compare explicit IT/sleep/banked/exception/fault/halt state and CPU observer retirement payloads; wired BusFault/HardFault/lockup/disabled escalation and stacked faulting PC; AIRCR reset stopping a batch before GPIO; and GPIO bus-observer byte payloads at cycles 37/39, final cycle 40, in both batch modes. Only the test module differs from the timed source; production source, scanner and workflow bytes are bound in the receipt. These supplemental tests were **not** in the ce302 artifact. They do not establish IRQ delivery, trace output, timer freshness or application reset draining.

`manifest.json` binds the complete original/reversibly wrapped source/build/integration/floor logs, failed initial log, distinct supplemental proof, exact configuration/controller, four paired receipts and all 240 ordinary timing windows. Portable tests independently reparse measurements, hashes, guest observations, runtime/order, exits, minima and floor verdicts. No engine was downloaded, built or executed on the VPS; only small receipts/metadata and portable evidence tests were used. At 05:24 UTC the four-CPU host had load 2.44/1.78/2.60, 4,518,490,112 bytes available memory and only 4,296,605,696 bytes free on the workspace volume. This permitted small reviews but not a local engine build or download. Further optimization needs a separate profile-backed hypothesis and repeated acceptance, without relaxing floors or physical requirements.
