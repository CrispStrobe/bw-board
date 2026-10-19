# Warmed GPIO window profiles: actual captures, not optimization qualification

The unchanged production engine `43b2d62f5a0fa24ae0b38a645069f5aaa78af685` comes from deterministic [build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413). Its original NODEJS WASM SHA-256 is `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`, and original glue SHA-256 is `b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73`. Every hosted child checks those original bytes and the source-bound manifest. No engine was rebuilt or optimized for this diagnostic.

[Tools PR #290](https://github.com/CrispStrobe/bw-board/pull/290) adds a **separate** GPIO diagnostic harness, leaving ordinary GPIO timing, F0 acceptance and the frozen `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162` A/B branch unchanged. Each diagnostic child compiles/initializes the same actual guest and runs the existing six-million-cycle warm-up before Inspector sampling. Five separate profiles each cover one 48-million-cycle GPIO window, including JS progress checks and small profiler-boundary overhead. Sampling stops before RAM/GPIO observations and logging. Board input changes, guest compilation, initialization, functional tests and warm-up are outside sampling. Profiler activation does **not** prove JIT tiering has finished; no tier was forced. Raw time deltas are retained and parsed strictly, never clamped.

The [initial four captures](https://github.com/CrispStrobe/bw-board/actions/runs/37111247979) used tool `68a70a71cfc71ea434eb38765e90ae6e8b47ca94`. The [four corrected-registration captures](https://github.com/CrispStrobe/bw-board/actions/runs/37112129837) used `1d7023e9813d8a574301b42e0447a02e383032e0`. There are **eight captures, 40 raw window profiles, and 80 ordinary/profiled timing windows**. Each set repeats twice on Node20.20.2 and twice on Node22.23.3; different captures use different hosted CPUs. Original loaded images and cycle-indexed guest observations match both within and across captures. That establishes the measured guest semantics, not all supported chips, calibrated silicon CPI, browser/UI/debugger performance or physical qualification.

## Every timing result (sampled timing is not ordinary qualification)

| Dataset | Runtime/repeat | Ordinary median / min RTx | Ordinary 1x floor | Profiled median / min RTx | Profiled 1x floor | WASM sampled self share |
| --- | --- | --- | --- | --- | --- | --- |
| initial | 20.20.2 #1 | 0.705178 / 0.701427 | FAIL | 0.696685 / 0.688026 | FAIL | 99.04% |
| initial | 20.20.2 #2 | 0.941378 / 0.937807 | FAIL | 0.929058 / 0.886035 | FAIL | 98.90% |
| initial | 22.23.3 #1 | 1.300640 / 1.205248 | pass | 1.312122 / 1.295687 | pass | 98.24% |
| initial | 22.23.3 #2 | 0.630576 / 0.619043 | FAIL | 0.574336 / 0.564052 | FAIL | 98.90% |
| corrected | 20.20.2 #1 | 0.518398 / 0.503685 | FAIL | 0.520897 / 0.511672 | FAIL | 99.37% |
| corrected | 20.20.2 #2 | 0.826265 / 0.805579 | FAIL | 0.806189 / 0.802535 | FAIL | 98.94% |
| corrected | 22.23.3 #1 | 0.782290 / 0.739185 | FAIL | 0.765180 / 0.751259 | FAIL | 98.79% |
| corrected | 22.23.3 #2 | 0.609123 / 0.599392 | FAIL | 0.599948 / 0.581368 | FAIL | 98.86% |

Ordinary GPIO passes the unchanged all-window ≥1× floor in only one of eight captures. The other seven failures are not waived by a median or a successful diagnostic workflow. Ordinary and profiled children are separate processes, **not an optimization A/B**; a sampled run can even appear faster because of process/tiering/host variation. Never treat their timing ratio or differences across Node versions as a speedup, measured profiler overhead, statistical significance, or Node-version causality.

## Window-only sampled attribution

Shares below are self-time summed across each capture's five profiles and divided by that capture's **whole sampled-window time**, not just WASM time. Every raw sample is included; this is not an unweighted average of profile percentages. Caller/inclusive shares are not added to self shares. Most samples are WASM, but that is not a complete cost model or removable-cost percentage.

| Capture | CPU batch dispatch | Cached T16 run | Cold GPIO servicing | Empty-slice callee label |
| --- | --- | --- | --- | --- |
| initial 20.20.2 #1 | 31.74% | 18.70% | 6.91% | 3.65% |
| initial 20.20.2 #2 | 27.59% | 21.12% | 5.70% | 4.04% |
| initial 22.23.3 #1 | 25.37% | 21.55% | 8.85% | 3.26% |
| initial 22.23.3 #2 | 22.30% | 20.13% | 13.47% | 5.18% |
| corrected 20.20.2 #1 | 31.75% | 17.14% | 10.72% | 3.65% |
| corrected 20.20.2 #2 | 27.22% | 20.16% | 6.21% | 3.68% |
| corrected 22.23.3 #1 | 22.86% | 16.39% | 15.36% | 5.45% |
| corrected 22.23.3 #2 | 23.05% | 17.65% | 14.48% | 5.44% |

The recurring leads are batch dispatch (22.30–31.75%), cached runs (16.39–21.55%), and cold GPIO servicing (5.70–15.36%). These narrower profiles supersede whole-process attribution **for these warmed GPIO windows only**; earlier full-process profiles included compilation, initialization, functional tests and warm-up. Sampling still cannot predict an optimization's speedup.

### Avoid a misleading metadata interpretation

The `DeclarativeLogicDevice::input_channels` label receives 3.26–5.45% sampled self-time, but exact production source returns **`NO_CHANNELS`, an empty borrowed slice**: that implementation performs no metadata allocation or scan. The raw sampled parent nodes place this label beneath `service_edge_driven_gpio_devices_cold` or its `maybe_service` caller. The corresponding source queries `edge_service_addrs`, not input-channel discovery. Shared trivial method bodies/compiler naming are a **plausible inference**, not a proven WASM-vtable resolution; name attribution alone must not motivate a metadata-cache rewrite. `core-inspection.json` binds the exact production source excerpts/hashes, and `caller-attribution.json` is independently reproducible from original parent-node trees.

Next inspect live edge-service admission/dispatch and cached-run/batch boundaries, while preserving dynamic routing, IRQ/event/cycle ordering, reset behavior and observers. Do not revive the rejected call-site/outlined gates merely because a profile names them, or memoize mutable device eligibility. Any engine change still needs isolated source correctness, actual-WASM tests and all four ordinary frozen Node/order comparisons. No engine source, publication, app pin or physical drift acknowledgement/capture/expiry changed; hardware re-capture remains owed and CP13/all-target ≥1× stays open.

## Initial census failure and correction

The initial tool head passed all four actual capture jobs but its [push CI](https://github.com/CrispStrobe/bw-board/actions/runs/37111247913) and [PR CI](https://github.com/CrispStrobe/bw-board/actions/runs/37111250672) each failed one full-suite test: the new artifact-dependent harness was missing from the oracle census. The merge guard stopped without attempting a merge. The correction touches only `scripts/oracle-census.mjs` and a scope test, explicitly registering both the WASM dependency and opt-in capture-output activation. No ratchet/debt-list exemption, engine change, diagnostic implementation, ordinary harness, or sampling policy changed. **39 focused portable tests** passed locally after correction. Complete original failed-step logs are retained losslessly as gzip/base64 JSON, not relabelled as capture failures. Tool landing records all 14 enabled checks (ten general plus four actual captures), with only two intentional full-vector skips.

## Evidence and resource limits

The manifest binds both complete capture datasets, every original/reversibly wrapped profile and stdout/stderr, full hosted capture-job logs, original build/qualification proofs, source contracts, the lossless failed-step logs and registration-only correction, exact core inspection, caller proof, controller source, and head-bound tool landing. Portable archive tests reparse all profiles and timing windows, check hashes/source/runtime/order/provenance, reproduce weighted self-time and caller relationships, and preserve all actual floor verdicts.

At 08:45 UTC the four-CPU VPS had load1.49/1.43/1.96 and 4,541MiB available memory, but only about1.4GiB workspace free. All actual guest execution/profiling used hosted runners. Only small source edits, metadata, small receipt downloads (initial ZIPs about34–47KiB each) and portable checks ran locally. No local engine download, build, benchmark, profiling, agents or cleanup ran.
