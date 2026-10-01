# WASM cached scalar execution: unpromoted candidate

Exact baseline `4deee6f04266a73d0d2696cacfb2eac0b29aed84`; candidate
`273e683e6f4e76e234409a9d80c8a54e58fdc291` in [core PR 145](https://github.com/CrispStrobe/labwired-core/pull/145).
This does not stack the rejected outlining change. When existing fast paths
decline, WASM can execute one tagged cached T16 instruction through the existing
checked ALU/branch/RAM executor. MMIO, unsupported, cold, collided and T32
entries fall back to the interpreter. Existing debugger/observer/IRQ/IT and
scheduler-budget guards remain. Native production dispatch is unchanged.

## Ordinary hosted timing

| Exact-artifact A/B/B/A | Baseline median / min | Candidate median / min | Median change |
| --- | --- | --- | --- |
| [Primary 36869551919](https://github.com/CrispStrobe/bw-board/actions/runs/36869551919) | 0.864763 / 0.703572 | 0.924740 / 0.894346 | +6.94% |
| [Independent repeat 36870103563](https://github.com/CrispStrobe/bw-board/actions/runs/36870103563) | 1.086451 / 1.067113 | 1.099840 / 1.041099 | +1.23% |
| [Second repeat 36871226338](https://github.com/CrispStrobe/bw-board/actions/runs/36871226338) | 0.885407 / 0.874517 | 0.928345 / 0.921827 | +4.85% |

All twenty primary-run windows failed 1×. Both artifacts used identical
original glue on one EPYC 9V74 host within this comparison. Every cycle-indexed
guest observation matched across all four runs. Full ELF hashes are provenance,
not equality: unchanged GCC compilation embeds random temporary object names
in non-loaded symbol metadata. Matching observations are not full-state proof.
[Raw process outputs and all twenty samples](primary-abba.json),
[runner](primary-runner.txt), [baseline build](baseline-build-info.json),
[candidate build](candidate-build-info.json) are retained unchanged.

All twenty repeat windows passed 1× on its host, but the candidate minimum was
worse than baseline: a median gain is not an every-window improvement. All
cycle-indexed observations matched. [Raw repeat receipt](repeat-abba.json) and
[runner metadata](repeat-runner.txt) are retained. Do not compare absolute
speeds across hosts or use this passing repeat to override failed fresh
qualification. [Third-run raw receipt](repeat2-abba.json) and [runner](repeat2-runner.txt)
show another positive median (+4.85%) with identical cycle-indexed observations,
but all twenty windows below 1×. Across the three ordinary comparisons,
forty windows failed and twenty passed; no universal 1× or every-window gain.

## Separate fresh qualification

[Build run 36867515370](https://github.com/CrispStrobe/bw-board/actions/runs/36867515370)
passed both build legs, byte determinism and **101 existing integration tests,
zero failed/skipped**. Motion functionality passed but every timed window failed
the unchanged 1× floor: **0.768439× median / 0.752785× minimum**, EPYC 7763.
This separate host is not a paired speedup measurement. Publication was skipped.
[Raw motion output](qualification-stdout.txt), [runner](qualification-runner.txt),
[declared build provenance](qualification-build-info.json) are retained.

The exact final core head `faa39978923f96abe65706407f04d4af63e33857`
(approved acknowledgement/documentation changes only) was rebuilt in
[run 36872103827](https://github.com/CrispStrobe/bw-board/actions/runs/36872103827).
Both builds, determinism and all 101 actual WASM integration tests passed,
zero skipped. Its module SHA256 is byte-identical to the measured candidate:
`9f0720afcbae2074e7a372bf332bdacd00d258fffa4bfb8b72caaace346d0258`.
This fresh qualification again failed every window: **0.704710× median /
0.690863× minimum** on EPYC 7763. The lower wall rate with identical runtime
bytes is another host observation, not evidence of a code regression.
Publication remained skipped. [Raw final-head output](final-qualification-stdout.txt),
[runner](final-qualification-runner.txt), [build provenance](final-qualification-build-info.json)
are retained. Passing paired runs cannot override this failure.

The core feature-off suite passed the new primitive tests, including all 65,536
halfwords under each of three flag states against the interpreter, comparing
architectural snapshots, RAM and bus access counts. Decline cases verify no
side effects for zero budget, sleep/WFE, cold/tag collision, T32, MMIO and
unmapped addresses. The tested primitive is compiled on hosts for unit tests;
the production selector remains WASM-only. Native board, browser-layer and
scheduler-observable and all three workspace shards passed. The original
default-member gate failed on seven uncovered content-bound hardware drift
acknowledgements. After verification, the user explicitly approved updating
only those seven digests; dates/expiry remain 2026-10-01 / 2026-10-31 and all
physical capture dates/results/digests remain unchanged. Live re-capture remains
owed; final-head checks are required before core merge. This is not a floor waiver.

Final-head `faa39978` subsequently passed **all 19 enabled checks**, including
the aggregate gate, default members, all three workspace shards, browser,
scheduler-observable, native board and motion comparisons. Core PR 145 landed
on `main` as **`c05e8de37f8837148c3066c5e5f1d715a6dbd0f8`**. The merge tree
matches the verified final-head tree. Failed manual WASM realtime qualification
is not one of those passing checks and has not been waived or reclassified.

## Profiling and next experiments

[Selected profile fields and hashes](profile-extract.json) come from the primary
run, **after** its ordinary A/B. Complete traces and raw CPU profiles remain in
its uploaded artifact and local evidence; this extract is not the full raw set.
The corrected compiler modes validated only Liftoff (2,465 / 2,466 records) or
only TurboFan, respectively. Forced/profiled timings are never qualification.

Default traces show both `step_batch` and the 5,118-byte scalar helper reach
TurboFan. Whole-process candidate self shares were roughly 36.3% in
`step_batch`, 10.8% in general fast-block admission/execution, 8.7% in cached
scalar execution, 7.5% in bus reads, 4.1% in MMIO activity bookkeeping and 3.2%
in peripheral routing. Initialization/warmup are included; these are attribution
targets, not automatically removable costs or steady-window-only fractions.

Priorities for further measured, individually isolated experiments:

1. Extend the verified scalar executor to short scheduler-bounded cached T16
   runs, comparing each retirement and all budgets to the interpreter. Preserve
   debugger/observer/IRQ/IT guards and immediate fallback at MMIO/unsupported
   instructions. This targets repeated outer dispatch, not just instruction work.
2. Measure failed-block discovery and negative-cache collisions before changing
   admission policy or cache capacity. Do not discard eligible loops.
3. Test WASM-only register-helper inlining; preserve register-15/PC+4 semantics
   and reject code-size/throughput regressions.
4. Profile MMIO dispatch/bookkeeping with strict read-to-clear, IRQ reconciliation,
   observer and device-clock differential coverage. Never cache MMIO values.
5. Repeat improvements on browser V8 and another WASM engine, then other real
   target firmware workloads; this selected micro:bit proof is not a universal
   chip-speed result.

Only the intermediate core optimization is merged. No app pin promotion or
completion of CP13 is claimed; fresh WASM realtime qualification remains failed.
