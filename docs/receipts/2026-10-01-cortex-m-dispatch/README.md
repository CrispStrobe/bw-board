# Opcode-directed Cortex-M dispatch: candidate measurements

Date: 2026-10-01. Exact candidate `13ace46fe9ea26ae489a07bae57d67aac95fe166`:
[core PR 143](https://github.com/CrispStrobe/labwired-core/pull/143), unmerged.
Exact base `4d944d2d9ec320f7acd25b54cc41a50b850d6788`.
This does not stack PR 142's block-payload-copy change.

| Evidence | Baseline median | Candidate median | Candidate minimum | Outcome |
| --- | --- | --- | --- | --- |
| Native exact-base A/B/B/A, Xeon Platinum 8370C | 1.326734× | 1.499638× | 1.466138× | +13.03% median-of-medians; all ten candidate windows >=1× |
| Hosted NODEJS WASM A/B/B/A, EPYC 9V74 | 0.834062× | 0.889071× | 0.877776× | +6.60% pooled median; all twenty windows <1× |
| Independent hosted repeat, EPYC 9V74 | 0.640315× | 0.687602× | 0.630257× | +7.38% pooled median; all twenty windows <1× |
| Fresh NODEJS qualification, EPYC 7763 | — | 0.738987× | 0.716393× | All five windows <1×; functional assertions passed |
| Shared VPS A/B/B/A, Skylake | 0.381470× | 0.405278× | 0.369730× | +6.24% pooled median; all twenty windows <1×; diagnostic only |
| Native CorePerf spin fixtures | — | 40 targets passed | 10.819886× across all targets | No reported instruction regressions or waivers; not realistic all-chip WASM workloads |

The repeat's baseline minimum was 0.637347×: its candidate minimum is worse,
despite its higher median. No all-window speedup, statistical significance,
contention isolation or cross-run absolute-speed comparison is claimed. Each
hosted comparison used both original engines on the same runner; each retained
four functional invocations and all twenty windows, including failures.
All eight hosted functional invocations passed with zero skipped tests.

## Raw receipts and provenance

- [Native summary](native-ab/summary.json), all four JSON receipts/logs, original runner context and [source provenance](native-ab/source-provenance.json). [Run 36835539860](https://github.com/CrispStrobe/labwired-core/actions/runs/36835539860). Same ARM GCC and Rust toolchains, eight-million-step warmup, unchanged guest bundle `e6b8c239dc7ee1aca736671350cda8101f4bf8d6c89d91e2a9e787c85b553939`.
- [Hosted WASM receipt](wasm-ab/abba.json), original BUILD-INFO files and runner context. [Run 36836511572](https://github.com/CrispStrobe/bw-board/actions/runs/36836511572). Node 22.23.2, EPYC 9V74; pooled median of ten samples per engine, not median-of-medians.
- [Hosted repeat receipt](wasm-ab-repeat/abba.json), original BUILD-INFO files and runner context. [Run 36837055740](https://github.com/CrispStrobe/bw-board/actions/runs/36837055740). A separate runner/host condition, same CPU model and exact artifacts; no artifact changes between repeats.
- [Fresh qualification output](wasm-qualification/motion-results.txt), runner context and BUILD-INFO. [Run 36835546181](https://github.com/CrispStrobe/bw-board/actions/runs/36835546181). Both builds, determinism and existing integration passed; motion functional passed, RTx failed, two tests executed, zero skipped; publication skipped.
- [VPS diagnostic](motion-abba-vps.json): each original paired module, four functional passes, all twenty RTx failures. No overlapping test invocation was launched by this agent during this probe, but the shared VPS was not isolated from other users/processes.
- [Actual Lite WEB input-test output](lite-input-results.txt): four passed, zero skipped, Node 20.20.2; unchanged clean Lite worktree `d0dd61a5abfaf027273fabf27eb464eacd387354`. Test file SHA256 `2a57841041e20f731b440fef2c0356562b008c7095232352717c0abbd8622de4`. This is the input-route proof, not full debugger acceptance or browser performance.
- [Native CorePerf status](native-coreperf/rtx-status.json), instruction-performance status and original reports. [Run 36835542979](https://github.com/CrispStrobe/labwired-core/actions/runs/36835542979), standalone candidate SHA. All forty targets measured; all minima and medians >=1×; no instruction-performance regressions, unmeasurable targets or waivers. Lowest observed minimum across targets: 10.819886×. These are spin fixtures, not all-firmware or browser qualification.
- [Existing STM32F0 microbenchmark](f0-vps-diagnostic.json): original `scripts/bench-chips.mjs`, unchanged ALU/RAM guest, same A/B/B/A ordering. Printed rates baseline 25.7× / 27.7×, candidate 6.14× / 25.1×. The 50,000-step warmup and 8,000,000-step measurement produce short, rounded, highly variable timings; no gain claim or full-firmware qualification. The receipt binds commands, harness SHA and host, and retains every printed result. Motion's longer unchanged gate remains the primary workload evidence.

Both hosted comparisons downloaded base build-B run 36816537489 and candidate
build-B run 36835546181, checked exact source references and original glue/WASM
hashes, and explicitly selected each build's paired original glue. No module
rewriting or JS/ABI equivalence claim. Candidate WASM SHA256:
`268406711426f8d0b5ee4fd778f173bcd8ce05cb980528bc0c089c81c9dde269`.
Original NODEJS glue SHA256:
`44e9e34c6cb43f14b3037523bda1174c8c52560c485f31e7f043f0b1e4d89813`.
Original WEB glue SHA256:
`73a596fd0a623c8812b781b490a7af60d74b3d9b7b765273dfbc8e8dce9d6887`.
The local NODEJS package marker only selects CommonJS loading; glue and WASM
bytes are unchanged. NodeJS measurements are not browser/UI/circuit throughput.

## Correctness and outstanding qualification

Feature-off CI [36835509065](https://github.com/CrispStrobe/labwired-core/actions/runs/36835509065)
passed its unit suite: 4,056 passed, zero failed, three existing ignored tests.
All three new dispatch regressions passed; no zero-skip whole-suite claim.
Scheduler-observable CI passed separately. Local formatting/diff checks and the
17 Python measurement-harness tests passed; the latter are not CPU execution
evidence. Native board/model qualification subsequently passed in
[run 36835509055](https://github.com/CrispStrobe/labwired-core/actions/runs/36835509055),
including **156 Cortex-M tests, zero failures/ignored tests**. The entire board
job is not zero-skip: physical-hardware integration tests remain ignored.
This automatic PR job ran synthetic merge `7653fc0dfedfa061827c0c8162f36975df79fa23`,
not the standalone candidate SHA. Both commits have identical Git trees:
`8b6db273eeee8e7fa11eeab6315f3640eaa7809f` (verified locally with the fetched
PR merge ref). Its receipts keep the actual merge SHA and are not relabelled.
On EPYC 7763, native motion passed at 1.245130× median / 1.201380× minimum;
GPIO-only passed at 4.994839× median. These separate qualification observations
are not the exact-base A/B improvement estimate.
[Native board receipts and runner context](native-board/microbit-motion-throughput.json)
and [unit/result log excerpt](native-board-log-excerpt.txt) are retained; the
excerpt is selected from the official job log, not a full log or a new test run.
The [feature-off excerpt](feature-off-log-excerpt.txt) similarly selects dispatch
test names and result lines. Native CorePerf passed all forty targets without
regressions/waivers; all three workspace shards and their aggregator subsequently
passed. Browser-layer, scheduler-observable, feature-off, board, Python SDK,
Renode comparison and release-runner checks also passed. The remaining red
default-member/pr-gate results are the seven-board silicon drift described below.

Seven shared-Cortex board captures predate the changed CPU content; the
default-member gate is red: nrf52840, seeed-xiao-nrf52840-sense, stm32h563,
nucleo-l476rg, nucleo-l073rz, stm32f103 and stm32f407. No physical capture date,
model-capture digest or drift acknowledgement was changed. A decision about an
explicit expiring acknowledgement versus physical re-capture remains separate
from the performance results. No floor waiver, engine merge, publication or
deployed pin change; CP13 remains open. All-five >=1× NODEJS qualification and
browser/worker/debugger acceptance are still required for artifact promotion.

## Subsequent landing update

The status above records the pre-acknowledgement measurement revision, not the
later landing decision. Core PR 143 subsequently merged as `4deee6f0` after
final-head CI passed. Seven user-approved, content-bound acknowledgements expire
2026-10-31; physical capture dates/results/digests remain unchanged and re-capture
is still owed. [Final-head qualification, native A/B and landing receipts](../2026-10-01-cortex-m-dispatch-landing/README.md)
are retained separately. Earlier raw measurements are unchanged. No WASM floor
waiver, artifact publication or deployed pin change; CP13 remains open.
