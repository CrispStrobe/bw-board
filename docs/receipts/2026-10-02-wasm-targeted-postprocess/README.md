# Targeted post-link recipes: correct in tested coverage, not production-qualified

Both recipes reproduce their module bytes on independent runners and pass all
101 actual-WASM integration tests with zero failures/skips. They improve hosted
RAM medians, but motion/GPIO remain mixed and both have repeated VPS RAM
regressions. **Neither recipe is enabled in production.** The all-target ≥1×
goal remains open; a passing median or one faster hosted machine does not waive
any failing window or qualify a workload-wide speedup.

## Immutable source and build provenance

All artifacts use unchanged core `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`.
Original build [36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413)
uses tooling `1cac10ba28ddd5e71c5a7e32437a3b0080d47f14`.
Both new build runs use tooling `d46e006696b6f10f693069eb07b19e9854b34dd0`,
with Binaryen 123 archive/executable hashes pinned. Node/web glue is unchanged,
original metadata is hash-bound and preserved separately, and each new metadata
file identifies the mode and full ordered flags. ABI/module validation guards
are not an instruction-equivalence proof. No fast-math or implicit-trap relaxation
is enabled. See [the closed recipes and pinned upstream definitions](../../LABWIRED-WASM-POSTPROCESS.md#targeted-follow-up-recipes).

| Recipe | Independent build run | Fresh motion median / minimum | All five fresh windows ≥1× |
| --- | --- | --- | --- |
| instructions | [36997820482](https://github.com/CrispStrobe/bw-board/actions/runs/36997820482) | 1.017790 / 1.001569 | yes |
| locals | [36997847752](https://github.com/CrispStrobe/bw-board/actions/runs/36997847752) | 0.832599 / 0.827190 | no |

Both build legs, determinism and integration passed for each recipe. The locals
run's overall failure is its real motion-floor failure, not failed integration.
The fresh instruction pass is genuine but **not** a paired speed comparison;
its subsequent paired motion measurements are mixed and fail the floor.

| Module | Bytes | SHA-256 |
| --- | ---: | --- |
| Original | 27,556,189 | `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d` |
| instructions | 25,441,281 | `75259e18b9eeedbae6857ee183c868692105aeacfefa751eed3e336e2f2bff58` |
| locals | 25,387,075 | `98791ce73f5a55cc01c32de182f298858b8b5d4f3b9368cb9e454210e1e25337` |

## Measurement protocol

Every comparison uses ordinary immutable harness tooling
`fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, with profiling disabled.
Each hosted comparison runs both original artifacts sequentially on one runner,
retaining ten windows per artifact/workload, actual guest observations, runtime,
CPU, module/glue hashes and failed floors. Comparisons 1/2 use Node 20.20.2,
3/4 Node 22.23.3. Odd comparisons use ABBA (baseline/candidate/candidate/baseline);
even ones BAAB. Hosts are not pooled or treated as a controlled runtime/CPU study.

All eight VPS comparisons run sequentially on Node 20.20.2, Xeon Skylake
IBRS/no TSX, without owned compilation, optimization, profiling or overlapping
benchmarks. Other-project load is uncontrolled; it is not grounds for discarding
negative results. Values below are RTx median / minimum; changes compare paired
medians. `primary` is ABBA and `reverse` BAAB.

## instructions results

| Comparison | CPU | Original hosted run |
| --- | --- | --- |
| 1 | AMD EPYC 7763 64-Core Processor | [36998501805](https://github.com/CrispStrobe/bw-board/actions/runs/36998501805) |
| 2 | AMD EPYC 9V74 80-Core Processor | [36998730927](https://github.com/CrispStrobe/bw-board/actions/runs/36998730927) |
| 3 | AMD EPYC 7763 64-Core Processor | [36998953228](https://github.com/CrispStrobe/bw-board/actions/runs/36998953228) |
| 4 | AMD EPYC 7763 64-Core Processor | [36999180720](https://github.com/CrispStrobe/bw-board/actions/runs/36999180720) |

| Comparison | Workload | Original median / minimum | Candidate median / minimum | Change |
| --- | --- | --- | --- | ---: |
| 1 | motion | 0.613566 / 0.601809 | 0.599223 / 0.581705 | -2.34% |
| 1 | ram | 2.858429 / 2.826238 | 2.898806 / 2.856326 | 1.41% |
| 1 | gpio | 0.542430 / 0.535601 | 0.585855 / 0.517118 | 8.01% |
| 2 | motion | 0.850076 / 0.836913 | 0.852184 / 0.818262 | 0.25% |
| 2 | ram | 3.849147 / 3.812202 | 3.939733 / 3.854242 | 2.35% |
| 2 | gpio | 0.721356 / 0.718918 | 0.728498 / 0.719978 | 0.99% |
| 3 | motion | 0.807741 / 0.793340 | 0.834857 / 0.804637 | 3.36% |
| 3 | ram | 2.814001 / 2.700685 | 3.001894 / 2.589876 | 6.68% |
| 3 | gpio | 0.647323 / 0.591581 | 0.639046 / 0.619468 | -1.28% |
| 4 | motion | 0.818406 / 0.804625 | 0.808161 / 0.776654 | -1.25% |
| 4 | ram | 2.862882 / 2.644824 | 3.033614 / 2.921398 | 5.96% |
| 4 | gpio | 0.621452 / 0.598162 | 0.620763 / 0.608364 | -0.11% |

| VPS workload/order | Original median / minimum | Candidate median / minimum | Change |
| --- | --- | --- | ---: |
| motion primary | 0.349863 / 0.231486 | 0.337551 / 0.229082 | -3.52% |
| ram primary | 1.278351 / 1.085425 | 1.068988 / 0.767902 | -16.38% |
| gpio primary | 0.249609 / 0.173901 | 0.279315 / 0.132534 | 11.90% |
| motion reverse | 0.282894 / 0.220868 | 0.254689 / 0.182453 | -9.97% |
| ram reverse | 1.358004 / 0.838560 | 1.231595 / 0.604342 | -9.31% |
| gpio reverse | 0.230035 / 0.184523 | 0.247468 / 0.187730 | 7.58% |

## locals results

| Comparison | CPU | Original hosted run |
| --- | --- | --- |
| 1 | AMD EPYC 7763 64-Core Processor | [36998450914](https://github.com/CrispStrobe/bw-board/actions/runs/36998450914) |
| 2 | AMD EPYC 9V74 80-Core Processor | [36998677901](https://github.com/CrispStrobe/bw-board/actions/runs/36998677901) |
| 3 | AMD EPYC 7763 64-Core Processor | [36998899550](https://github.com/CrispStrobe/bw-board/actions/runs/36998899550) |
| 4 | AMD EPYC 9V45 96-Core Processor | [36999125561](https://github.com/CrispStrobe/bw-board/actions/runs/36999125561) |

| Comparison | Workload | Original median / minimum | Candidate median / minimum | Change |
| --- | --- | --- | --- | ---: |
| 1 | motion | 0.637113 / 0.633607 | 0.631476 / 0.605060 | -0.88% |
| 1 | ram | 2.849071 / 2.832419 | 2.934456 / 2.600643 | 3.00% |
| 1 | gpio | 0.552177 / 0.519044 | 0.559689 / 0.525687 | 1.36% |
| 2 | motion | 0.857173 / 0.851153 | 0.879111 / 0.864718 | 2.56% |
| 2 | ram | 3.777341 / 3.496902 | 3.994404 / 3.928998 | 5.75% |
| 2 | gpio | 0.726991 / 0.718136 | 0.724701 / 0.717408 | -0.31% |
| 3 | motion | 0.817309 / 0.774098 | 0.826591 / 0.815533 | 1.14% |
| 3 | ram | 2.864866 / 2.805037 | 3.031180 / 2.864732 | 5.81% |
| 3 | gpio | 0.635194 / 0.590937 | 0.654118 / 0.617760 | 2.98% |
| 4 | motion | 1.576991 / 1.550400 | 1.525124 / 1.418563 | -3.29% |
| 4 | ram | 6.833874 / 6.481277 | 7.726694 / 7.146896 | 13.06% |
| 4 | gpio | 1.376546 / 1.110525 | 1.359068 / 1.303030 | -1.27% |

| VPS workload/order | Original median / minimum | Candidate median / minimum | Change |
| --- | --- | --- | ---: |
| motion primary | 0.219925 / 0.157400 | 0.207472 / 0.148559 | -5.66% |
| ram primary | 1.675867 / 0.869700 | 1.443401 / 0.995484 | -13.87% |
| gpio primary | 0.337264 / 0.251274 | 0.233956 / 0.175361 | -30.63% |
| motion reverse | 0.367049 / 0.340803 | 0.377859 / 0.289354 | 2.95% |
| ram reverse | 1.442442 / 0.999627 | 1.430331 / 1.071657 | -0.84% |
| gpio reverse | 0.267348 / 0.188760 | 0.331427 / 0.236622 | 23.97% |

## Decision and floor details

Instruction cleanup's hosted RAM medians improve 1.41–6.68%, but hosted motion
ranges −2.34% to +3.36%, GPIO −1.28% to +8.01%. VPS RAM loses 16.38% / 9.31%
and motion 3.52% / 9.97% in the two orders. Forward VPS RAM changes from every
baseline window passing to a candidate minimum of **0.767902×**, despite a
passing candidate median. All instruction paired motion/GPIO floors fail.

Locals cleanup's hosted RAM medians improve 3.00–13.06%, while hosted motion
ranges −3.29% to +2.56% and GPIO −1.27% to +2.98%. VPS forward RAM/GPIO lose
13.87% / 30.63%; reverse RAM loses 0.84% while GPIO gains 23.97%. Reverse VPS
RAM's candidate floor passes (minimum 1.071657×), unlike the baseline minimum
0.999627×, but this does not erase other workload/order regressions.

Hosted locals comparison 4 on EPYC 9V45 genuinely meets every motion, RAM and
GPIO window on **both** artifacts; its candidate motion/GPIO medians still
regress. Other locals hosted motion/GPIO floors and all VPS motion/GPIO floors
fail. All hosted RAM floors pass for both recipes/artifacts. Do not describe
these limited fixtures as all supported targets, a portable phone/browser
performance guarantee, or completion of the ≥1× goal.

Only the manual selector tooling landed in [PR #232](https://github.com/CrispStrobe/bw-board/pull/232),
after all ten enabled checks passed. No ordinary builder/defaults, core source,
publication or app pins changed. No hardware drift acknowledgement or physical
capture changed; their existing expiry/recapture obligations remain intact.

## Rechecking

`EVIDENCE-SHA256.json` binds 334 original evidence files, including module/build
metadata, source-run/jobs, optimizer runner details, ordinary child stdout,
launchers, comparison receipts, integration/floor logs and collection scripts.
Files without a final newline are preserved in reversible `.base64.json`
wrappers rather than normalized; the manifest and tests verify both wrapper and
exact decoded-original hashes/lengths. Other files are byte-identical copies.
Raw logs deliberately retain their original whitespace. Original collector paths
are provenance, not portable commands to rerun or overwrite these receipts.

Portable tests bind recipe/source/tooling identities, compare guest observations,
reparse actual stdout and recompute every median/minimum/floor and receipt hash:

```sh
node --test test/wasm-targeted-postprocess-evidence.test.mjs test/wasm-postprocess.test.mjs
```

Next meaningful optimization work should profile the ordinary Cortex-M
interpreter/MMIO path and test a small localized source change, rather than
promote or silently stack these rejected whole-module recipes. Browser/UI and
other-target qualification remain separate work; no result here qualifies an
untested future variant.
