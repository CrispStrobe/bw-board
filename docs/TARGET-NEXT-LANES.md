# Target/performance handoff — 2026-10-05

Read this before resuming this campaign. Refresh `master`, engine `main` and
open PRs; these proposed lanes are not ownership claims. Public references only
belong in published handoffs. Existing detailed receipts remain authoritative;
this summary does not replace old failures or reinterpret them as successes.

## Current state and meaning of 1x

- The native forty-chip spin suite has source-bound >=1x qualification; selected
  native micro:bit motion has separate receipts. Neither proves browser/full
  board throughput. PXT micro:bit/Arcade is wall-paced API simulation, not CPU RTx.
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

1. Identify current engine source versus distributed artifact source; do not
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
Upstream PyBadge buttons are merged; SAM SPI is verified/unmerged PR152 and native
panel/DMA is not done. Wire only qualified capabilities with bounded input
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
