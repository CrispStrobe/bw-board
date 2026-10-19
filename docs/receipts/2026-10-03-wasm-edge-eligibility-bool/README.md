# Live boolean GPIO edge eligibility (isolated WASM experiment)

Candidate core `14a275f63daaf3cd4af4b1845e52678032553522` starts directly from production core43b2. Unlike the rejected caller-gate experiment, it retains the outlined cold hook layout. Only its first eligibility scan uses a WASM/test-only boolean trait method, whose default calls the same current `edge_service_addrs` slice query. No inventory/address cache or chip-specific decision is added. The actual address/routing scan, synchronous service order, mux/timer delivery, CPU, scheduler, accessors and native production dispatch/trait layout remain unchanged.

Compiled production inspection previously resolved the confusing `input_channels` sampling label to an empty-slice GPIO eligibility callee shared by the Button vtable. Returning eligibility directly is an ABI experiment, not a claim that its sampled share is removable or proof of a particular compiler-layout explanation. Correctness and ordinary timings, not profiler-label disappearance, decide its result.

[Native verification](https://github.com/CrispStrobe/labwired-core/actions/runs/37116735002) passes five focused tests with and without the event scheduler, **4,239 library tests** (three existing ignored), and **16 GPIO integration tests**. Tests cover real contacts, live mutable addresses, public attachment/removal/replacement, registration order, and narrower/unmapped routing. No ratchet or allowlist was relaxed.

[Independent WASM build](https://github.com/CrispStrobe/bw-board/actions/runs/37117416202) passes module/glue determinism and **108 actual integrations**, including seven same-PC RAM/MMIO guest proofs. Its separate fresh motion median/minimum is **1.112814× / 1.085248×**, with the unchanged all-window floor **passing**. This fresh capture is not a paired speedup. Publication is skipped.

## All ordinary paired results

Ten windows per artifact/row, original hashes verified on the same runner, frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, Node20.20.2/22.23.3 and both ABBA/BAAB orders. No forced tier, profiler, census or other optimizer. Different rows use different hosted CPUs; they do not establish Node-version causality or statistical significance.

| Runtime/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 ABBA | motion | 0.580875 / 0.547607 | 0.603272 / 0.597308 | 3.86% | FAIL / FAIL |
| 20.20.2 ABBA | RAM | 2.829930 / 2.762173 | 2.844812 / 2.824737 | 0.53% | pass / pass |
| 20.20.2 ABBA | GPIO | 0.557685 / 0.539581 | 0.579855 / 0.556005 | 3.98% | FAIL / FAIL |
| 20.20.2 BAAB | motion | 0.979445 / 0.969945 | 0.957641 / 0.938366 | -2.23% | FAIL / FAIL |
| 20.20.2 BAAB | RAM | 3.716571 / 3.645614 | 3.721308 / 3.653770 | 0.13% | pass / pass |
| 20.20.2 BAAB | GPIO | 0.819795 / 0.815122 | 0.837757 / 0.831211 | 2.19% | FAIL / FAIL |
| 22.23.3 ABBA | motion | 1.543038 / 1.476957 | 1.570611 / 1.539583 | 1.79% | pass / pass |
| 22.23.3 ABBA | RAM | 5.248648 / 5.139962 | 5.264022 / 5.209253 | 0.29% | pass / pass |
| 22.23.3 ABBA | GPIO | 1.270456 / 1.136083 | 1.328426 / 1.309165 | 4.56% | pass / pass |
| 22.23.3 BAAB | motion | 0.813368 / 0.747348 | 0.804079 / 0.782504 | -1.14% | FAIL / FAIL |
| 22.23.3 BAAB | RAM | 2.877236 / 2.599595 | 2.851576 / 2.678892 | -0.89% | pass / pass |
| 22.23.3 BAAB | GPIO | 0.622106 / 0.608178 | 0.713470 / 0.670921 | 14.69% | FAIL / FAIL |

- [Original run 37117999177](https://github.com/CrispStrobe/bw-board/actions/runs/37117999177): Node 20.20.2, ABBA.
- [Original run 37118122164](https://github.com/CrispStrobe/bw-board/actions/runs/37118122164): Node 20.20.2, BAAB.
- [Original run 37118218211](https://github.com/CrispStrobe/bw-board/actions/runs/37118218211): Node 22.23.3, ABBA.
- [Original run 37118320716](https://github.com/CrispStrobe/bw-board/actions/runs/37118320716): Node 22.23.3, BAAB.

All gains, losses, minima and unchanged floor verdicts are retained. These selected F0 RAM/GPIO and micro:bit motion guests use nominal 48/64 MHz engine cycles, not calibrated silicon CPI, all supported targets, browser/UI/debugger throughput or hardware qualification. The source is **unmerged/unqualified** unless separately qualified and promoted later; this archive does not promote it. Production app pins and seven physical drift acknowledgements/captures/expiry remain unchanged; hardware re-capture is owed. CP13/all-target ≥1× remains open.

## Evidence and resources

The manifest binds all original or losslessly wrapped source/build/integration/floor logs, source contracts, immutable controller/configuration and all four paired receipts: **240 timing windows**. Portable evidence tests independently reparse hashes, guests, versions/orders, exits, medians/minima/floors, actual integration records and live/native source invariants. No performance direction is encoded as a promotion assertion.

VPS workspace free fell to approximately445MiB, and load reached9.77 on four CPUs during this phase. No local engine build, download, execution, profiling, benchmark, new agent or cleanup ran. Only small source/metadata/receipt work and portable checks were local; heavy work used hosted runners. Receipt downloads require a128MiB disk reserve.
