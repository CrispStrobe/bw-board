# WASM register inlining — verification incomplete, not promoted

Baseline: core main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`,
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
Candidate: `53b2be10799570c607b444fa174e2eb37ea74095`,
[draft core PR 149](https://github.com/CrispStrobe/labwired-core/pull/149),
[build 36977476487](https://github.com/CrispStrobe/bw-board/actions/runs/36977476487).
This does not stack the scalar boolean-preflight experiment in PR 148.
Only WASM `read_reg` and `write_reg` receive `inline(always)`; their bodies and
native production attributes are unchanged. A new test independently checks
all 256 register selectors, raw PC versus wrapping PC+4, and ignored invalid writes.

Original [baseline](baseline/BUILD-INFO.json) and [candidate](candidate/BUILD-INFO.json)
metadata bind all artifact hashes. Candidate module SHA-256:
`93057ffed6b78b2fa848c7b5462345b8b2bc22540180a70f52bfe7b0575360b8`.
Original Node glue is identical. Independent builds passed determinism and all
101 actual WASM integration tests, with zero skips. Fresh candidate motion
measured **1.046791× median / 1.040284× minimum**, passing all five windows;
that standalone host result is not a same-host speedup or universal qualification.
The [pipeline receipt](pipeline.json) retains qualification observations and run links.

At the exact candidate head, 17 enabled core checks passed, including all three
workspace shards and native performance checks. Default-members and its
aggregate gate fail on stale content-bound hardware drift acknowledgements and
generated validation documentation; four conditional checks skip. Consequently
full final-head verification is not complete. User permission to update the
seven acknowledgements is conditional on verification passing. None has been
updated: the mixed performance results below remain unresolved. Physical
captures and the existing 2026-10-31 acknowledgement expiry remain unchanged.

## Ordinary original-artifact comparisons

Each percentage is the candidate median change against the same comparison's
baseline. Do not pool hosts, runtimes, orders or workloads. ABBA means baseline/
candidate/candidate/baseline; BAAB reverses that order. All cycle-indexed guest
observations match. The VPS is shared and uncontrolled; no owned compiler,
optimizer or other benchmark overlapped these clean captures.

| Capture | F0 GPIO | F0 RAM | micro:bit motion |
| --- | ---: | ---: | ---: |
| Hosted 1, Xeon 8573C / Node 22.23.3 / ABBA | +4.26% | +12.10% | +5.48% |
| Hosted 2, EPYC 7763 / Node 22.23.3 / ABBA | +3.64% | +7.06% | +6.99% |
| Hosted reverse, EPYC 9V45 / Node 22.23.3 / BAAB | +8.73% | +20.47% | +8.24% |
| Clean VPS primary, Skylake / Node 20.20.2 / ABBA | −32.00% | −29.94% | +4.86% |
| Clean VPS reverse, Skylake / Node 20.20.2 / BAAB | −4.00% | −7.75% | −0.32% |
| Clean VPS motion repeat, Skylake / Node 20.20.2 / ABBA | — | — | +0.87% |
| Hosted Node 20 primary, EPYC 7763 / Node 20.20.2 / ABBA | +6.54% | +2.93% | +8.56% |
| Hosted Node 20 reverse, EPYC 9V74 / Node 20.20.2 / BAAB | +5.16% | −22.03% | +5.89% |

The VPS primary/reverse F0 captures were sequential with the corresponding
motion captures, not simultaneous. Temporal rate drift is visible in the raw
receipts; it does not justify discarding negative comparisons or failed floors.
Candidate motion medians on the VPS are **0.270577×, 0.266942× and 0.289183×**,
all below 1× in every window. On hosted EPYC 7763, candidate motion is
**0.845205×** and GPIO **0.674007×**, also below 1× in every window.
The other two hosted candidate comparisons pass every window of all three
selected workloads, but do not establish the all-target checkpoint.

Median gains can conceal worse minima: hosted 2 GPIO minimum falls
**0.641118× → 0.629489×**, and hosted reverse RAM minimum falls
**6.830481× → 6.319940×**. Clean VPS reverse RAM is more concerning:
baseline passes every window (**1.596491× minimum**), while candidate fails
one or more (**0.862541× minimum**), despite a **1.745841× candidate median**.
No floor is waived or reclassified.

Raw motion: [hosted 1](hosted-ab-1/abba.json), [hosted 2](hosted-ab-2/abba.json),
[hosted reverse](hosted-reverse/abba.json), [VPS primary](vps-motion-primary.json),
[VPS reverse](vps-motion-reverse-clean.json), [VPS repeat](vps-motion-repeat.json).
Raw F0: [hosted 1](hosted-ab-1/f0-abba/abba.json),
[hosted 2](hosted-ab-2/f0-abba/abba.json), [hosted reverse](hosted-reverse/f0-abba/abba.json),
[VPS primary](vps-f0-clean-primary/abba.json), [VPS reverse](vps-f0-clean-reverse/abba.json).
All four actual F0 child timing stdout files accompany each comparison in its
numbered directories. Child absolute paths identify original capture locations,
not repository-relative links. Tests reparse original stdout and independently
recompute medians, minima, floors, module hashes and matching observations.

Hosted runs:
[36978806067](https://github.com/CrispStrobe/bw-board/actions/runs/36978806067),
[36978957517](https://github.com/CrispStrobe/bw-board/actions/runs/36978957517),
[36979199784](https://github.com/CrispStrobe/bw-board/actions/runs/36979199784).
Runner provenance is retained beside each hosted comparison as `runner.txt`.
The original artifacts are never rewritten or replaced.

## Code-size tradeoff and next control

The hash-bound [body-size inspection](code-size-inspection.json), produced by
the retained [inspection tool](inspect-code.mjs), confirms named register-helper
functions disappear. However `step_batch` grows **77,390 → 217,959 WASM body
bytes (+181.63%)**. Fast-block grows 32,735 → 33,605 bytes; cached-run grows
31,605 → 32,493. The complete module grows 27,556,189 → 27,773,578 bytes.
These are code sizes, not timing, removable-cost estimates or proof of causation.
Code-size/runtime/host interactions are a hypothesis requiring controlled tests.

Hosted Node 20.20.2 normal- and reverse-order controls use the same original
artifacts and unchanged timing protocol, with exact runtime selection at tool
head `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`:
[36982382186](https://github.com/CrispStrobe/bw-board/actions/runs/36982382186),
[36982385325](https://github.com/CrispStrobe/bw-board/actions/runs/36982385325).
Both completed with matching guest observations. The primary control has
positive medians on all three workloads, but reverse-order RAM declines
**3.833966× → 2.989476× (−22.03%)**, with minimum
**3.744186× → 1.891738×**. RAM still passes every window; GPIO and motion fail
every window on both Node 20 hosts. This reproduces a RAM decline outside the
VPS, without proving the runtime or code bloat is causal. The candidate is not
qualified for landing. Original [primary motion](hosted-node20-primary/abba.json),
[primary F0](hosted-node20-primary/f0-abba/abba.json),
[reverse motion](hosted-node20-reverse/abba.json),
[reverse F0](hosted-node20-reverse/f0-abba/abba.json), actual F0 child stdout,
runner provenance and both BUILD-INFO files are retained beside these receipts.

The [contamination note](CONTAMINATED-CAPTURES.md) explicitly excludes the
overlapping first VPS F0 comparison and incomplete reverse-motion diagnostic.
Their original receipts remain for transparency, not acceptance. A separate
post-optimizer pilot was stopped before complete build metadata, execution or
qualification; no post-optimized artifact contributes to this report.

Decision: do not land this whole-register variant; retain PR 149 as draft and
preserve its evidence while preparing a narrower variant that avoids the large
interpreter expansion. No engine merge,
app-pin change, artifact publication, hardware capture rewrite or acknowledgement
update is authorized by these measurements. CP13/all-target ≥1× remains open.
