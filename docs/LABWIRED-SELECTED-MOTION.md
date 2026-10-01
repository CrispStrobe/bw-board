# Selected micro:bit motion boundary — 2026-10-01

This slice is based on cached BW `7ca77580`. GitHub was unreachable in the
implementation session; it does not establish the latest remote state or a
passing fresh WASM run. CP13 remains incomplete and the engine pin is unchanged.

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

Ten new local non-engine assertions passed (five manifest tests, two factory
constructor-double tests and three workflow/source tests). The real selected
motion suite has **not run** here: no fresh engine artifact was available.
Existing real-WASM generic input proof uses the historical published WEB
module under Node, not these new sensors.

After successful NODEJS qualification, run browser/worker guest and debugger
acceptance before promoting verified artifact/package hashes. No browser/UI
throughput, circuit replay, shared sensor IRQ or timed microphone/audio is
qualified by this slice. NODEJS results must not be reported as browser RTx.
