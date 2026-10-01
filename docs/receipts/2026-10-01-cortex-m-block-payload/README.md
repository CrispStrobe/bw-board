# Cortex-M block-payload candidate: retained results

Candidate: `08ad74b78f2dfbd353f6b82b038415d9f55cd780` (unmerged core PR 142).
Exact base: `4d944d2d9ec320f7acd25b54cc41a50b850d6788`.
Date: 2026-10-01. Deployed artifact pins remain unchanged.

| Measurement | Baseline | Candidate | Outcome |
| --- | --- | --- | --- |
| Native motion A/B/B/A, Xeon Platinum 8573C | 1.237437× | 1.302110× | +5.23% observed median-of-medians; all ten candidate windows >=1× |
| NODEJS WASM A/B/B/A, EPYC 7763 | 0.680217× | 0.683885× | +0.54% pooled median; all twenty windows <1×; no meaningful gain demonstrated |
| Fresh candidate NODEJS qualification, EPYC 9V74 | — | 0.824684× | All five windows <1×; minimum 0.818189×; functional assertions pass |
| Native CorePerf spin workload | — | 40 targets | All minima and medians >=1×; no reported regressions or waivers |

## Provenance and complete samples

- [Native A/B summary](native-ab/summary.json), [source provenance](native-ab/source-provenance.json), [runner context](native-ab/runner-context.json), and all four five-window JSON receipts are retained in `native-ab/`. [Run 36828554051](https://github.com/CrispStrobe/labwired-core/actions/runs/36828554051). Minimum across the ten candidate windows: 1.284970×. Both sources use the same guest bundle `e6b8c239dc7ee1aca736671350cda8101f4bf8d6c89d91e2a9e787c85b553939`.
- [WASM A/B receipt including complete logs](wasm-ab/abba.json), original BUILD-INFO files and runner context are retained in `wasm-ab/`. [Run 36830478908](https://github.com/CrispStrobe/bw-board/actions/runs/36830478908) compares build-B artifacts from base run 36816537489 and candidate run 36828563070. All four functional invocations pass with zero skips. Explicit paired original glue, no module rewriting or ABI-equivalence claim. Baseline minimum 0.666468×; candidate minimum 0.657408×. Successful diagnostic completion is not RTx qualification.
- [Fresh candidate output](wasm-qualification/motion-results.txt), runner context and BUILD-INFO are retained in `wasm-qualification/`. [Run 36828563070](https://github.com/CrispStrobe/bw-board/actions/runs/36828563070). Two tests executed, functional passed, RTx failed, zero skips; determinism and existing integration passed. Publication skipped.
- [Native CorePerf status](native-coreperf/rtx-status.json), instruction-performance status and raw reports are retained in `native-coreperf/`. [Run 36828556801](https://github.com/CrispStrobe/labwired-core/actions/runs/36828556801). All 40 boards measured, no RTx failures, no instruction-performance regressions, no waivers. These spin fixtures do not establish sensor-heavy, browser or all-firmware performance.
- [Local VPS A/B receipt](vps-ab.json) is secondary diagnostic evidence only. Pooled medians 0.265022× baseline / 0.313433× candidate, but very variable windows, host contention and a concurrent Cortex-M test invocation during the initial baseline make the apparent +18.27% unsuitable as a speedup claim. All twenty windows failed 1×.

The hosted runs are sequential A/B/B/A with eight-million-step warmups and
unchanged motion assertions, not contention-isolated statistical experiments.
The separate EPYC 9V74 candidate run cannot be compared against an EPYC 7763
baseline as evidence of optimization. NODEJS is not browser/UI throughput.

Local validation: 154 Cortex-M tests passed, zero skipped; the 19 discovery tests
are included, not additional. Core PR CI's workspace shards, feature-off,
scheduler-observable, browser-layer and board checks passed. The default-member
gate remains red because seven hardware captures predate this shared CPU change
(nrf52840, seeed-xiao-nrf52840-sense, stm32h563, nucleo-l476rg, nucleo-l073rz,
stm32f103 and stm32f407). No physical capture or updated drift acknowledgement
was produced. Neither this guard nor the unchanged WASM all-five >=1× floor
is waived. Core PR 142 remains a draft; CP13 remains open.
