# Live C3 word-write hook gate: complete results, not promoted

Candidate `324a3e1a0b48a1520c00bed12bc6560742ee5b46` starts directly from production `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, with no rejected variants stacked. Only the 32-bit peripheral-store call to `sync_esp32c3_irq_cache_write` gets a WASM/test-only inline live gate. The original C3 hook still runs whenever its INTC cache exists, **even if routing is disabled**, because register-cache updates remain required. With the event scheduler, it also runs whenever the legacy walk is deleted and C3 routing is active, **even without an INTC cache**, because refreshing the scheduler-source bitmap is an observable effect. All other states return before work in the original hook; the gate avoids that inert call. Its input is current bus state at each successful store, not chip names, a cached device inventory or memoized eligibility. The scheduler arm is absent without the feature. Native production retains the original unconditional call. CPU, hook body, cycle/reset/IRQ/scheduler logic, reads and byte/halfword paths are byte-identical to production.

Prior whole-process GPIO profiles attributed 7.21–7.76% to `write_u32`, not to this individual hook. Those profiles include setup, functional tests, warm-up and tiering: this gate is a source-inspection-backed hypothesis, not a prediction of removable cost or speedup.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37105056159) passes four focused cases with the event scheduler, three without it, **4,238 library tests** (three pre-existing ignored) and **16 real GPIO integrations**. New cases cover all live cache/routing/walk-policy combinations and reversals; inactive original-hook read-only equivalence; actual stores asserting/deasserting scheduler-source bitmaps without an INTC cache; and actual C3/C6 doorbell stores immediately updating cache and IRQ lines, including cache updates with routing disabled. These tests use the same gate in the native test build, but do not establish actual-WASM performance or every C3 firmware's behavior.

[Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37105698314) passes byte determinism and **108 actual integrations**, including seven same-PC RAM/MMIO cases. These actual-WASM cases establish deployed semantics for their guests, not gate hit counts or full C3/C6 firmware qualification. Fresh motion median/minimum is **1.471221× / 1.419914×**; the unchanged all-window ≥1× floor **passes**. Actual workflow conclusion and skipped publication remain retained.

## Every ordinary paired result

Each row has ten timing windows per artifact on the same runner, with original WASM/glue hashes verified before execution. Harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162` and Node versions are frozen; these are ordinary runs with no profiling, forced tiers, census or extra optimizer. Different rows use different hosted CPUs, so do not infer Node-version causality, statistical significance or speedup from separate fresh captures.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 1.324296 / 1.251723 | 1.335559 / 1.276927 | 0.85% | pass / pass |
| 20.20.2 ABBA | RAM | 6.483303 / 5.703285 | 7.392081 / 6.965370 | 14.02% | pass / pass |
| 20.20.2 ABBA | GPIO | 1.177940 / 1.135560 | 1.198309 / 1.154818 | 1.73% | pass / pass |
| 20.20.2 BAAB | motion | 0.613348 / 0.594581 | 0.633638 / 0.620131 | 3.31% | FAIL / FAIL |
| 20.20.2 BAAB | RAM | 2.841332 / 2.817329 | 2.850957 / 2.787352 | 0.34% | pass / pass |
| 20.20.2 BAAB | GPIO | 0.544828 / 0.534801 | 0.570818 / 0.532774 | 4.77% | FAIL / FAIL |
| 22.23.3 ABBA | motion | 0.817845 / 0.796632 | 0.778931 / 0.735631 | -4.76% | FAIL / FAIL |
| 22.23.3 ABBA | RAM | 2.855838 / 2.719259 | 2.845002 / 2.824329 | -0.38% | pass / pass |
| 22.23.3 ABBA | GPIO | 0.640732 / 0.630994 | 0.665107 / 0.641767 | 3.80% | FAIL / FAIL |
| 22.23.3 BAAB | motion | 1.573785 / 1.477264 | 1.514276 / 1.449857 | -3.78% | pass / pass |
| 22.23.3 BAAB | RAM | 7.284971 / 6.864204 | 7.126796 / 6.973937 | -2.17% | pass / pass |
| 22.23.3 BAAB | GPIO | 1.356764 / 1.283228 | 1.367385 / 1.335698 | 0.78% | pass / pass |

- [Original run 37106155650](https://github.com/CrispStrobe/bw-board/actions/runs/37106155650): Node 20.20.2, ABBA.
- [Original run 37106243309](https://github.com/CrispStrobe/bw-board/actions/runs/37106243309): Node 20.20.2, BAAB.
- [Original run 37106373851](https://github.com/CrispStrobe/bw-board/actions/runs/37106373851): Node 22.23.3, ABBA.
- [Original run 37106497460](https://github.com/CrispStrobe/bw-board/actions/runs/37106497460): Node 22.23.3, BAAB.

The selected active F0 RAM/GPIO and micro:bit motion guests use nominal 48/64 MHz engine cycles, not all targets, calibrated silicon CPI, browser/UI/debugger performance or physical qualification. Every gain, loss, minimum and floor verdict is retained. Source remains **unmerged and not promoted**; production/app pins and all seven physical drift acknowledgements/captures/expiry are unchanged. Hardware re-capture remains owed; CP13/all-target ≥1× remains open.

## Initial failed fixture proof

[The initial source run](https://github.com/CrispStrobe/labwired-core/actions/runs/37104300410), at `b8eb327e9eaa445af258f6c551d2c84bba9ac4c6`, passed all four focused tests with the scheduler and all three without it, but the full library failed (4,237 passed, one failed, three ignored). Its new scheduler-source fixture directly asserted `legacy_walk_disabled = true`, violating the walk-deletion ratchet. The corrected fixture declares walk independence, uses an empty bus, and invokes `recompute_walk_deletable` after registering its mock. Only the test file changed; neither the engine prototype nor ratchets/allowlists changed. Full original failure logs remain preserved. The real integration stage was not reached, and no initial WASM build or timing was dispatched. The timed source is the corrected 324a head, not this failed b8 head.

## Evidence and resource constraints

`manifest.json` binds complete original/reversibly wrapped source/build/integration/floor logs, the initial failed fixture proof, both scheduler feature configurations, the exact source-diff contract, immutable controller/configuration, all four paired receipts and all 240 ordinary timing windows. Six portable evidence tests independently reparse timings, hashes, guest observations, runtime/order, exits, minima/floors, the isolated engine diff and the distinction between failed/corrected source proofs. Evidence direction is not selected as an assertion for promotion. No engine was downloaded, built or executed on the VPS. At 06:39 UTC, load was 2.88/2.21/2.58 on four CPUs, available memory 4,900,270,080 bytes, and workspace free space only 3,739,729,920 bytes, below the 4 GiB benchmark reserve. By 07:03 UTC, load was 8.18/8.62/8.03 and workspace free space just 1,651,916,800 bytes. Only small source authoring, cached rustfmt, receipt orchestration and portable evidence checks were local; no new agents, heavy local tasks or cleanup ran.
