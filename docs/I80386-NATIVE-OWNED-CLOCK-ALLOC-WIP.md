# Native 386 private clock allocation candidate — WIP

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

This separate fixed-ROM candidate specializes only the private factory-created board's capture-OFF native tick and successful-work methods. It removes their per-word `_call` argument arrays and arrow closures while retaining each original lifecycle guard, active/finally transition, kind check, independent total cap and clock effect. Provider dispatch, `Reflect.apply`, temporary replay arguments, tape preflight, query/mapping guards and every observer remain unchanged. Generic HotDirectBoardFacade and H4 behavior are untouched.

The [qualified main-thread diagnostic](I80386-NATIVE-OWNED-MAIN-WIP.md) is the baseline. Its subsequent wall-time attribution selected this allocation hypothesis; nested timers, per-word instrumentation and shared scheduling do not establish removable CPU shares or predict a gain. This candidate makes one source change rather than combining dispatch and clock-effect shortcuts.

## Source and semantic checks

Candidate runtime source is `5da2a4c513a8c35153fd39fb55f73b386560ea80`: five new files and a 100-file closure, with all 95 qualified baseline inputs unchanged. The native addon remains SHA `144f3af7b906e46bfb68c10b991fef15847d81c60e7bb44820ee73653e723818`, compiled from the separate `7df84bc2c367aff1cadec7cecdde69cf0e904ace` 86-file input map. No recompile or revision relabel occurred. Publication/merged-main source is distinct from the authenticated runtime checkout and has not received this qualification.

All **33 source controls passed**. They compare actual board N/fault/REP Q effects, malformed tape/cap/query/mapping denial, lifecycle/kind/error order, capture event bounds, sink exceptions/reentry, ordinal/effect chronology and finally cleanup. Exact source inverses recover the original provider and scheduler. The 439 historical request/return ledgers and six checkpoint cuts are tested with mocked native responses; that mock is not native state proof. A first source inventory rejected quoted inverse-test import literals as real imports; the source failure is retained, and test-only literal changes fixed inventory before runtime execution.

Actual capture OFF matches every complete native snapshot, all six board checkpoints, settled state, whole RAM and physical transfer counts against the qualified baseline: **439 snapshots, 9,204 transfers, 8,738 commits and 201,366 ordered words**. The host journal is empty. Actual capture ON also matches **all 1,649,067 canonical CPU rows and the 209,839-event ordered journal**, with the exact `bf1224a77fed44aaabe0e2e00cb2319e25084aca71601d215930f3362722f3f1` journal hash. Independent comparison passed **1,894,527 checks** across the two modes.

Capture ON deliberately delegates to the unchanged superclass, so it does not exercise the new fast methods. A third cell uses native trace ON and host journal OFF: the source-bound false flag supplies a literal null sink and selects the new private fast branches while retaining canonical CPU tracing. This third actual cell passed every **1,649,067 canonical CPU row**, every complete native/board snapshot and physical counter, whole RAM and the empty-journal check. Independent audit passed **1,666,954 checks**. Coverage is inferred from authenticated constructor/branch source and actual logical N/Q counters, not an added runtime fast-path counter.

## CPU gate failed — keep qualified main

The predeclared gate compares this candidate against qualified main-thread `bab`, using the same addon in both arms. It has two discarded warmup pairs and seven alternating measured pairs: 18 fresh sequential children. Adoption requires at least 10% lower mean process CPU and every measured pair favorable, with all 439 full snapshots, six whole-board checkpoints and RAM parity in every child. The process-CPU window includes scheduler, callbacks, snapshots, checkpoints and GC; startup, settlement and final serialization are consistently excluded. Tracing, journals, timer attribution and profilers are disabled. The single gate **failed**. Qualified MAIN averaged **379,478 µs** and ALLOC **358,373.714 µs**: a nominal **5.5614% lower mean process CPU**, with only **five of seven** measured pairs favorable. This misses both the ≥10% mean criterion and the all-seven criterion. All 18 children retained complete native/device/physical-counter/RAM parity. Independent result audit passed **319,728 checks** and confirmed the failed gate. The allocation candidate is not adopted and the gate will not be repeated to chase a favorable result.

| Measured pair | MAIN CPU µs | ALLOC CPU µs | ALLOC lower |
|---|---:|---:|:---:|
| 1 | 409,439 | 405,725 | yes |
| 2 | 333,243 | 353,540 | no |
| 3 | 361,558 | 332,063 | yes |
| 4 | 407,187 | 338,664 | yes |
| 5 | 398,465 | 297,849 | yes |
| 6 | 353,397 | 351,957 | yes |
| 7 | 393,057 | 428,818 | no |

This run used Node.js 22.23.3 on a shared Linux/KVM VPS with four vCPUs reported as Intel Xeon Skylake (IBRS, no TSX). Recorded starting load averages were 12.06/10.39/7.96. The environment is retained as measurement context; it does not explain away the failed predeclared criterion. This is not GitHub/Kaggle hardware, a physical 386 or browser/UI measurement.

Qualified main-thread `bab` remains the retained diagnostic baseline. Its historical 26.3289% lower process-CPU gate against H4 is unchanged; these separate comparisons are not multiplied or combined. The next bulk private capture-OFF tape-effects hypothesis needs a new ordered-clock/guard proof before source or runtime admission.

The closed CLI requires a trusted fresh child with authenticated source/build/config/free-ROM inputs, heap 512 MiB, CPU/wall 120 s, files 256 MiB, core 0, nice increment 10 and blank preload/profile environment. Main-thread lexical ownership cannot undo preloaded code or isolate arbitrary injected callers. Native singleton/thread/reentry/fatal guards are unchanged; abort remains whole-child fatal. There is no general board API, browser/GUI backend, native full AT/xv6/broader guest/broader game admission, physical-clock RTx measurement or 10× claim from this fixture.

A concrete broader-guest gap remains in the actual held native bridge: the [inherited bridge source](../scripts/bochs-cpu3-native-direct-board/runtime.inc) and actual prepared runtime both define `bw_host_in` to return failure, so an IN during active owned execution triggers `host-port-in`. The board's OUT contract admits only byte widths and its fixed narrow port list; it is not a general AT device contract. ABI scalar operation 2 is successful quantum, not IN: rejecting scalar N/Q in the provider is intentional because these clocks use the ordered tape. Bochs ISA support alone does not qualify BIOS/AT boot through this bridge.

[Lossless five-file source archive, tests, failures, helper plans and SHA-indexed receipts](receipts/2026-10-02-native-owned-clock-alloc/index.json) preserve the exact evidence. The prior main-thread archive retains the unchanged compiled/build provenance. Large CPU traces, host journals and the native binary remain local and hash-bound.
