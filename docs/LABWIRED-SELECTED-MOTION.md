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

After successful NODEJS qualification, run browser/worker guest and debugger
acceptance before promoting verified artifact/package hashes. No browser/UI
throughput, circuit replay, shared sensor IRQ or timed microphone/audio is
qualified by this slice. NODEJS results must not be reported as browser RTx.
