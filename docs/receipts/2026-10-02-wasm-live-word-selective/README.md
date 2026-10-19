# Selective live-word placement: repeated results, still unqualified

Moving the live bounds query into the already RAM-eligible selector does not
qualify the optimization. The completed same-runner comparisons retain every
gain, loss and floor below. Source remains **unmerged/unqualified**: core main,
app pins, published artifacts and all seven physical drift acknowledgements are
unchanged. Their 2026-10-31 expiry and physical capture results remain unchanged;
hardware re-capture is still owed. CP13 and the all-target ≥1× goal remain open.

## Isolated source and verification

Baseline is actual core main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, original
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
Candidate is `90ff69aa8b78e91667d1d5067a39dc0b37bc8115`, original
[build 37027849668](https://github.com/CrispStrobe/bw-board/actions/runs/37027849668).
It derives from the first word-admission experiment, moving the identical live
query inside the existing RAM-eligible selector. Unrelated entry opcodes avoid
the extra query. No rejected literal/register/optimizer changes are stacked.
Native production dispatch, existing debugger/observer/IRQ/IT/scheduler guards,
ordinary MMIO/fault handling and dynamic RAM bounds remain unchanged. No live
address rejection is cached.

[Source tests 37026594366](https://github.com/CrispStrobe/labwired-core/actions/runs/37026594366)
pass the existing T16 differential tests and exhaustive prior-selector exclusion
proof. Both builds pass independent byte determinism and **101 actual-WASM
integration tests**. Both separate fresh motion floors fail; the candidate is
**0.802092× median /
0.782105× minimum**. Overall build
workflow failures and skipped publishing are retained, not relabelled.

All paired runs use frozen unchanged tooling `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, pinned ordinary
Node runtimes, original modules and each build's original glue. No profiling,
forced tiers, census or extra optimizer recipe enters acceptance timing. Builder
code is unchanged from baseline tooling; each runner verifies actual module/glue
bytes before timing. Original node hashes:

| Artifact | WASM SHA-256 | Glue SHA-256 |
| --- | --- | --- |
| baseline | `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d` | `b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73` |
| candidate | `ad1704cbb2438baeb92536ed963b5353ccc86688032b921619c6415e101cac4b` | `339deaca58b4c5a5319f95168b8356a9d0b495905383d1d2166e527c8f2cb3cd` |

## Every runtime/order result

Values are median / minimum RTx; Δ is candidate median / baseline median − 1.
Every row aggregates two five-window runs per artifact on the **same runner**.
Different rows use different CPUs; they do not establish a Node-version effect
or a selective-versus-parent speedup. No confidence interval or statistical
significance is claimed. Floor remains **every measured window ≥1×**.

| Runtime/order | Guest | Baseline | Candidate | Median Δ | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| Node 20.20.2 ABBA | motion | 1.350704 / 1.320824 | 1.324489 / 1.240466 | -1.94% | pass / pass |
| Node 20.20.2 ABBA | RAM | 7.067531 / 6.757214 | 6.866164 / 6.396367 | -2.85% | pass / pass |
| Node 20.20.2 ABBA | GPIO | 1.213931 / 1.144104 | 1.234175 / 1.078001 | +1.67% | pass / pass |
| Node 20.20.2 BAAB | motion | 0.523832 / 0.481394 | 0.634530 / 0.619105 | +21.13% | fail / fail |
| Node 20.20.2 BAAB | RAM | 2.838300 / 2.818159 | 2.808749 / 2.723491 | -1.04% | pass / pass |
| Node 20.20.2 BAAB | GPIO | 0.548013 / 0.541333 | 0.596803 / 0.566966 | +8.90% | fail / fail |
| Node 22.23.3 ABBA | motion | 1.557323 / 1.471237 | 1.513201 / 1.449274 | -2.83% | pass / pass |
| Node 22.23.3 ABBA | RAM | 5.232614 / 4.614948 | 5.254149 / 5.183268 | +0.41% | pass / pass |
| Node 22.23.3 ABBA | GPIO | 1.285640 / 1.189371 | 1.353443 / 1.301959 | +5.27% | pass / pass |
| Node 22.23.3 BAAB | motion | 0.771100 / 0.757864 | 0.759900 / 0.743684 | -1.45% | fail / fail |
| Node 22.23.3 BAAB | RAM | 3.020797 / 2.709227 | 2.968032 / 2.861809 | -1.75% | pass / pass |
| Node 22.23.3 BAAB | GPIO | 0.604741 / 0.599909 | 0.642516 / 0.630824 | +6.25% | fail / fail |

### Actual runner provenance

| Runtime/order | CPU model | Hosted run |
| --- | --- | --- |
| Node 20.20.2 ABBA | AMD EPYC 9V45 96-Core Processor | [37034463859](https://github.com/CrispStrobe/bw-board/actions/runs/37034463859) |
| Node 20.20.2 BAAB | AMD EPYC 7763 64-Core Processor | [37036358011](https://github.com/CrispStrobe/bw-board/actions/runs/37036358011) |
| Node 22.23.3 ABBA | Intel(R) Xeon(R) 6973P-C | [37038691251](https://github.com/CrispStrobe/bw-board/actions/runs/37038691251) |
| Node 22.23.3 BAAB | AMD EPYC 9V74 80-Core Processor | [37040078213](https://github.com/CrispStrobe/bw-board/actions/runs/37040078213) |

### Minimum regressions retained

- Node 20.20.2 ABBA motion: 1.320824× → 1.240466×.
- Node 20.20.2 ABBA RAM: 6.757214× → 6.396367×.
- Node 20.20.2 ABBA GPIO: 1.144104× → 1.078001×.
- Node 20.20.2 BAAB RAM: 2.818159× → 2.723491×.
- Node 22.23.3 ABBA motion: 1.471237× → 1.449274×.
- Node 22.23.3 BAAB motion: 0.757864× → 0.743684×.

These are selected active F0 RAM/GPIO and micro:bit motion guests at nominal
48/64 MHz, scaling engine-reported cycles. They do not qualify silicon-calibrated
CPI, all boards, browser/UI/debugger/circuit solving or physical behavior.

## Focused actual-WASM dispatcher proof

[Regression 37037845280](https://github.com/CrispStrobe/bw-board/actions/runs/37037845280)
passes **seven tests on each original engine**, with zero failures/skips/cancelled
or todo cases. The same guest STR/LDR PCs switch RAM→actual GPIO ODR→RAM, then
unaligned RAM and the last fully backed word. Guest-owned descriptors change
through actual PA1 inputs, without host writes, resets, breakpoints or debugger
single-step that would clear caches or bypass fast dispatch. Batch budgets are
1, 7, 8, 16, 31, 64 and 257; both engines retain identical guest image hash,
readback/phase receipts, concrete RAM/GPIO effects, safe interval and loop count.
This proves deployed semantics, **not fast-path hit counts or RTx**; faulting
boundary crossings and arbitrary IRQ interleavings are outside this proof.
Future WASM builds include these cases and require the expanded 108-test suite.

## Evidence and next steps

`manifest.json` binds **122** original/reversibly wrapped
files, including exact source/build/run/artifact identities, configurable
controller source and `config.json`, native/build/integration/floor logs,
all **32 ordinary children / 240 timing windows**, and the separate actual-WASM
dispatcher proof and its exact source/workflow. Portable tests reparse raw guest
outputs, reconstruct medians/minima/floors and validate signals, wrapper exits,
standalone F0 receipt equality and both original manifests. Workflow success
alone is never qualification.

No VPS engine binary was downloaded, built, profiled or benchmarked in this
experiment. The VPS was used only for light orchestration, small timing/test
receipt downloads and portable checks. Resource preflight refused heavy work:
at 17:14 UTC, four CPUs, load1.51/1.81/2.44 and about5.3GiB available memory,
but only about307MiB root/tmp free. Missing local repeats are not passing repeats.

A separate post-RAM experiment moves the same query after RAM-loop execution,
only on zero progress, so successful folded loops avoid a duplicate check.
Its zero-state proof and own correctness/repeated measurements are required;
no speedup follows merely from rearranging source. Keep production source and
physical acknowledgements unchanged until verification supports promotion.
