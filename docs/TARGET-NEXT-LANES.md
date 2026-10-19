# Target/performance handoff — 2026-10-07

Read this before resuming this campaign. Refresh `master`, engine `main` and
open PRs; these proposed lanes are not ownership claims. Public references only
belong in published handoffs. Existing detailed receipts remain authoritative;
this summary does not replace old failures or reinterpret them as successes.

## Current state and meaning of 1x

- The older native forty-chip spin receipts remain valid for their exact source,
  but pre-repair LabWired `67920fcf8d82c74f3cc63285181fe26db93cf720` had a
  **PyBadge regression**: [Core Perf37481145682](https://github.com/CrispStrobe/labwired-core/actions/runs/37481145682)
  measured **0.05x**, batch **1**, versus generic ATSAMD51 **67.97x**, batch
  **1023.8**. The relative stage did not run after the absolute RTx failure.
  The suite now covers 42 chips / 82 board modes; the other 41 chips met the
  absolute floor. [Issue158](https://github.com/CrispStrobe/labwired-core/issues/158)
  and [repair PR159](https://github.com/CrispStrobe/labwired-core/pull/159)
  track the idle SPI walk/batching cause. PR159 is now merged as
  `ae127c89b9f60ed8a239f82858859c31ef8255af`, tested source
  `547da6da814afd0375199b192db7e3e2416042a0`, with identical merge/review trees.
  All 20 enabled correctness checks passed. Two full native chip-spin runs
  recovered all 42 chips above 1x: PyBadge medians **61.4713x / 84.1056x**, batch
  **1023.8**. The first full run failed F411 relative cost; the repeat and two
  valid isolated candidate comparisons passed unchanged baselines. Preserve
  that failure and the invalid shared-target diagnostic; measurement stability
  remains open. [Exact receipts/boundaries](https://github.com/CrispStrobe/labwired-core/blob/main/docs/receipts/2026-10-07-sam-spi-p0/README.md).
  These runner-specific native spin rates are not an A/B gain, active display,
  full-board or WASM proof. Full-board GPIO service still pins interval 1.
- That pre-repair source's [native micro:bit qualification37481145769](https://github.com/CrispStrobe/labwired-core/actions/runs/37481145769)
  passed: GPIO median **6.6944x**; motion median **1.2748x**, minimum
  **1.2697x**, all five runs >=1x. This is selected active native guest evidence,
  not browser/full-board throughput. PXT micro:bit/Arcade is wall-paced API
  simulation, not CPU RTx.
- ST7735 colour/parser/inspection and write-driven reset/backlight foundation
  landed in [LabWired PR161](https://github.com/CrispStrobe/labwired-core/pull/161),
  merge `f77110d4646cab67cb12be9a19fc787afe3a650b`, reviewed source
  `90943b8d72957f497d6794913ef43a066b302711`. All 20 enabled checks passed;
  four authored SAM guest tests passed in both feature configurations.
  [Fresh native micro:bit run37605866679](https://github.com/CrispStrobe/labwired-core/actions/runs/37605866679)
  measured five-sample medians **5.6307x** GPIO/display/buttons and **1.1656x**
  motion/display/buttons (motion minimum **1.1487x**). Tested merge checkout
  `4e99e37cd4ded9cb932c333418d5935dc1481477` has the landed main's tree.
  These selected runner-specific native results are not an A/B, PyBadge,
  complete-board or WASM measurement. The earlier rates above remain historical.
  [Exact qualification and next rectangular driver/panel lane](https://github.com/CrispStrobe/labwired-core/blob/main/docs/engineering/st7735-color-foundation.md).
  Production module binding, IRQ/DMA and app adoption remain open; no pin moved.
- Lite [target run37463042960](https://github.com/CrispStrobe/brickwright-lite/actions/runs/37463042960)
  on `23bc15cf4e9f5910f1f7455425b238cccd4c4834` measured Arduboy **5.561x**,
  ATtiny88 **10.227x**, Uno **5.178x**, micro:bit-class WASM **26.818x** and
  PyBadge-class WASM **33.417x**. The two WASM rows are terminal post-boot
  smoke, not active motion or native games. The shipped engine artifact uses
  **`31b6f8aade1af3329cf686438acb31bee204e23d`**, before the SPI merge; it must
  not be attributed the newer native regression or newer capabilities.
- Source-bound WASM publication [run37438840274](https://github.com/CrispStrobe/bw-board/actions/runs/37438840274)
  passed independent builds/determinism and **108 tests, zero failures/skips**.
  Its **motion job was skipped**. Publication success therefore does not close
  the active WASM floor; obtain ordinary motion/RAM/GPIO receipts in W1.
- Landed WASM scalar (`c05e8de3`) and bounded cached-run (`43b2d62f`) improvements
  retain controlled gains, but did not close the all-window active WASM floor.
  The bounded-run paired gains were +8.24%, +7.15%, +9.65%; its separate fresh
  result was 0.834235x median/0.808772x minimum. A rebuild measured
  0.775416x/0.769654x on another observation. These are not today's main rates.
  [Original evidence](receipts/2026-10-01-wasm-cached-runs/README.md).
- Active STM32F0 48 MHz RAM cleared every window in two main-artifact runs
  (3.01x/2.87x medians), while GPIO failed (0.594x/0.659x medians).
  [F0 evidence](receipts/2026-10-02-f0-main/README.md).
  A single synthetic F0 number is not a whole-board rating.
- Later register inlining/splitting, cached frames, admission placement,
  outlining/postprocessing and larger discovery memo experiments remain
  unqualified/rejected when ordinary paired regressions or floors fail.
  The [README evidence index](../README.md) preserves gains, losses and minima.
  Smaller compiled bodies or a fresh fast-host pass do not override A/B losses.
- Latest [discovery census](receipts/2026-10-04-wasm-discovery-census/README.md)
  measured 99.80692% exact negative hits in 61,542,607 warmed motion lookups,
  94,901 collisions and no counted generation events. This is frequency, not
  a cost share or speedup. F0 RAM/GPIO census remains unmeasured.
- App pins and physical captures are not advanced by diagnostic experiments.
  Hardware re-capture remains owed. CP13/CP14 and all-target WASM >=1x stay open.

User-facing priorities and all target boundaries:
[Lite handoff](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/TARGET-NEXT-LANES.md).
Engine-native board contracts:
[LabWired handoff](https://github.com/CrispStrobe/labwired-core/blob/main/docs/engineering/target-next-lanes.md).
SPIKE firmware's newer canonical tasks:
[firmware next steps](https://github.com/CrispStrobe/brickwright-spike-prime-fw/blob/main/docs/project/next-steps.md).

## W1 — current baseline and F0 census (ready, measurement-only)

**Files:** `scripts/probe-labwired-f0.mjs`,
`scripts/probe-labwired-fastpath-census.mjs`, `scripts/profile-labwired-motion.mjs`,
`.github/workflows/labwired-f0-profile.yml`, engine diagnostic feature/tooling
identified by the discovery-census archive. Read
[F0 timing](LABWIRED-F0-TIMING.md) and [profiling policy](LABWIRED-WASM-PROFILING.md).

1. Read the merged PyBadge P0 receipt and its open stability follow-up. Identify
   current engine source versus distributed artifact source; do not
   rename `43b2d62f` historical artifacts as a fresh-main build. Build exact
   source twice on hosted CI; retain module/glue/compiler hashes and determinism.
2. Run ordinary, uninstrumented active motion/RAM/GPIO with frozen guest,
   warmup/budgets/input poses and all existing integration assertions. Record
   every sample, minima and declared runner/runtime. Do not change floors.
3. Separately extend the existing default-off discovery census to F0 RAM/GPIO.
   Share identical guest ELF bytes across controls/diagnostics, inspect keys,
   hits/collisions/generation and actual progress; keep diagnostic timing out
   of ordinary RTx. Preserve failure logs and unavailable evidence explicitly.

**Done:** public source-bound baseline and reproducible F0 counters exist,
all advertised correctness/build checks pass, original results are retained,
and no publishing/pin/hardware update is implied by diagnostic success.

## W2 — cheaper exact-hit path (hypothesis; after W1)

**Files:** engine Cortex-M discovery/admission hotpath identified by the census,
its regression tests; paired tools `scripts/probe-labwired-motion-ab.mjs` and
`scripts/probe-labwired-f0-ab.mjs`.

Profile the exact-hit return path first; frequency alone cannot justify a
rewrite. Make one bounded candidate preserving positive-block precedence,
exact PC/current-generation keys, stale clearing, code-write invalidation,
observer/debug/IRQ guards and budgets. Do not cache MMIO values or replay output.
Test same-PC RAM -> MMIO -> RAM, modified code, collision/wrap, declined
side-effect freedom and actual guest observations. Native production policy
must remain unchanged unless separately justified and qualified.

**Done:** independent deterministic builds, affected engine regressions and
the actual distributed-WASM integration set (108 tests in the current tool
contract; recheck on current base) pass. Ordinary same-runner ABBA/BAAB repeats
retain motion/RAM/GPIO gains AND losses/minima across declared Node versions;
unchanged all-window >=1x and other target gates pass before publication.
Reject/rework mixed regressions rather than landing from a cherry-picked gain.

## W3 — bridge/UI adoption (after qualified engine proof)

**Files:** exact-target LabWired bridge/catalog and input/debugger tests,
`scripts/build-labwired-wasm.mjs`, `.github/workflows/labwired-wasm.yml`,
then Lite's explicit vendor-pin/production app lane.

First identify which engine features the shipped adapter actually exposes.
Upstream PyBadge buttons and blocking SAM SPI are merged (PR151/PR152), but the
idle regression was repaired by PR159; its measurement-stability follow-up
remains open. PR161 adds a qualified test-only colour/GPIO foundation, not a
production panel or DMA driver. Wire only qualified capabilities with bounded input
validation and debugger-visible actual model output. Build/publish a source-bound
artifact only after ordinary runtime gates; advance Lite explicitly afterward.

**Done:** exact source/module/glue and catalog identities agree; actual firmware
inputs/pixels/debugger boundaries and failure refusals pass in production app.
Native tests alone do not justify a WASM pin or full-board claim.

## W4 — product-first performance (ready for existing backends)

Use Lite lane D for representative Arduboy/ATtiny88/micro:bit/Arcade programs,
frames/input/debugger latency with UI active. Preserve existing avr8js ATtiny88
support; a second engine is optional, not a fix for missing support. STM32F0
also has a shipped light-tier route; LabWired F0 improvements do not gate PXT.

**Done:** measure an actual experience bottleneck and improve it by controlled
A/B while maintaining observations/correctness. Keep native CPU, browser engine,
UI/pacing and whole-board fidelity claims separate.

## Completion/reporting contract

Every lane report names exact tested source, guest/module/glue hashes, runner,
ordinary versus diagnostic mode, every sample and failed gate, positive/negative
proof, and remaining scope. Hosted builds/qualification use redistributable
authored guests; no private recovery images in public artifacts. Do not weaken
floors/baselines/downcast ceilings or change physical evidence/ack expiry.
Publish documentation-only changes separately from unqualified engine branches.
