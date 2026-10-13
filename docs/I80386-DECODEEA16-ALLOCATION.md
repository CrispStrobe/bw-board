# Sixteen-bit effective-address allocation task

This is an ownership claim and proposed acceptance contract. No optimization or
performance result is implemented by this documentation change. Implementation
starts only after this claim merges and the source head and ownership are refreshed.

## Owned scope

Branch `lane/386-decodeea16-allocation-20261013` owns the sixteen-bit memory
address branch of `_decodeEA` in `src/experimental/i80386.js`, a new focused
`test/i80386-decodeea16-allocation.test.mjs`, this guide and its `LANES.md` entry.
Coordinate any overlapping CPU claim before implementation.

The proposed change replaces the temporary outer array and eight base/segment
pair arrays with scalar dispatch for the selected ModRM address form. Keep the
returned effective-address object independently owned. Preserve operand fetch
order, signed displacement handling, sixteen-bit wrapping, default DS/SS choice
and segment overrides. The direct displacement form must retain its DS default.

Keep the thirty-two-bit/SIB and register operand branches, instruction snapshot
and fault restoration, prefix semantics, debug/interrupt shadows, translation
cache, bus callbacks, native/WASM paths and consumer pins unchanged. This task
introduces no address cache, reusable operand object or alternate execution API.
Earlier snapshot allocation experiments are a separate hypothesis; do not repeat
them or infer a gain from their results.

## Correctness acceptance

Use freely authored instruction fixtures and independent address arithmetic.
Cover all twenty-four sixteen-bit memory ModRM forms, signed byte displacement
extremes, word displacement and register wraparound, distinct DS/SS bases and
limits, all segment overrides and address-size override. Check the unchanged
register and thirty-two-bit/SIB branches explicitly.

Exercise truncated displacement and instruction fetch across segment/page
boundaries. Require identical fetch order, architectural rollback, fault vector,
error code and CR2 where applicable, and no operand bus access after fetch
refusal. Cover protected segment access and VM86/real-mode addressing. Run the
affected existing CPU regressions and all enabled exact-head checks before
considering a merge.

## Paired qualification

Before measurement, freeze the same reviewed workload, inputs, instruction
budget, source/probe identities, runtime and host allocation for both arms.
Separate source identity and timing metadata from the architectural comparison;
require matching CPU/device/output observations and no new refusal. Keep
restricted input details and raw private records outside this repository.

Exclude two warm-up runs per arm and measure at least five alternating baseline
and candidate pairs, varying AB/BA order. Disable sampling instrumentation for
timing and record CPU and wall observations separately with resource limits and
failures. The proposed gate is paired median CPU speedup of at least 1.03, a
predeclared lower confidence bound above 1.00 and no median wall regression over
2 percent. Freeze the statistical method before the first measured pair; do not
adjust it after seeing results. Missing, timed-out or semantically unequal runs
cannot qualify a gain.

If the gain is absent or unresolved, preserve the results and do not adopt the
performance-only change. Sample weights are workload-specific observations,
not exact cost attribution or a forecast of whole-emulator speedup. This task
claims no physical 386 timing, broader guest compatibility or new backend.
