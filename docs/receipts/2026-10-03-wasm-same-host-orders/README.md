# Repeated ordinary orders on a fixed VM per runtime

[Hosted run 37119884143](https://github.com/CrispStrobe/bw-board/actions/runs/37119884143) compares unchanged production core43b2 with unmerged live boolean edge-eligibility candidate14a. Each runtime job uses one VM for four pairs, ABBA/BAAB/BAAB/ABBA, retaining **480 timing windows**. Both jobs use original verified module/glue hashes and the unchanged frozen harness `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`. Default Node flags, no profiler, census, forced tier or optimizer.

| Runtime/pair/order | Guest | Baseline median / min RTx | Candidate median / min RTx | Median delta | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| 20.20.2 #1 ABBA | motion | 0.569144 / 0.548802 | 0.574467 / 0.569652 | 0.94% | FAIL / FAIL |
| 20.20.2 #1 ABBA | RAM | 2.833502 / 2.758264 | 2.842001 / 2.820925 | 0.30% | pass / pass |
| 20.20.2 #1 ABBA | GPIO | 0.551579 / 0.537188 | 0.574565 / 0.561887 | 4.17% | FAIL / FAIL |
| 20.20.2 #2 BAAB | motion | 0.618322 / 0.610819 | 0.614294 / 0.607193 | -0.65% | FAIL / FAIL |
| 20.20.2 #2 BAAB | RAM | 2.844391 / 2.793409 | 2.843048 / 2.754579 | -0.05% | pass / pass |
| 20.20.2 #2 BAAB | GPIO | 0.546053 / 0.530207 | 0.574808 / 0.559161 | 5.27% | FAIL / FAIL |
| 20.20.2 #3 BAAB | motion | 0.591803 / 0.563571 | 0.597665 / 0.592046 | 0.99% | FAIL / FAIL |
| 20.20.2 #3 BAAB | RAM | 2.838756 / 2.712647 | 2.813353 / 2.735195 | -0.89% | pass / pass |
| 20.20.2 #3 BAAB | GPIO | 0.558684 / 0.509815 | 0.567689 / 0.547740 | 1.61% | FAIL / FAIL |
| 20.20.2 #4 ABBA | motion | 0.609305 / 0.594979 | 0.605079 / 0.583184 | -0.69% | FAIL / FAIL |
| 20.20.2 #4 ABBA | RAM | 2.847812 / 2.826577 | 2.840437 / 2.808086 | -0.26% | pass / pass |
| 20.20.2 #4 ABBA | GPIO | 0.544888 / 0.529919 | 0.574786 / 0.565609 | 5.49% | FAIL / FAIL |
| 22.23.3 #1 ABBA | motion | 0.799096 / 0.789132 | 0.805871 / 0.791650 | 0.85% | FAIL / FAIL |
| 22.23.3 #1 ABBA | RAM | 2.880653 / 2.834385 | 2.846560 / 2.793553 | -1.18% | pass / pass |
| 22.23.3 #1 ABBA | GPIO | 0.676338 / 0.632819 | 0.707280 / 0.689628 | 4.58% | FAIL / FAIL |
| 22.23.3 #2 BAAB | motion | 0.809165 / 0.798605 | 0.808689 / 0.782842 | -0.06% | FAIL / FAIL |
| 22.23.3 #2 BAAB | RAM | 2.841826 / 2.753159 | 2.889983 / 2.744704 | 1.69% | pass / pass |
| 22.23.3 #2 BAAB | GPIO | 0.633733 / 0.619937 | 0.694747 / 0.667160 | 9.63% | FAIL / FAIL |
| 22.23.3 #3 BAAB | motion | 0.816549 / 0.791022 | 0.794438 / 0.779193 | -2.71% | FAIL / FAIL |
| 22.23.3 #3 BAAB | RAM | 2.809742 / 2.764648 | 2.860475 / 2.843030 | 1.81% | pass / pass |
| 22.23.3 #3 BAAB | GPIO | 0.652115 / 0.643339 | 0.702712 / 0.695212 | 7.76% | FAIL / FAIL |
| 22.23.3 #4 ABBA | motion | 0.814551 / 0.783938 | 0.773800 / 0.753121 | -5.00% | FAIL / FAIL |
| 22.23.3 #4 ABBA | RAM | 2.840951 / 2.701405 | 2.864429 / 2.792206 | 0.83% | pass / pass |
| 22.23.3 #4 ABBA | GPIO | 0.592038 / 0.561708 | 0.704841 / 0.687066 | 19.05% | FAIL / FAIL |

A fixed VM reduces between-pair CPU variation but does not control shared-host load, JIT settling or thermal state. Runtime jobs may use different CPUs: these results do not establish Node-version causality, statistical significance, silicon CPI, browser/debugger/UI throughput or all-target qualification. Every failed floor and measured regression remains visible; no favorable subset is used to promote the engine. Production core, app pins, seven physical drift acknowledgements/captures/expiry remain unchanged; hardware re-capture is owed. CP13/all-target ≥1× remains open.

GPIO gains persist across all eight pairs (+1.61% to +19.05%), but motion remains mixed (−5.00% to +0.99%) and RAM changes −1.18% to +1.81%. Candidate motion/GPIO floors fail in every pair; RAM floors pass all eight. This does not justify engine promotion. Both jobs report AMD EPYC 7763, which is CPU-model identity, not proof of the same physical host across runtime jobs.

The manifest binds all raw receipts/stdout/stderr, build provenance, job logs, source contract, controller, original tool source and exact-head tooling landing proof. Empty/non-newline bytes are losslessly wrapped. Portable tests independently check all hashes, original outputs, guest observations, versions, order, CPU, medians/minima and unchanged floors. No local engine build/download/execution or benchmark ran.

During capture, unrelated activity filled the workspace volume. Its 128MiB reserve guard stopped the original controller before receipt artifact download. The two small artifacts (124,403 and 124,242 compressed bytes) were then captured and independently verified on the separate root filesystem, which had 3,241MiB free. Documentation was staged in a sparse shared clone there. The resource fallback is retained; no user files were deleted and no local heavy work or agents ran.
