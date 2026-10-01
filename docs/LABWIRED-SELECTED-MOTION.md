# Selected micro:bit motion boundary — 2026-10-01

This slice is based on BW `7ca77580`, confirmed unchanged when networking
returned. The initial implementation session could not reach GitHub. The
follow-up pushed PR #184 and built current LabWired source `4d944d2d` in
workflow run `36816537489`. CP13 remains incomplete and the engine pin is unchanged.

`buildLabwiredSystem`, `labwiredAdapterOptionsFor` and the LabWired debug-target
factory accept `boardVariant: 'lsm303agr'` with `chipKind: 'microbit_v2'` (also
the existing `microbit` alias). It explicitly attaches `accelerometer` and
`magnetometer` to `i2c0`, alongside the unchanged matrix. The default remains
matrix-only. This is not a hardware auto-detection rule or an FXOS8700 model.
Unknown variants and variant requests combined with explicit manifest/pin
overrides are rejected, rather than silently losing the selected devices.

Supply the option to the existing board-derived factory:

```js
await createDebugTarget('labwired', {
  wasm, board, firmware, chipKind: 'microbit_v2', boardVariant: 'lsm303agr'
});
```

An engine containing these sensor models is required. Discovery and atomic
engineering inputs use the existing [scoped input contract](LABWIRED-SCOPED-INPUTS.md).
The app's deployed engine has not been upgraded by this change.

The selected variant also uses the qualified engine's compact silicon GPIO
windows: P0 occupies `0x50000000..0x500007ff`, P1's implemented registers start
at `0x50000800` with `reg_offset: 0x500`. This preserves P0 PIN_CNF while allowing
the guest's real P1 stores. The first actual guest exposed the legacy descriptor's
synthetic `0x50001000` remap: column 4 stayed lit. Correcting the selected
descriptor makes the unchanged guest's exact diagonal assertions pass. The
legacy default descriptor is intentionally unchanged until artifact promotion.

## Qualification boundary

`test/labwired-microbit-motion.test.mjs` compiles the MIT simulation-only guest
in `test/fixtures/labwired/microbit-motion`. The three source files are byte-for-byte
copies of LabWired `5fb3d7d44cc1487fdab757906ae62222e8798e93`; their framed bundle
SHA256 is `e6b8c239dc7ee1aca736671350cda8101f4bf8d6c89d91e2a9e787c85b553939`.
No vendor firmware or GPL emulator is introduced. A local compiler produced a
636-byte text section; compilation alone does not qualify execution.

The actual-WASM test checks both sensor identities, two held poses, SRAM/DMA
receipts, a diagonal matrix and physical button levels. With
`LABWIRED_REQUIRE_MOTION_RTX=1` it also requires **every** one of five consecutive
64-million-cycle windows at 64 MHz to meet 1×; an 8M-cycle warm-up is excluded.
All five RTx samples are retained before asserting the floor. Missing artifacts
or compilers fail when `LABWIRED_MOTION_REQUIRED=1`; an optional local skip is
not a passing qualification.

Dispatch `labwired-wasm.yml` on a branch containing this slice with an exact
LabWired source `ref`, `qualify_motion: true` and `publish: false`. The new job
uses the fresh NODEJS build, captures build/source/runner provenance, requires
two executed tests, zero failures/skips and exactly five sample lines. Publication
with requested motion qualification requires that job to succeed, as well as
the existing determinism and integration gates. Non-motion builds retain their
original gates. The workflow is actionlint/shellcheck-clean locally.

