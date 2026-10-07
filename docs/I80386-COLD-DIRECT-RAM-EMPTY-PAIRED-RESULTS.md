# Cold direct-RAM empty-journal paired result

Updated 2026-10-07. The [actual paired run 37631662099](https://github.com/CrispStrobe/bw-board/actions/runs/37631662099) passed the finite cold guest semantics in all 36 fresh children, but **failed the native adoption gate**. The empty-journal provider variant reduced execution CPU by 2.9052% against the unchanged direct provider on this host. It still used **5.4971× the execution CPU and 10.3769× the execution wall time of ordinary JavaScript**. Keep ordinary JavaScript as the user-facing path and stop this cold native performance experiment.

The timing harness was [PR430](https://github.com/CrispStrobe/bw-board/pull/430) source `b995c5550347181e29b2810f25e0e1eee52cb0c6`; the unchanged qualified CPU3 source was `acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1`. The candidate changes one authenticated provider expression: for an empty copied journal it retains the existing generation Map, while a nonempty journal keeps the original staged clone, complete validation and commit. Both direct arms retain native drain, session-bound acknowledgement and callbacks. The separate [actual correctness run](I80386-COLD-DIRECT-RAM-EMPTY-RESULTS.md) qualified that variant before this timing gate.

## Same-host measurement

Each comparison used two warm-up pairs and seven alternating measured pairs, with a fresh process for every arm. Execution intervals exclude setup, settlement and diagnostic serialization. The GitHub runner reported AMD EPYC 7763, four logical CPUs and Node 22.23.3. Ratios divide the seven-arm sums; smaller than 1 means the candidate was faster.

| Candidate compared with | Execution CPU ratio | Execution wall ratio | Whole-child CPU ratio | Whole-child wall ratio | Favorable CPU pairs | Decision |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Unchanged direct provider | 0.970948× | 0.969710× | 0.974918× | 0.970710× | 7 / 7 | Descriptive provider comparison |
| Ordinary JavaScript | 5.497054× | 10.376883× | 3.829983× | 5.377982× | 0 / 7 | Adoption **FAIL** |

The direct-provider comparison isolates this one Map-clone change within the bounded workload and records a 2.9052% mean execution-CPU reduction. It does not establish a general emulator speedup or a precise Map-copy cost share. The adoption rule requires at least 10% lower mean execution CPU than ordinary JavaScript and all seven pairs favorable; neither condition is met. This runner host differs from the earlier [direct-RAM paired run](I80386-COLD-DIRECT-RAM-PAIRED-RESULTS.md), so those absolute times are not a cross-run trend. Configured-clock RTx is not calibrated physical 16 MHz 386DX speed.

## Semantic and evidence boundary

All 27 native children match the immutable reference's complete reset, requested-last and final 166-word CPU state, progress, board state, full 16 MiB final RAM SHA-256 and all 16,475 ordered PIO events. Each native owner reports 91,958 committed and acknowledged writes and closes without pending work. The nine ordinary-JS children match the common CPU fields, complete board and RAM outcome, and the PIO convention; their closure is process scope because the JS model has no close API. The timing packet authenticates the earlier complete initial-RAM/journal replay and the [empty-provider correctness result](I80386-COLD-DIRECT-RAM-EMPTY-RESULTS.md); it does not record a fresh per-write diagnostic tape inside every timed child.

[Artifact 11487555560](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11487555560) is 7,571,054 bytes, ZIP SHA-256 `206f730dbf6745f01fd5eea6f902b340605be669898c153c227d72bb3360cd02`. Two independent raw audits checked its 304 unique members, 303-member hash inventory, 26 harness and 150 qualified Git source roles, build/configuration/reference bindings, all 36 child receipts and the ratio arithmetic without importing the producer comparator or replaying guests. The compiled addon is omitted from the artifact; its digest is a fresh static-build receipt binding, not a binary rehash by the auditors. The [small public receipt](receipts/2026-10-07-cold-direct-ram-empty-paired.json) records the bounded result.

No native clock-authority integration or further cold-profile performance adoption follows from this result. The separate [clock-authority model](https://github.com/CrispStrobe/bw-board/pull/423) remains source-only and unconnected. Subsequent performance work should measure the functional JavaScript path on actual free application workloads, with source and guest identity fixed before drawing a speed conclusion.
