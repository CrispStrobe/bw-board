# Live scalar edge-preflight experiment — not promoted

Baseline: core main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`,
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
Candidate: `bbe915252f8264a1de11bdb0d82bc08c9f3bba95`,
[draft core PR 148](https://github.com/CrispStrobe/labwired-core/pull/148),
[build 36970708348](https://github.com/CrispStrobe/bw-board/actions/runs/36970708348).
Original [baseline](baseline/BUILD-INFO.json) and [candidate](candidate/BUILD-INFO.json)
BUILD-INFO files retain complete hashes. Candidate module SHA-256 is
`de53613422974d2b52e89233a03839e39e95fb0225fba5c23c3a42fa38e532ef`.

Unlike rejected PR 147, this change retains the public resident-device Vec,
does not cache metadata, and makes a live boolean virtual preflight query.
The default implementation still invokes the existing metadata getter once.
Native production scanning remains unchanged. Tests check shared interior
mutation and getter effects. All 18 enabled core checks passed at the exact
candidate head; four conditional checks skipped. The independently built
WASM passes determinism and all 101 actual integration tests, with zero skips.
Fresh motion qualification still fails and artifact publication is skipped.
These facts establish correctness coverage, not performance acceptance.

## Ordinary, original-artifact A/B/B/A results

Each cell is candidate median change relative to the same comparison's
baseline. Do not pool hosts or Node versions. Every capture retains failed
floors and checks all cycle-indexed guest observations.

| Capture | F0 GPIO | F0 RAM | micro:bit motion |
| --- | ---: | ---: | ---: |
| Hosted 1, EPYC 7763 / Node 22.23.3 | +9.99% | −0.53% | +3.09% |
| Hosted 2, EPYC 7763 / Node 22.23.3 | +5.75% | −0.52% | −2.07% |
| VPS primary, Skylake / Node 20.20.2 | +3.09% | −2.45% | −10.98% |
| VPS repeat, Skylake / Node 20.20.2 | +3.49% | −3.62% | +5.47% |

GPIO and motion fail the 1× floor in every measured window. RAM passes every
window, despite these negative median changes. The VPS repeat GPIO minimum
also worsens (0.335× → 0.321×), despite its positive median. Hosted GPIO
candidate medians are 0.701× and 0.677×; motion is 0.800× and 0.804×.
This is not a claim of universal ≥1×, a motion speedup, or a RAM speedup.

Raw motion receipts: [hosted 1](hosted-ab-1/abba.json),
[hosted 2](hosted-ab-2/abba.json), [VPS primary](vps-motion-primary.json),
[VPS repeat](vps-motion-repeat.json). Hosted runs:
[36971651646](https://github.com/CrispStrobe/bw-board/actions/runs/36971651646),
[36971841238](https://github.com/CrispStrobe/bw-board/actions/runs/36971841238).
Runner provenance: [hosted 1](hosted-ab-1/runner.txt), [hosted 2](hosted-ab-2/runner.txt).
Raw F0 receipts: [hosted 1](hosted-ab-1/f0-abba/abba.json),
[hosted 2](hosted-ab-2/f0-abba/abba.json), [VPS primary](vps-f0-primary/abba.json),
[VPS repeat](vps-f0-repeat/abba.json). Child absolute directory paths identify
the original capture locations, not repository-relative links.
All 16 original F0 timing stdout captures are retained in the numbered child
directories as `ordinary-stdout.txt`. The parent child-launcher summaries are
also retained as `1-capture-stdout.txt` through `4-capture-stdout.txt`.

## Generated-code inspection

The hash-bound [WASM disassembly extract](wasm-preflight-inspection.txt) shows
all five named boolean-preflight bodies: four load a resident length directly
and compare it against zero, and one returns constant false. None contains a
nested direct or indirect call. This supports the default-method getter-inlining
hypothesis for this artifact; it does not establish removable timing cost,
prove a whole-workload speedup, or clear the mixed motion results.

## Order-control diagnostic

The ordinary runners now accept `--reverse` for candidate/baseline/baseline/
candidate instead of default baseline/candidate/candidate/baseline. Labels,
artifacts, guests, parsers, window count and ≥1× policy are unchanged. Both
runners reject NODE_OPTIONS. This is an order-control diagnostic, not a new
qualification protocol or permission to discard negative results.

The first [VPS reverse capture](vps-motion-reverse-primary.json) measured
0.240320× → 0.248859× (+3.55%), with matching guest observations and all windows
failing 1×. No owned compilation or disassembly ran during this capture.
Absolute rates are markedly lower than the earlier VPS captures. Shared host
load is uncontrolled; these observations do not establish its causal effect,
prove order bias, or establish that the candidate is regression-free.

A [second reverse capture](vps-motion-reverse-repeat.json) is retained for
transparency, but is not acceptance evidence: owned WASM disassembly overlapped
its timing. Its +14.67% motion median change (0.183× → 0.210×), with matching
guest observations and every floor failed, cannot isolate the engine change.
Do not combine it with the ordinary comparisons or omit its contamination.

Decision: keep PR 148 draft pending stronger performance evidence. No core
merge, app engine-pin change, artifact publication, physical capture rewrite,
or hardware drift acknowledgement update is made by this report. CP13 and
the every-window all-target ≥1× checkpoint remain open.
