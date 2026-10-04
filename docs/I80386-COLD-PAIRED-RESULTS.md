# Cold BIOS E16 paired CPU results

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

Keep the plain-JS baseline. The latest scalar-ledger candidate used 5.251347× execution CPU against JS and lost all seven measured pairs. Earlier fusion, native and typed-state comparisons remain separately recorded below. These are fixed free-BIOS checkpoint results, not broader guest/full-boot speed results or default adoption.

## Scalar-ledger candidate: keep plain JS

[Run 37207816332](https://github.com/CrispStrobe/bw-board/actions/runs/37207816332), frozen parent `06c9f951`, compared scalar worker `06581f38` (73 inputs) with unchanged plain-JS worker `0f1ec8cc` (49 inputs). Native retained compiled `85fc1599` (151 inputs), DSO `7de755f0` and the fixed scalar-provider profile; JS retained its original capture authority. Two warmup pairs and seven alternating measured pairs completed 18 fresh children on one AMD EPYC 7763 host, four logical CPUs, CPUs 0–3 and Node 22.23.3.

| Measured window | Plain JS mean / median | Scalar batched mean / median |
| --- | ---: | ---: |
| Execution CPU | 0.408969429 / 0.405736000 s | 2.147640571 / 2.149350000 s |
| Execution wall | 0.198654726 / 0.194742055 s | 1.776628668 / 1.770912784 s |
| Whole-child CPU (wait4) | 1.472503286 / 1.467099000 s | 6.592419286 / 6.586229000 s |
| Whole-child wall | 1.138358731 / 1.135216654 s | 5.850786676 / 5.833671460 s |

Scalar native used **5.251347× execution CPU** and **8.943299× execution wall**, losing all seven measured pairs. The unchanged ≥10% mean CPU reduction/all-seven gate fails; keep plain JS. This comparison did **not** measure held fusion versus scalar, so it establishes no improvement or regression caused by copy removal. Absolute timings must not be combined with earlier hosts. The configured virtual seconds divided by mean execution wall are 1.593529 for JS and 0.178181 for scalar (six clocks per Q at 6 MHz); these are not physical 16-MHz 386 calibration.

The [independent audit](receipts/i80386-cold-ledger-scalars-paired-results-20261004/independent-scalar-paired-audit.json) and [root cross-check](receipts/i80386-cold-ledger-scalars-paired-results-20261004/root-cross-check.json) verify all 266 official members, 364 source-role paths and all 18 terminal proofs. Nine native children retain raw reset/final/last-return 166-word CPU states and N/Q 316,562; nine JS children retain represented CPU/Q. All 18 match terminal board, RAM hash and the complete 16,475-event ordered PIO tape. Live buffer/scalar ownership remains authenticated-source attested; whole RAM bytes were not retained. Each native child retains 167,123 validated fused effects (75,401 reads + 91,722 writes), with bridge attempts distinct from accepted logical transfers. This is fixed E16 correctness, not broader guest/full boot, a 10× result or adoption.

The [compact index](receipts/i80386-cold-ledger-scalars-paired-results-20261004/index.json), [18-child timing series](receipts/i80386-cold-ledger-scalars-paired-results-20261004/actual-18-child-series.json) and [host context](receipts/i80386-cold-ledger-scalars-paired-results-20261004/host-before.json) retain exact small origins. Official artifact `11305955756` is 42,577,961 bytes, SHA-256 `0edf476f7c835a253c299f4e0f7e3bc73c4a7d0438470659003b5458e37b7075`; the sole local ZIP and official expiry remain recorded. [Upstream result](https://github.com/CrispStrobe/bw-board/pull/365#issuecomment-5980884433). No retry occurred.

## MEMORY clock-fusion candidate: keep plain JS

[Run 37187325276](https://github.com/CrispStrobe/bw-board/actions/runs/37187325276), frozen parent `b3e29ad3`, compares fusion worker `735740cb` (63 inputs) against unchanged plain-JS worker `0f1ec8cc` (49 inputs). The candidate uses compiled `85fc1599` (151 inputs), DSO `7de755f0`, copied-U32 and MEMORY-fusion profiles. The plain worker retains its original compiled `7632e6a0` capture authority. Two warmup pairs and seven alternating measured pairs completed all 18 fresh children on one AMD EPYC 9V74 host: four logical CPUs, allowed CPUs 0–3, Node 22.23.3 and the recorded process cgroup context.

| Measured window | Plain JS mean / median | Fusion batched mean / median |
| --- | ---: | ---: |
| Execution CPU | 0.299012571 / 0.299204000 s | 1.536703714 / 1.536468000 s |
| Execution wall | 0.143191210 / 0.142665389 s | 1.270581774 / 1.270506532 s |
| Whole-child CPU (wait4) | 1.106678857 / 1.105710000 s | 5.076957714 / 5.058220000 s |
| Whole-child wall | 0.856981945 / 0.856461744 s | 4.516555877 / 4.495399807 s |

Fusion used **5.139261× execution CPU** and **8.873322× execution wall**, losing all seven measured pairs. The unchanged ≥10% mean CPU reduction/all-seven gate fails; keep JS. This did not measure old native exports against fusion, and absolute timings must not be combined with earlier hosts. Configured six-MHz virtual RTx is not a physical 16-MHz 386 calibration.

The [independent actual audit](receipts/i80386-cold-memory-fusion-paired-results-20261004/independent-fusion-paired-audit.json) verifies all 267 artifact members, 351 role paths and 18 terminal proofs. Nine native children retain raw reset/final/last-return 166-word CPU and N/Q 316,562; nine JS children retain represented CPU/Q. All 18 match terminal board, RAM hash and the complete 16,475-event ordered PIO tape. Live copied-buffer ownership and comparison execution remain source-attested; whole RAM bytes were not retained. This is the fixed E16 scope, not broader guest/full boot or adoption.

All nine fusion children retain identical counter maps: 167,123 validated fused memory effects (75,401 reads + 91,722 writes), 65,999 clock outer entry attempts and 183,907 memory outer entry attempts. The legacy `clockTransfers.transfers` value 233,122 counts accepted logical transfers in this profile, not JS entries. These counts establish neither CPU shares nor an old-native-versus-fusion speed gain.

The [receipt index](receipts/i80386-cold-memory-fusion-paired-results-20261004/index.json), [complete 18-child timing series](receipts/i80386-cold-memory-fusion-paired-results-20261004/actual-18-child-series.json), [counter series](receipts/i80386-cold-memory-fusion-paired-results-20261004/actual-bridge-count-series.json) and [external retention record](receipts/i80386-cold-memory-fusion-paired-results-20261004/external-retention.json) preserve exact small evidence. The sole official artifact is `11297715775`, 42,490,189 bytes, SHA256 `b56b9dabb5ac6849f2532f37ddf1bf9807164cdfbb9888813ad232053d45d546`; its expiry and canonical local ZIP are recorded. [Upstream result comment](https://github.com/CrispStrobe/bw-board/pull/345#issuecomment-5977941393). No retry occurred.

## Copied Uint32Array candidate: keep plain JS

The separately qualified typed-state candidate also failed its primary plain-JS gate. [Run 37149610856](https://github.com/CrispStrobe/bw-board/actions/runs/37149610856), frozen parent `9f304281`, used typed worker `162a9b2a` with compiled `f4a2f2ce`/DSO `d7fa1a72`, and unchanged plain-JS worker `0f1ec8cc`. On one AMD EPYC 7763 host with four logical CPUs, two warmup pairs and seven alternating measured pairs completed all 18 fresh children. All seven measured pairs favored JS.

| Measured window | Plain JS mean / median | Typed batched mean / median |
| --- | ---: | ---: |
| Execution CPU | 0.403618571 / 0.404506 s | 1.640092 / 1.623479 s |
| Execution wall | 0.198146057 / 0.199575364 s | 1.364892926 / 1.354852740 s |
| Whole-child CPU (wait4) | 1.451751429 / 1.454489 s | 5.590119429 / 5.552564 s |
| Whole-child wall | 1.127077741 / 1.134210475 s | 4.978225903 / 4.949974635 s |

Typed batching used **4.063470× execution CPU** and **6.888317× execution wall**, so the ≥10% reduction/all-seven gate failed. Keep JS; this comparison did not measure old native array exports against typed exports. Do not combine absolute timings with the earlier hosts or infer a physical 16-MHz 386 calibration.

The independent [actual audit](receipts/i80386-cold-typed-paired-results-20261003/independent-typed-paired-audit.json) verifies all 267 artifact members and all 18 terminal proofs. Nine native children retain raw reset/final/last-return 166-word snapshots and N/Q; nine JS children retain represented CPU/Q. All children match board, RAM hash and the full 16,475-event PIO tape. Live typed-buffer ownership is attested by executed source; whole RAM bytes were not retained. Coverage remains the fixed E16 checkpoint, not broader guest/full boot or adoption. The [result summary and receipt index](receipts/i80386-cold-typed-paired-results-20261003/index.json) and [external ZIP retention record](receipts/i80386-cold-typed-paired-results-20261003/external-retention.json) preserve the exact outcome without duplicating the large artifact. The [upstream result comment](https://github.com/CrispStrobe/bw-board/pull/330#issuecomment-5973001871) records the outcome. No retry occurred.

## Earlier ordinary-array comparisons

Both separately dispatched gates used frozen parent `d9fbe713`, native worker `b01c922c` (56 inputs), plain-JS worker `0f1ec8cc` (49 inputs), qualifier `fc0c71fb`, and unchanged compiled `7632e6a0`/DSO `40179a4f`. Each ran two discarded warmup pairs followed by seven alternating measured pairs: 18 fresh children, with the predeclared requirement of at least 10% mean execution-process CPU reduction and all seven candidate pairs favorable.

| Separate comparison | Host, four logical CPUs | Baseline mean execution CPU | Batched mean execution CPU | Whole-child CPU means | Gate |
| --- | --- | ---: | ---: | --- | --- |
| Native one-Q vs batched | AMD EPYC 7763 | 10.444491 s | 1.866638 s | 14.307042 / 5.717406 s | PASS: 82.128011% reduction, 7/7 favorable |
| Plain JS vs batched | AMD EPYC 9V45 | 0.242681 s | 0.998932 s | 0.944383 / 3.785946 s | FAIL_KEEP_BASELINE: 0/7 favorable |

Execution CPU is the worker's declared execution window; whole-child CPU is separate wait4 accounting including setup and final proof. The hosts differ, so absolute results and gains must not be combined across runs. Both recorded Linux/glibc 2.39, Node 22.23.3 and the actual process cgroup's `cpu.max=max 100000` with CPUs 0–3. Hierarchy-root context is separately labelled. Configured six-MHz functional clock ratios are not a physical 16-MHz 386 calibration.

The seven retained execution-CPU pairs, in measured order, are:

| Pair | Native one-Q | Batched on native comparison host | Plain JS | Batched on JS comparison host |
| --- | ---: | ---: | ---: | ---: |
| 0 | 10.844444 | 2.080765 | 0.237532 | 0.993976 |
| 1 | 10.248252 | 1.807411 | 0.231756 | 0.985012 |
| 2 | 10.259021 | 1.824441 | 0.232526 | 0.971396 |
| 3 | 10.303597 | 1.834694 | 0.249604 | 0.973282 |
| 4 | 10.290056 | 1.854037 | 0.245763 | 1.154801 |
| 5 | 10.753176 | 1.817602 | 0.245868 | 0.962654 |
| 6 | 10.412892 | 1.847518 | 0.255717 | 0.951401 |

All 36 actual children exited successfully and passed their fixed terminal evidence. Native children retain strict raw terminal 166, independent N/Q 316562, actual terminal resume metadata, settled board/RAM-hash and full 16,475-event PIO comparison; batching uses 16,524 resumes versus 316,562 one-Q. Plain-JS evidence covers represented JS architecture and board/RAM/PIO, not a native 166 snapshot. Whole RAM bytes and reconstructible intermediate CPU states were not retained. This coverage remains the fixed Bochs-reset-model E16 profile, with the reviewed undefined-OF ownership policy; it does not establish generic AT, protected-mode OS or full BIOS boot admission.

The [first incomplete paired attempt](I80386-COLD-PAIRED-FIRST-FAILURE.md) remains unchanged: one successful warmup child preceded a parent progress-path error and zero measured pairs. The corrected source's actual-parent pure regression traversed 18 mocked children and all 11 controls passed before these two new gates. Neither completed gate was rerun.

Independent audits authenticate all 279 members and 18 children per completed artifact, source/worker/compiled bindings, final authentication, schedule and arithmetic: [native audit](receipts/i80386-cold-paired-results-20261003/native/independent-native-paired-audit.json), [JS audit](receipts/i80386-cold-paired-results-20261003/plain-js/independent-js-paired-audit-r2.json). The [index](receipts/i80386-cold-paired-results-20261003/index.json) retains small raw metadata, inputs, exits, terminal validations, results, context and audits with [byte-exact origins](receipts/i80386-cold-paired-results-20261003/origins.json). Complete original receipts/PIO/progress/authentication remain in the separately retained ZIPs, bound by every member hash and [external retention record](receipts/i80386-cold-paired-results-20261003/external-retention.json); binaries and full tapes are not duplicated here.

Official runs: [native comparison 37129594786](https://github.com/CrispStrobe/bw-board/actions/runs/37129594786), [JS comparison 37130085357](https://github.com/CrispStrobe/bw-board/actions/runs/37130085357). GitHub artifact expiry is recorded with each artifact; canonical local ZIPs retain the evidence beyond that temporary download availability.
