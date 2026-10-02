# Restricted T16 register specialization — not qualified for landing

Baseline: core main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`,
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
Candidate: `59232bb1f54aca4decc5312da895d533980788dc`,
[draft core PR 150](https://github.com/CrispStrobe/labwired-core/pull/150),
[build 36983532725](https://github.com/CrispStrobe/bw-board/actions/runs/36983532725).
This independent experiment does not stack PR 148 or PR 149. It specializes
low-register access only inside the existing T16 scalar executor; high/special/
invalid selectors delegate to unchanged ordinary helpers. Native production
wrappers forward to the original helpers. The unit test deliberately executes
the WASM selector bodies and independently checks all 256 selectors and PC+4.

Original [baseline](baseline/BUILD-INFO.json) and [candidate](candidate/BUILD-INFO.json)
metadata bind artifact hashes. Candidate module SHA-256:
`f8d649be7699cce2a0c52f52e25aa196868c35b43b2c2f64262ad9738390c476`.
Original glue hashes differ, so every comparison explicitly uses each original
build's own paired glue; no synthetic hybrid artifact is tested. Independent
builds and determinism passed. All **101 actual WASM integration tests passed,
zero failures/skips**, with original [baseline](baseline-integration.txt) and
[candidate](candidate-integration.txt) logs retained. Fresh candidate motion
qualification is **0.764890× median / 0.751187× minimum** and fails every window;
publication was skipped. The build run's overall failure is that real floor
failure, not an integration failure and not a same-host regression measurement.
Original [qualification log](candidate-qualification.txt) and the guarded
[pipeline receipt](pipeline.json) preserve that distinction.

At the exact candidate head, all 17 executable core checks passed, including
three complete workspace shards, their aggregate, native board/performance,
feature-off and browser checks. Default-members and its gate fail because the
same seven content-bound hardware drift acknowledgements are stale; four
conditional checks skip. Final-head verification is not complete. User approval
to update acknowledgements was conditional, and these performance results do
not satisfy it. No acknowledgements, physical captures or their 2026-10-31
expiry have been updated.

## Four ordinary hosted comparisons and sequential VPS controls

Each percentage is the candidate median change against the same comparison's
baseline. No hosts, versions or workloads are pooled. All comparisons retain
actual cycle-indexed guest observations and every failed floor. ABBA means
baseline/candidate/candidate/baseline; BAAB reverses it. Hosted tooling is exact
`fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`. The pipeline checks immutable tool
heads, original source commits, independent build gates and actual test counts
before dispatch. A separate verifier reparses all original stdout, module
hashes, runtime versions, orders, medians, minima and floors.

| Capture | F0 GPIO | F0 RAM | micro:bit motion |
| --- | ---: | ---: | ---: |
| Hosted 1, EPYC 7763 / Node 20.20.2 / ABBA | −8.87% | −1.70% | +8.24% |
| Hosted 2, EPYC 7763 / Node 20.20.2 / BAAB | −5.02% | −0.93% | −4.35% |
| Hosted 3, EPYC 9V74 / Node 22.23.3 / ABBA | +0.42% | +13.67% | +0.85% |
| Hosted 4, EPYC 9V74 / Node 22.23.3 / BAAB | +1.37% | +13.31% | −0.89% |
| VPS primary, Skylake / Node 20.20.2 / ABBA | +17.54% | +115.72% | +5.00% |
| VPS reverse, Skylake / Node 20.20.2 / BAAB | −19.48% | −18.72% | −1.13% |
| VPS motion repeat, Skylake / Node 20.20.2 / ABBA | — | — | −7.17% |

The large positive VPS RAM comparison is not a reliable 115.72% speedup claim.
Its baseline minimum is **0.559241×**, versus **1.537259×** candidate minimum;
the next reverse comparison instead declines **1.803384× → 1.465781×** median.
The shared VPS has marked temporal rate drift and uncontrolled other-project
load. All these captures ran sequentially, with no owned compiler, optimizer,
disassembly or overlapping local benchmark. None is excluded as contaminated,
and uncontrolled load does not justify discarding the negative results.

All hosted RAM windows pass 1×, but hosted GPIO fails every window and hosted
motion fails at least one window in every comparison. Candidate hosted motion
medians are **0.618908×, 0.595439×, 0.768456× and 0.980559×**; GPIO medians
are **0.520051×, 0.551333×, 0.602189× and 0.789950×**. Positive RAM medians
on Node 22 conceal worse minima: hosted 3 **2.924345× → 1.644115×**, hosted 4
**3.673124× → 2.606378×**. VPS motion medians are **0.356866×, 0.322997× and
0.310239×**, below 1× in every window. Each candidate VPS motion minimum is
worse than its corresponding baseline. No failed floor is waived.

Original motion/F0 receipts and runner provenance:

- [Hosted 1 motion](hosted-ab-1/abba.json), [F0](hosted-ab-1/f0-abba/abba.json),
  [runner](hosted-ab-1/runner.txt), [run 36984844937](https://github.com/CrispStrobe/bw-board/actions/runs/36984844937).
- [Hosted 2 motion](hosted-ab-2/abba.json), [F0](hosted-ab-2/f0-abba/abba.json),
  [runner](hosted-ab-2/runner.txt), [run 36985291378](https://github.com/CrispStrobe/bw-board/actions/runs/36985291378).
- [Hosted 3 motion](hosted-ab-3/abba.json), [F0](hosted-ab-3/f0-abba/abba.json),
  [runner](hosted-ab-3/runner.txt), [run 36985524960](https://github.com/CrispStrobe/bw-board/actions/runs/36985524960).
- [Hosted 4 motion](hosted-ab-4/abba.json), [F0](hosted-ab-4/f0-abba/abba.json),
  [runner](hosted-ab-4/runner.txt), [run 36985753447](https://github.com/CrispStrobe/bw-board/actions/runs/36985753447).
- [VPS primary motion](vps-motion-primary.json), [F0](vps-f0-primary/abba.json).
- [VPS reverse motion](vps-motion-reverse.json), [F0](vps-f0-reverse/abba.json).
- [VPS motion repeat](vps-motion-repeat.json).

All four actual child timing stdout captures accompany each F0 receipt in its
numbered directories. Absolute child paths identify original capture locations,
not repository-relative links. Original comparison and build metadata files
remain byte-identical to the capture sources. The retained [verifier](verify-comparison.mjs)
and [pipeline tool](evaluate.mjs) identify their original local harness paths;
portable repository tests reparse the retained evidence independently.

## Code size, decision and next direction

The original-hash-bound [inspection](code-size-inspection.json) and retained
[inspection tool](inspect-code.mjs) show that ordinary register helpers remain
out of line. The large interpreter body is **77,390 → 77,388 bytes**, unlike
PR 149's expansion to 217,959. Fast-block shrinks **32,735 → 20,180 bytes
(−38.35%)**, cached-run **31,605 → 19,067 (−39.67%)**. The full module shrinks
27,556,189 → 27,513,580 bytes. Smaller generated code did not eliminate the
measured runtime/workload tradeoffs. Code sizes do not establish timing,
removable cost, startup cost or why the runtime results differ.

Decision: **do not land the narrower register variant**. Retain core PR 150
as draft with its source and complete evidence; do not re-stamp acknowledgements
to make a rejected optimization appear verified. No engine merge, app-pin change,
artifact publication or physical capture rewrite occurs. CP13/all-target ≥1×
remains open.

A useful next independent experiment is explicit post-link optimization of the
unchanged main artifact. The current builder invokes `cargo build --release`
and wasm-bindgen directly, not wasm-pack; package wasm-pack/wasm-opt metadata
does not execute in this path. Test a pinned optimizer in an opt-in build mode,
record its exact tool hash/version/flags and new artifact metadata, independently
check determinism, all actual integration tests and repeated ordinary floors.
Do not reuse original BUILD-INFO for transformed bytes or change publication
defaults. The earlier incomplete post-optimizer pilot was never qualified and
provides no timing evidence. This is a next experiment, not a promised speedup.
