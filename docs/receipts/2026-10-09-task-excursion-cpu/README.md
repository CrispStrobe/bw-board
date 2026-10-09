# Task-excursion CPU prerequisite: original hosted regression

[Draft PR472](https://github.com/CrispStrobe/bw-board/pull/472), reviewed source
`d1ca2763ce30dc91df0c29e888590ab1d8135256`, passed original
[xv6 run 37900463221](https://github.com/CrispStrobe/bw-board/actions/runs/37900463221).
Executed PR merge `fd4df7c1911cd5d1d06649ad069eac8f3dc11b18` has the same tree.
The [summary](summary.json) binds the original artifact, raw log and audit
attribution. All 12 enabled source checks subsequently passed, with only the two
declared `vectors-full` skips; this is no merge or consumer adoption.

Root and a separate Sol reader independently checked the original ZIP, stored
official authority, raw log and exact Git byte hashes without producer imports
or replay. They verified 71 unique source/ROM roles and three finite scenarios:
4m filesystem roundtrip, 14m boot and 4m forktest. All 94 focused test names
passed: 65 journal, five boundary, 13 policy and 11 orchestration controls.
The current cohort reports 1,669 tests, 1,658 passing, zero failing and 11 skips;
the historical cohort reports 288/288 passing.

These synthetic controls exercise the private task observer's admission,
committed-step accounting, fault preservation, accessor/reentry refusal,
stale candidate and step bounds. The finite guest regression uses the existing
xv6 PSE/APIC compatibility profile. Neither establishes strict physical 386DX
behavior, an observed guest task excursion, original-task resumption or an
owned INT 31h frame return. The derivative PR474 adds the candidate-reset control and narrow diagnostic
abort controls; its [separate original result](../2026-10-09-task-excursion-at/README.md)
records a protected-only observer boundary.

The next slice is the [separate derivative driver and admission/workflow](../../I80386-DPMI-TASK-EXCURSION-LANE.md).
It must continue the same admitted machine after preserving the original
strict frame refusal, under the private observer's bound. Qualify its new source
and independently audit one original diagnostic before proposing broader
ownership acceptance. No new profiler, performance or RTx result follows here.
