# WASM GPIO edge-metadata experiment — 2026-10-02

This is a targeted optimization, not an all-target or browser qualification.
Core [PR 147](https://github.com/CrispStrobe/labwired-core/pull/147) introduces
a Vec-compatible resident-device owner. WASM caches **absence** of edge hooks
only when every resident explicitly declares stable metadata; currently only
Button opts in. Mutable access invalidates the cache, unknown models remain
live-scanned, and native production keeps its original scan policy. No MMIO
values, peripheral transitions, clock gates, IRQs or device services are cached
or suppressed. The Rust field type changes; explicit Vec assignment now needs
`.into()`. WASM exports and snapshot formats do not change.

## Prototype exact ordinary comparisons

These four comparisons measure the prototype, not the final lint-fixed head.
Baseline source: `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`,
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
Measured candidate source: `d74f658985fa1a4524f185b1ccbf56e4592941fc`,
[build 36962432950](https://github.com/CrispStrobe/bw-board/actions/runs/36962432950).
Both independent builds, determinism and 101 actual WASM integration tests
passed with zero skips. Both fresh motion floors failed; publication was skipped.
Comparisons use each build's original JS glue, explicitly opting into paired
glue. Sources, JS/WASM hashes and lengths were checked against BUILD-INFO.

All comparisons run ordinary A/B/B/A, pooling ten windows per label/workload.
Motion and F0 are separate tests. No CPU sampling, forced-tier settings,
browser, circuit solver, observers or debugger is timed. Every loaded F0 image
and cycle-indexed guest observation matches within its comparison; motion
observations also match. The tool ref is
`814609c32059a582bb789cf68c62e7e2f35eff98`. Node is 22.23.3 throughout.

| Run / host | F0 GPIO baseline → candidate median | GPIO gain | RAM gain | Motion gain |
| --- | --- | --- | --- | --- |
| [36963187913](https://github.com/CrispStrobe/bw-board/actions/runs/36963187913), EPYC 7763 | 0.656062× → 0.770614× | +17.46% | −0.82% | −3.07% |
| [36963306422](https://github.com/CrispStrobe/bw-board/actions/runs/36963306422), Xeon 8370C | 0.752240× → 0.859119× | +14.21% | −0.49% | −0.07% |
| [36963791657](https://github.com/CrispStrobe/bw-board/actions/runs/36963791657), EPYC 9V45 | 1.356676× → 1.507030× | +11.08% | −2.39% | +1.18% |
| [36964503386](https://github.com/CrispStrobe/bw-board/actions/runs/36964503386), EPYC 7763 repeat | 0.647649× → 0.752402× | +16.17% | +0.17% | +3.43% |

GPIO improves in all four comparisons. Motion has mixed results and RAM is
mostly slightly negative; neither is a claimed speedup. The second EPYC 7763
run does not reproduce the first run's motion regression. These are shared
hosts, not interchangeable absolute rates or statistical proof of no regression.
The fast third host passes every motion and F0 window **even on the baseline**;
it cannot establish that this optimization alone makes the target realtime.
The first, second and fourth runs still fail every GPIO and motion window.
RAM passes every window on all four. The unchanged floor is **every window ≥1×**,
not median.

## Raw evidence and reproduction

Each `hosted-N/` directory preserves byte-identical uploaded
`motion-abba.json`, `f0-abba.json`, `runner.txt` and both BUILD-INFO receipts.
The ABBA files contain every raw timed window and all guest observations;
the F0 file also retains all four verified child receipts. Raw F0 stdout for
all sixteen captures is committed alongside it. Complete uploaded
artifacts include stderr and are subject to GitHub's 14-day
retention. The local evidence root is `.gpio-edge-evidence.hr82lw` on the VPS.
Sixteen F0 stdout captures were reparsed against the strict parser,
and all 36 committed raw files were byte-compared to downloaded originals.

## Independent prototype attribution

[Run 36965058001](https://github.com/CrispStrobe/bw-board/actions/runs/36965058001)
profiles the original candidate artifact separately, on Xeon 8573C / Node
22.23.3. Its [F0 receipt](prototype-profile/f0-receipt.json) keeps ordinary
timing separate from sampling; [ordinary](prototype-profile/f0-ordinary.txt)
and [sampled](prototype-profile/f0-sampled.txt) raw stdout are retained.
The edge-scan helper has 31 self samples / 32,953 µs out of 6,076,952 sampled
µs (**0.54%** whole-process self share). This is not a same-host profile A/B,
isolated GPIO cost or a removable-cost percentage. The three Cortex-M execution
functions dominate the remaining attribution; bus reads/writes and GPIO
register processing remain visible. The separate
[motion extract](prototype-profile/motion-profile-extract.json) retains
unsampled compiler-tier evidence and hash-bound independent sampling.

Next experiments should investigate admission/dispatch and bus-access work
without caching live MMIO values, dropping side effects or weakening timing,
interrupt and debugger guards. This profile does not by itself establish a gain.

## Rebuilt artifact comparisons and final-head verification

The measured lint-fixed artifact source is `7f1c295c11d882dd6a5b3fa18fd762f167190ea0`.
Its [build 36964690092](https://github.com/CrispStrobe/bw-board/actions/runs/36964690092)
passed both build legs, determinism and all 101 actual WASM integration tests
with zero skips. The explicit cache-field initialization changed module
bytes, so the prototype comparisons are **not** reused as final-artifact proof.
The verified NODEJS and web module hash is
`0405f0169379dee9f18229e127556f88a61c40675e7882ba8eb41334b5fcbcd6`;
[BUILD-INFO](verified-artifact/BUILD-INFO.json) retains original glue hashes and
lengths. Fresh motion qualification passed functionality but failed all five
1× windows: **0.807894× median / 0.797765× minimum**, EPYC 7763. Raw
[results](verified-artifact/fresh-motion-results.txt) and
[runner](verified-artifact/fresh-motion-runner.txt) are retained. Publication
was skipped. Three new ordinary comparisons were gated on correctness
checks, using the same immutable A/B tooling as the prototype comparisons.

| Run / host | F0 GPIO baseline → candidate median | Candidate GPIO minimum | GPIO gain | RAM gain | Motion gain |
| --- | --- | --- | --- | --- | --- |
| [36966063542](https://github.com/CrispStrobe/bw-board/actions/runs/36966063542), Xeon 8573C | 0.967689× → 1.066382× | 1.039588× | +10.20% | −0.66% | +0.40% |
| [36966537023](https://github.com/CrispStrobe/bw-board/actions/runs/36966537023), EPYC 9V74 | 0.784693× → 1.045852× | 1.026665× | +33.28% | −1.31% | +1.09% |
| [36967186499](https://github.com/CrispStrobe/bw-board/actions/runs/36967186499), EPYC 9V74 repeat | 0.609309× → 0.795597× | 0.781405× | +30.57% | +1.97% | +0.02% |

All twenty candidate GPIO windows in the first two comparisons pass the
unchanged 1× floor; **all ten fail in the third comparison**. All baseline
GPIO captures fail that floor. Shared-host speed varies even under the same CPU
name; absolute medians must not be pooled across hosts. RAM passes all windows
for both labels. Motion passes on the first host but still fails the floor on the second
(candidate median 0.995042× / minimum 0.984150×) and third (0.773914× / 0.742910×).
No universal realtime, browser,
RAM or motion speedup is claimed. All observations match in both protocols.
Raw originals and all twelve F0 stdout captures are retained in `rebuilt-1/`,
`rebuilt-2/` and `rebuilt-3/`, separately from the four prototype comparisons.
The first two use the verified lint-fixed artifact; the third uses the
byte-identical latest-head artifact below, with its own original BUILD-INFO.

Latest source `77b2b54270809765466131413c049bb0a0a30d7e` additionally updates
the debugger collection scanner's source-test marker to recognize the wrapper;
it does not relax the requirement to walk every collection. Its exact rebuild
[36966049317](https://github.com/CrispStrobe/bw-board/actions/runs/36966049317)
passed both build legs, determinism and all 101 actual WASM integration tests
with zero skips. Both original NODEJS and web JS/WASM hashes and lengths match
the measured rebuilt artifact exactly; actual downloaded bytes were checked
against [latest-head BUILD-INFO](latest-head/BUILD-INFO.json).
Its fresh motion run still failed all five windows (**0.817207× median /
0.811487× minimum**, EPYC 7763); [raw results](latest-head/fresh-motion-results.txt)
and [runner](latest-head/fresh-motion-runner.txt) are preserved, publication
skipped. All latest-head enabled native CI checks must pass before runtime
landing. Native CI and landing status remain pending.

```sh
env -u NODE_OPTIONS node scripts/probe-labwired-f0-ab.mjs \
  --baseline /absolute/path/to/baseline/nodejs \
  --candidate /absolute/path/to/candidate/nodejs \
  --out /absolute/path/to/new-evidence-directory --paired-glue
```

Both nodejs directories must retain their original parent BUILD-INFO.json.
Existing output directories and identical modules are refused. On GitHub,
`labwired-motion-ab.yml`'s optional `f0=true` runs this separate capture after
the existing motion comparison. Successful diagnostic workflow completion
does not override failed floor verdicts. See the
[F0 timing guide](../../LABWIRED-F0-TIMING.md) for guest accounting and limits.

App engine pins and published packages remain unchanged. No physical capture
or hardware acknowledgement was rewritten. The generated C6 smoke-only digest
refresh is not silicon evidence. Existing hardware re-capture debt and CP13
remain open. Final-head verification and landing status will be recorded here
only after their actual results are available.
