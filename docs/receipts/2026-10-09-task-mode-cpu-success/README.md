# Task-mode CPU prerequisite: corrected hosted result

[Draft PR476](https://github.com/CrispStrobe/bw-board/pull/476) source
`44087e8f1d19b1f74c6f2742ebca31594f6e7208` passed the original
[PR xv6 run37914446180](https://github.com/CrispStrobe/bw-board/actions/runs/37914446180).
Root and independent peer read the sole retained official ZIP and raw log without
producer imports, guest replay or secondary acquisition. See [summary.json](summary.json)
for immutable original identities and audit attribution.

The executed PR merge tree equals the reviewed source tree. All 71 listed source
roles match Git. Three finite compatibility-profile xv6 scenarios passed: 4 MiB
and 14 MiB boot markers and 4 MiB forktest. All 114 focused controls passed,
including the corrected between-step scalar fixture. Current suite: 1,689 tests,
1,678 passed, zero failed, 11 skipped. Historical suite: 288 passed, zero failed.

Preserve the [first failed CPU-control run](../2026-10-09-task-mode-cpu-failure/README.md).
The correction changes one test fixture; CPU code and strict frame rules are
unchanged. This evidence qualifies the CPU prerequisite within those finite
boundaries. The new task-mode guest diagnostic remains unconnected and
unqualified. It establishes no native/profile execution, physical 386DX RTx,
original-task resumption or owned-frame return. All twelve enabled exact-head checks subsequently passed, with only the two
declared optional `vectors-full` skips. The next source task is the separately
named guest diagnostic; its source and actual need their own qualification.
