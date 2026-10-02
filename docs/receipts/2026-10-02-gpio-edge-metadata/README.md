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

## Exact ordinary comparisons

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
