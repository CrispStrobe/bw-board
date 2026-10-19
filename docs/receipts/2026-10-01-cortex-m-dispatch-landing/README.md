# Cortex-M opcode dispatch: final-head qualification and landing

Date: 2026-10-01. [Core PR 143](https://github.com/CrispStrobe/labwired-core/pull/143)
merged into `main` as `4deee6f04266a73d0d2696cacfb2eac0b29aed84`.
Final tested head: `0813b140a29bb1f232f723059d9b4dd0ee949514`.
Exact A/B base: `4d944d2d9ec320f7acd25b54cc41a50b850d6788`.

The final head adds only review metadata and documentation to the measured
CPU revision `13ace46fe9ea26ae489a07bae57d67aac95fe166`: CPU implementation
and tests are byte-identical. This does not include unmerged payload-copy PR 142.
[Earlier native/WASM measurements](../2026-10-01-cortex-m-dispatch/README.md)
remain labelled with their actual sources; they were not rerun or relabelled
as final-head WASM qualification.

## Explicit, expiring hardware review

The user approved temporary acknowledgements for nrf52840,
seeed-xiao-nrf52840-sense, stm32h563, nucleo-l476rg, nucleo-l073rz, stm32f103
and stm32f407. These are exact-content-bound and expire **2026-10-31**.
Changed model content invalidates their digests; the normal 30-day policy is
unchanged. The two nRF entries share one physical reference, not independent
hardware evidence. Physical capture dates, results and silicon model digests
are unchanged. **Acknowledgement is not capture; hardware re-capture is owed.**

[Core review and obligations](https://github.com/CrispStrobe/labwired-core/blob/4deee6f04266a73d0d2696cacfb2eac0b29aed84/docs/performance/2026-10-01-cortex-m-dispatch-drift-review.md)
records the decision and its limitations. The drift gate and all 27 local policy
tests passed. This is no blanket hardware waiver or widened expiry policy.

## Final-head CI and native measurements

- [Rust CI](https://github.com/CrispStrobe/labwired-core/actions/runs/36843571898)
  passed: default members, drift/generated-artifact gate, all three workspace
  shards and their hosted aggregate, feature-off, scheduler-observable,
  browser/WASM build, Xtensa boot, formatting and release-runner contract.
  [Raw shard reports](workspace/) retain 398 targets, 7,117 passed tests,
  zero failures and 77 existing ignores. Fourteen library pseudo-targets have
  no unit tests; three release-only targets are empty by construction in debug.
  Cross-build suites are outside these PR shards. This is not a zero-skip claim
  or a claim that push-only release lanes ran on the PR.
  [Local aggregate stdout](workspace/local-aggregate.txt) was computed using
  the unchanged final-head script over the downloaded hosted reports while
  GitHub's aggregate waited for a runner; the hosted aggregate later passed.
- [Final-head native A/B/B/A](https://github.com/CrispStrobe/labwired-core/actions/runs/36843572304)
  compared the exact base on one EPYC 9V74 runner, Rust 1.95 and ARM GCC 13.2.
  Median-of-medians: **1.4105205321× baseline / 1.6184818665× candidate**,
  ratio **1.1474358789** (+14.74%). All ten candidate windows passed 1×;
  minimum **1.5964404640×**. [Summary](native-ab/summary.json),
  [runner context](native-ab/runner-context.json), provenance and all four raw
  JSON/log pairs are retained. The MIT guest source bundle is unchanged:
  `e6b8c239dc7ee1aca736671350cda8101f4bf8d6c89d91e2a9e787c85b553939`.
  Sequential same-runner measurements do not isolate host contention and are
  not evidence of statistical significance, full-firmware or browser speed.
- [Final-head board qualification](https://github.com/CrispStrobe/labwired-core/actions/runs/36843565953)
  passed. All 156 Cortex-M tests passed, zero failed/ignored, including the
  dispatch regressions. Native WASM analog-routing tests: three passed,
  zero failed/ignored. Whole-board suites retain two physical-only ignores.
  [Motion](native-board/microbit-motion-throughput.json): **1.5116095163× median**,
  **1.5072491540× minimum**, all five windows passed.
  [GPIO active workload](native-board/microbit-active-throughput.json):
  **6.5814137099× median**. Raw logs and runner context are retained.
- [Final-head native CorePerf](https://github.com/CrispStrobe/labwired-core/actions/runs/36843569099)
  passed. All **40 spin targets** met median/minimum 1×; lowest sampled minimum
  **10.6539662298×**. [RTx status](native-coreperf/rtx-status.json) and raw report
  are retained. [Instruction-cost status](native-coreperf/perf-status.json)
  reports zero regressions, contract failures, unmeasurable/never-measured
  targets or waivers. It flags one stale *faster* nRF51822 step baseline;
  no baseline was rewritten. Spin results do not qualify realistic firmware
  or WASM across all supported chips.
- Final-head [Python SDK](https://github.com/CrispStrobe/labwired-core/actions/runs/36843571990),
  [Renode comparison](https://github.com/CrispStrobe/labwired-core/actions/runs/36843571989)
  and [workflow lint](https://github.com/CrispStrobe/labwired-core/actions/runs/36843571957)
  passed. The automatic A/B also passed, but its older default comparison base
  is not used for the exact-base gain above.

All 23 hosted raw receipt files here were compared byte-for-byte against their
downloaded originals; local aggregate stdout is explicitly labelled separately.
These are pre-merge final-head receipts, not receipts of push-only main jobs.

## Still not qualified for deployment

Earlier hosted NODEJS WASM A/B runs observed +6.60% and +7.38% pooled median
gains, but **all forty windows stayed below 1×**; one repeat's candidate minimum
was worse than baseline. Fresh qualification failed its realtime floor despite
passing functionality, deterministic builds and existing integration. There is
no final-head WASM realtime-pass claim, artifact publication or pin promotion.
Deployed pins are unchanged. CP13 stays open until all five motion windows meet
1× and browser/worker/debugger acceptance passes. Physical re-capture remains
owed before the acknowledgement deadline.
