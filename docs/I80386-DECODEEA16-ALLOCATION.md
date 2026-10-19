# Sixteen-bit effective-address allocation task

This document preserves the original ownership claim and acceptance contract.
The candidate is **not adopted**: its original paired qualification completed on
2026-10-18 and failed the predeclared lower-bound requirement. See the result
below; the original contract and candidate history remain preserved.

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


## Original paired result — 2026-10-18

The retained private application workload ran once through its complete original
sequence: four warmups `A B A B`, then seven pairs `AB BA AB BA BA AB BA`.
Frozen source arms were `0d306c5c67e4843e24a05d54da72d21cd56119e4` (A) and
`fa296c62cf4fad8f25dc5d3e9ae532e0d94e1015` (B). Each child used the original
15-million-instruction budget, ordinary JS with profiling disabled, Node
`v20.20.2`, one CPU quota, 1 GiB memory, no swap and no network. No child or pair
was replaced, dropped or repeated.

Independent retained-byte auditing joined all 18 children to their source,
input, runtime and containment declarations. All 22 architectural comparison
fields matched the frozen reference, excluding only the admitted source revision
and source-hash map. Whole-process user-plus-system CPU and same-scope wall
observations were evaluated by the unchanged frozen evaluator.

| Pair | Order | CPU A/B ratio | Wall B/A ratio |
| --- | --- | ---: | ---: |
| 1 | AB | 0.982385 | 1.017771 |
| 2 | BA | 1.012744 | 0.989330 |
| 3 | AB | 1.038136 | 0.963590 |
| 4 | BA | 1.033669 | 0.966667 |
| 5 | BA | 1.034218 | 0.967219 |
| 6 | AB | 1.044552 | 0.958222 |
| 7 | BA | 1.013587 | 0.984820 |

Displayed ratios are rounded; the frozen evaluator used the full retained
values. Median CPU ratio **1.0336687306501549** meets `>=1.03`, and median wall
ratio **0.9672191528545121** meets `<=1.02`. The predeclared conditional lower
bound is the minimum paired CPU ratio, **0.9823853211009174**, which fails the
strict `>1.00` requirement. Therefore **the original gate failed** and PR557's
performance-only CPU change is not adopted. Correctness agreement and the median
alone do not override that decision. The separate public code16 experiment does
not replace it, and this result does not authorize another sample or a new gate.

The first warmup's guest completed, but collection initially refused Docker's
reordered environment list. Its raw records were retained unchanged, the exact
unique-name/value comparison was corrected, and the same sequence continued at
child 2. The resulting 315.259679-second interruption is retained; no contiguous
warmup or independent identically distributed host-noise claim follows. Raw
inspect bytes stayed unchanged. Mount/environment inventory corrections did not
change workload, source arms, resource settings, semantics, timers or statistical
thresholds. The failed collector attempt remains preserved separately.

Evidence is private. Independent original-index SHA256:
`f52829dab2cd2b9e622e499c51f170559fb66c464465bae71bd932e86c9373d6`.
Frozen-evaluation SHA256:
`93cba571b37f354daeadcc93cafd3b0ddb19a302af6440fec92c5d918c9a5d71`.
The audit establishes finite local host/Docker consistency; it does not claim
continuous ownership, official hosted-artifact authentication, general emulator
speed or physical timing. Branches and original results remain preserved.

No further execution belongs to this frozen plan. A future optimization needs a
new ownership claim and acceptance plan before implementation or measurement,
while retaining this failed decision and all seven original observations.
