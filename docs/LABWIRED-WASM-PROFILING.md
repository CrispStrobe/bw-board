# LabWired WASM motion sampling and tier diagnostics

These diagnostics use the unchanged `test/labwired-microbit-motion.test.mjs`
guest, eight-million-step warmup, five 64-million-cycle windows and functional
assertions. No floor, fixture or deployed pin is changed. The plain A/B/B/A
probe remains the source of paired timing evidence and runs **before** these
diagnostics on the hosted workflow. Profiled or forced-tier timings must never
be substituted for ordinary realtime qualification.

## Local diagnostic

Use each original NODEJS module with its own original glue and CommonJS package
marker, plus the existing ARM guest compiler. Choose a new output directory:

```sh
node scripts/profile-labwired-motion.mjs \
  --wasm /path/to/original/nodejs \
  --out /path/to/new/evidence --mode sampled-default
```

Modes:

- `default`: unchanged Node flags, no profiler or trace. Still diagnostic.
- `trace-default`: default compiler settings with compilation tracing only.
- `sampled-default`: CPU self-sampling plus compilation tracing. Sampling can
  change V8 tiering; compare its trace to `trace-default`, not just to timings.
- `turbofan`: optimizing compiler only; diagnostic flags, not production settings.
- `liftoff`: baseline compiler only; diagnostic flags, not production settings.

Forced modes are validated against every observed compilation record. Liftoff
uses `--liftoff-only` and disables dynamic tiering as well as tier-up. Earlier
tool revision `c0e6e369` used only `--liftoff --no-wasm-tier-up`; the hosted
trace in run 36864571206 nevertheless contains TurboFan compilations. Those
old `liftoff` receipts are **mixed-tier diagnostics, not baseline-only evidence**.
Their ordinary A/B and default traces remain independent valid measurements.
Contradictory tier traces are retained before the corrected tool fails.

Ordinary A/B additionally requires every cycle-indexed guest observation to
match across all four runs (sensor data, sampling counts and matrix scans),
excluding only wall time and RTx. Raw results are saved before comparison.
Full ELF SHA256 is retained as provenance, but is not an equality assertion:
the unchanged GCC invocation embeds a random temporary object filename in
non-loaded symbol metadata. Equal observations are not full-state equivalence.

The script refuses to overwrite an output directory. It records module/glue and
harness/tool/parser SHA256, Node flags/version, CPU model, host load, all five RTx samples
and actual exit/failure counts. A failed floor remains a failure in the receipt;
a functional failure, missing sample, skip or malformed result stops the probe.
Raw stdout/stderr and the partial receipt are preserved before parsing. The
sampling mode retains the raw `.cpuprofile` plus its digest and self-sample
summary. Compiler traces retain function name/index, tier, body/code size and
compile time for every parsed record. Function indices are bound to the
artifact's name section only when one module appears in the trace; ambiguous
multi-module traces retain raw indices without guessing names. They do not
prove instruction semantics. Inherited NODE_OPTIONS must be unset so that the
recorded diagnostic flags are explicit.

Self samples cover initialization, warmup and measurement, not isolated guest
windows; shares are attribution, not automatically removable overhead.
Shared-host load and profiling overhead preclude comparing absolute timings
between these modes or treating them as a normal A/B speedup.

## Hosted exact-artifact comparison

Dispatch `.github/workflows/labwired-motion-ab.yml` at the tooling revision,
with exact baseline/candidate build run IDs and source commits. Set
`profile=true` to collect four separate modes for each artifact after ordinary
A/B/B/A. If glue differs, `allow_paired_glue=true` explicitly uses each original
build with its own unmodified glue. The workflow verifies both declared source
commits and module/glue hashes before execution. It publishes no artifacts or
pins and retains raw diagnostic evidence even if a step fails.

```sh
node --test test/wasm-motion-profile.test.mjs test/motion-ab-receipt.test.mjs
```

Synthetic parser tests are tooling tests, not emulator performance evidence.