The new local non-engine tests cover manifests, factory constructor doubles,
workflow/source invariants and the oracle census. The actual selected-motion
functional test now passes on the fresh run's build-B NODEJS artifact after
the descriptor correction (both identities/poses, DMA, matrix and buttons).
The RTx test was explicitly skipped in that functional-only local run; no
passing WASM performance qualification is claimed yet. A subsequent VPS run
executed both tests with zero skips: functional passed, but all five RTx
windows failed the unchanged floor (0.266108× median / 0.256228× minimum).
This is a failed shared-VPS observation, not a hosted result; it does not
justify artifact promotion. The [complete VPS diagnostics](receipts/2026-10-01-microbit-motion-wasm-vps.json)
also retain a separate JIT-request probe (0.126523× median / 0.125133× minimum).
These sequential diagnostics are not a controlled alternating A/B experiment;
compiled-block/fallback counters were not captured. JIT remains unpromoted.

The corrected [hosted run 36817423180](https://github.com/CrispStrobe/bw-board/actions/runs/36817423180)
used source `4d944d2d` and boundary `1cec7b39` on EPYC 7763 / Node 22.
Both fresh builds, determinism and existing integration passed. Motion executed
two tests with zero skips: functional passed, but **all five** performance
windows failed (0.686913× median / 0.653157× minimum). Publication was blocked.
[Provenance and all samples](receipts/2026-10-01-microbit-motion-wasm-hosted/qualification-context.json),
[raw output](receipts/2026-10-01-microbit-motion-wasm-hosted/motion-results.txt),
runner context and BUILD-INFO are retained. This is NODEJS workload evidence,
not browser, UI or circuit-solver throughput. Generic real-WASM input tests also
pass using the fresh WEB build under Node, separately from motion performance.

## Binary-only optimization experiment

The [2026-10-01 A/B/B/A receipt](receipts/2026-10-01-microbit-motion-wasm-opt-abba.json)
compares that exact engine with a separate Binaryen 132.0.0 `wasm-opt -O3` copy,
using identical glue and the unchanged guest/qualification test. Four complete
runs retain twenty windows: baseline pooled median **0.365510×**, candidate
**0.367560×** (ratio **1.005611**). Every window failed 1×. On this shared VPS,
that small difference is not evidence of a significant speedup. The binary
shrunk from 27,475,605 to 24,405,115 bytes; this does not qualify performance.
All four functional motion tests passed; the candidate also passed Lite's four
generic real-WASM input tests with zero skips. No artifact/default/pin promotion.

`scripts/probe-labwired-motion-ab.mjs --baseline <original-nodejs-dir>
--candidate <candidate-nodejs-dir> --out <new-receipt.json>` repeats the diagnostic.
By default it requires identical original glue, distinct binaries, five correctly timed samples per
run, actual functional success, two tests, zero skips and consistent exit status.
Failed RTx samples are preserved rather than removed or relabelled as green.
The probe returns success for a *completed diagnostic*, not for qualification;
consult each run's `allWindowsMeet1x`. Parser mutation tests are synthetic log
tests only, not engine evidence. Candidate bytes were produced with
`npm exec --yes --package=binaryen@132.0.0 -- wasm-opt <original.wasm> -O3 -o <candidate.wasm>`;
the receipt binds both binary hashes, tool integrity, CPU, Node and complete logs.

The manual `labwired-motion-ab.yml` workflow compares build-B artifacts from two
existing `labwired-wasm.yml` runs on one Ubuntu 24.04 / Node 22 runner, without
rebuilding either engine. Supply each run ID and exact source commit. Both
BUILD-INFO source declarations and original glue/WASM hashes are checked before
execution; runner, toolchains, BUILD-INFO files and complete A/B/B/A results are
retained even on failure. It has read-only repository permissions and no publish
step. A successful *diagnostic* run does not mean its RTx windows passed: inspect
`allWindowsMeet1x`. The independent determinism, integration and all-five >=1x
qualification workflow remains unchanged. Differing glue fails by default.
An explicit `--paired-glue` probe option (`allow_paired_glue: true` in CI) instead
compares each original build with its own unmodified glue, recording that policy
and both original hashes. This does not certify JS/ABI equivalence: the actual
functional guest assertions must still pass for both engines. For candidate
`08ad74b7`, the inspected diff contains only five `shim_idx` numbers inside
wasm-bindgen cast-intrinsic comments, but the probe does not normalize or rewrite
either module or silently reuse one engine's glue for the other.

## Source-level block-payload experiment

Candidate `08ad74b78f2dfbd353f6b82b038415d9f55cd780` keeps the cached Cortex-M
block in place and copies only the instruction being executed. It leaves guest,
observer/debugger/IRQ/scheduler guards and the reference fallback intact.
Local Cortex-M tests passed 154/154 with zero skips (including the 19 discovery
tests and a full-capacity, rotated-entry reference-step regression).

[Native exact-base A/B/B/A](https://github.com/CrispStrobe/labwired-core/actions/runs/36828554051)
observed +5.23% on one Xeon Platinum 8573C. All ten candidate windows exceeded
1×. [Native CorePerf](https://github.com/CrispStrobe/labwired-core/actions/runs/36828556801)
passed all 40 spin targets and reported no regressions, without waivers.
These native results do not qualify WASM or realistic workloads on all boards.

[Hosted WASM A/B/B/A](https://github.com/CrispStrobe/bw-board/actions/runs/36830478908)
used the exact base `4d944d2d9ec320f7acd25b54cc41a50b850d6788` and candidate
on one EPYC 7763 / Node 22 runner, explicitly selecting each original build's
paired glue. The completed diagnostic is green, **not** its performance gate:
baseline pooled median 0.680217×, candidate 0.683885× (+0.54%), all twenty
windows below 1×. All four functional invocations passed with zero skips.
There is no demonstrated meaningful WASM speedup.

[Fresh candidate qualification](https://github.com/CrispStrobe/bw-board/actions/runs/36828563070)
separately passed both builds, determinism, existing integration and functional
motion assertions, but all five RTx windows failed (median 0.824684×, minimum
0.818189× on EPYC 9V74). Publication was skipped. Do not compare that CPU's
absolute throughput against earlier EPYC 7763 measurements as a gain estimate.

[Retained raw receipts](receipts/2026-10-01-cortex-m-block-payload/README.md)
bind the source commits, original artifacts and unchanged guest. A noisy local
VPS diagnostic is retained separately with its concurrent-test limitation; it
is not the headline comparison. Core PR 142 stays a draft: WASM remains below
1×, and seven silicon captures predate the shared CPU change. No new physical
capture was obtained, no drift acknowledgement refreshed and no pin promoted.

## Opcode-directed dispatch experiment

Independent candidate `13ace46fe9ea26ae489a07bae57d67aac95fe166` starts from the
same exact `4d944d2d` base, without PR 142's payload change. A borrowed tagged,
width-checked opcode selects relevant existing T16 probes in their original
order. Selected executors keep their complete validation; cold/collided/wide
entries fall back to the interpreter. Observer/debug/IRQ/IT/tap/trace guards,
scheduler clamps, cycle advancement and access accounting remain unchanged.
There is no stable-MMIO coalescer or guest edit.

Native exact-base A/B/B/A observed +13.03% on one Xeon Platinum 8370C, with all
ten candidate windows >=1×. Two hosted WASM A/B/B/A runs on separate EPYC 9V74
runners observed +6.60% and +7.38% pooled median gains. All forty windows were
below 1×; the repeat's candidate minimum was worse than its baseline minimum.
All eight functional invocations passed. These are observed sequential paired
comparisons, not contention-isolated statistics or browser measurements.

Fresh candidate builds were deterministic; existing integration passed. The
selected-motion gate executed two tests, zero skips: functional passed but all
five RTx windows failed (0.738987× median / 0.716393× minimum, EPYC 7763).
The candidate WEB build also passed all four Lite actual-WASM input-routing
tests with zero skips. These do not establish full debugger/browser RTx.

The feature-off unit suite passed 4,056 tests with zero failures and three
existing ignored tests; all three new dispatch regressions passed. They compare
against the original probe order over rotated entries/budgets and RAM/MMIO
addresses, CPU snapshots, RAM and counters; test cold/tag/width rejection; and
exercise lookup/filtering for all 65,536 halfwords. The original single-step
differential tests remain required. Scheduler-observable CI passed separately.
Native board/model qualification subsequently passed, including **156 Cortex-M
tests, zero failures/ignored tests**. This is not a zero-skip claim for the
whole board job: its integration suites retain physical-hardware-only ignores.
Native CorePerf also passed all 40 spin targets, with no reported instruction
regressions or waivers. This is not all-chip sensor-heavy WASM qualification.

[Receipts, source hashes and remaining qualifications](receipts/2026-10-01-cortex-m-dispatch/README.md)
are retained as measurements of the original `13ace46f` revision. Core PR 143
subsequently landed as `4deee6f0` after final-head CI passed. Seven user-approved,
exact-content-bound drift acknowledgements expire **2026-10-31**; physical
capture dates/results/digests are unchanged and hardware re-capture is owed.
Final-head native exact-base A/B/B/A on one EPYC 9V74 observed **+14.74%**
(1.410521× baseline / 1.618482× candidate); all ten candidate windows passed
1×, minimum 1.596440×. Board motion passed all five windows (1.511610× median,
1.507249× minimum), and all 40 native CorePerf spin targets passed without
instruction-cost regressions or waivers. [Final-head landing receipts](receipts/2026-10-01-cortex-m-dispatch-landing/README.md)
are separate from the earlier WASM evidence. No WASM floor relaxed, artifact
promoted or deployed pin changed; CP13 remains open.

## Latest scalar and bounded-run WASM evidence

The cached T16 scalar executor landed as core `c05e8de3` after all 19 enabled
final-head checks passed. Three exact-artifact paired comparisons measured
**+6.94%, +1.23% and +4.85%** median gains; one repeat's candidate minimum
worsened. Fresh qualification still failed every 1× window:
**0.704710× median / 0.690863× minimum**, EPYC 7763. See the
[scalar receipts](receipts/2026-10-01-wasm-cached-scalar/README.md).

The bounded cached-run optimization in
[core PR 146](https://github.com/CrispStrobe/labwired-core/pull/146) reuses the
checked executor for at most 16 tagged T16 retirements within the existing
scheduler budget. Native production dispatch and debugger/observer/IRQ/IT
guards remain unchanged. Three hosted exact-artifact paired comparisons
measured **+8.24%, +7.15% and +9.65%** against the landed scalar baseline.
The last comparison measures the fixed runtime source `2f5d9355`; two ordinary
VPS repeats of that exact module measured **+9.20% and +10.06%**. Within each
comparison all cycle-indexed guest observations match. These are same-runner
comparisons, not interchangeable absolute host rates or all-chip qualification.

The fresh fixed-source build passed independent builds, determinism and all
101 actual WASM integration tests with zero skips, but failed every timed
window: **0.834235× median / 0.808772× minimum**. Publication was skipped;
app pins remain unchanged and CP13 remains open. The full local core suite
passed 4,234 tests with three existing ignored tests. Seven explicitly approved
content-bound hardware acknowledgements retain their **2026-10-31** expiry and
unchanged physical evidence; live re-capture remains owed.

The [bounded-run receipts](receipts/2026-10-01-wasm-cached-runs/README.md) retain
the distinct module hashes, original paired glue, raw windows, CPU fingerprints
and exact provenance. The core PR records the authoritative final CI and merge
status. PR 146 landed as `43b2d62f` after all 19 enabled final-head checks passed;
the [landing receipt](receipts/2026-10-01-wasm-cached-runs/landing.json) records
the exact head and verdicts. Neither a
green diagnostic comparison nor core landing overrides the failed fresh floor.

After successful NODEJS qualification, run browser/worker guest and debugger
acceptance before promoting verified artifact/package hashes. No browser/UI
throughput, circuit replay, shared sensor IRQ or timed microphone/audio is
qualified by this slice. NODEJS results must not be reported as browser RTx.
