# Task-attempt source: finite xv6 qualification

[Draft PR468](https://github.com/CrispStrobe/bw-board/pull/468) reviewed source
`f3b8b31d6e403020089f1dee31eaece45c06ac25` passed hosted xv6
[run37888849044](https://github.com/CrispStrobe/bw-board/actions/runs/37888849044).
The executed synthetic PR merge `6775404610eddd4454b38fc1d9fe350e7b1df7d0`
has the same tree `8d69b3304d9cfa3ebeecf61c770cf0b2241f77ce` as the reviewed head.
[Original artifact11597982186](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11597982186/zip)
and its raw workflow log were read by root and a separate Sol auditor without
replaying guests or importing producer helpers. Exact hashes and bounds are
in the [summary](summary.json).

All three finite scenarios passed: fresh 4 MiB filesystem roundtrip, 14 MiB
boot and 4 MiB `forktest`. Each report's 70 listed source roles matched immutable
Git; build/input/ROM identities and finite serial/kernel/user-mode milestones
matched. The audit verified 71 unique Git roles across the packet. Reported
RAM/disk hashes remain reported outcomes, not independently reconstructed RAM.

All 73 focused names passed: 44 journal, five boundary, 13 policy and 11
orchestration tests. The current cohort reports 1,648 tests, 1,637 passes, zero
failures and 11 skips; the historical cohort passes 288/288.

This is the existing PSE/APIC compatibility profile, not strict physical386DX.
The remaining enabled exact-head checks and separate real CWSDPMI attempted-task
diagnostic still need qualification. No task-switch commit, completed service
frame, Windows, speedup or source adoption follows from this xv6 packet.
