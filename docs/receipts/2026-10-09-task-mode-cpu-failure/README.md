# Mode-recorder CPU qualification: first fixture failure

[Draft PR476](https://github.com/CrispStrobe/bw-board/pull/476), initial source
`e8bed46bd472a9307ba16a0fac48a710fa6f24fa`, failed hosted tests.
The retained [original PR xv6 run37910940230](https://github.com/CrispStrobe/bw-board/actions/runs/37910940230)
failed during CPU controls before xv6 acquisition/build/guest steps; no artifact
was produced. Root and a separate Sol reader independently checked its original
raw log, official metadata and source-only correction. The [summary](summary.json)
binds that failure and preserves the qualification boundary.

The current cohort reports 1,689 tests: 1,677 pass, one fails and 11 skip;
the historical cohort reports 288/288 passing. The sole current TAP failure is
`mode profile refuses mutated between-step descriptor scalars`. It expected
`unattributed-between-step-change` but received `mode-before-observer-failure`.
The fixture's initial segment limit is `0xffffffff`; incrementing it creates
an out-of-range value, correctly refused before identity comparison.

Correction `44087e8f1d19b1f74c6f2742ebca31594f6e7208` changes only that
authored test to decrement the limit within uint32 range and check the retained
before/after values accordingly. It changes no CPU, guard, README or acceptance
rule. Syntax/source review passed. The subsequent [corrected original hosted result](../2026-10-09-task-mode-cpu-success/README.md) passed CPU controls and three finite xv6 regressions; all twelve enabled exact-head checks subsequently passed. New task-mode guest qualification remains a separate gate.
Preserve the original failure, and await every enabled exact-head check and
independent original xv6 audit before connecting the separate guest driver.
The [task-mode contract](../../I80386-DPMI-TASK-EXCURSION-LANE.md) retains the
strict frame refusal and all unqualified application/performance boundaries.
