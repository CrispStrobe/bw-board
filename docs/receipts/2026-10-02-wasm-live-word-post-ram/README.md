# Post-RAM live-word admission: mixed results, unqualified

The four ordinary hosted pairs do not qualify this source change. GPIO median
improves in all four pairs (+2.87% to +8.20%), but motion and RAM each regress
in two or more pairs. Node 22 BAAB motion minimum falls from 0.756411× to
0.509397×; Node 22 ABBA RAM median falls 7.94%. No production source, app pin,
published engine or physical drift acknowledgement changes. The seven existing
2026-10-31 expiries and physical captures are unchanged; hardware re-capture
remains owed. CP13 and the all-target ≥1× goal remain open.

## Isolated source and correctness

Baseline is current core main `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`, original
[build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413).
Candidate `ea0919b1923433f46c7d3a0399727b37ec152937`, original
[build 37042450045](https://github.com/CrispStrobe/bw-board/actions/runs/37042450045),
moves the identical live word-address query after existing RAM-loop execution,
only when that path returns zero progress. Successful folded RAM loops avoid
the extra query; this source-level rationale is not a measured speedup claim.
Native production dispatch and existing observer/debugger/IRQ/scheduler guards
remain unchanged. Live RAM bounds/registers are consulted without caching a
dynamic rejection. Rejected optimizer/literal/register changes are not stacked.

[Native tests 37040163648](https://github.com/CrispStrobe/labwired-core/actions/runs/37040163648)
pass existing T16 tests and four new zero-return invariants: rotated canonical
MMIO/unmapped words, malformed/cold/collided/wide entries, applicable canonical
RAM-code SMC refusal, and zero-budget/disabled-cache entries. The tests compare
CPU/RAM/access counts/cycles/cache contents/saved entry state. Arbitrary sleeping
RAM paths and valid retired prefixes are not falsely asserted to return zero.

Both source builds pass independent byte determinism. Baseline passes exactly
**101** actual-WASM integration tests; candidate passes the expanded **108**,
including all seven same-PC RAM→GPIO→RAM/alignment/bounds cases. Candidate guest
image SHA-256 is `60fcba1c8ab4b3bfb835acd755d10253acaf817bfb7a9c979928e316f8d2427f`,
STR/LDR PCs 0x08000060/0x08000062, safe interval 1024, five phases and 1572 loops
for budgets 1/7/8/16/31/64/257. This is the new candidate's actual integration
proof, not the older selective candidate's separate 7+7 job. It proves deployed
semantics, not fast-path hit counts, arbitrary IRQ interleavings or RTx.

Both separate fresh motion floors fail. Candidate fresh median/minimum are
**0.758882× / 0.749085×**.
Overall build workflow failure and skipped publishing are retained faithfully.
Candidate builder tool `d1f2c8ebfc5e4e76d5fc81f930588c13de13e974` differs only in its
test gate from the old frozen tool; the build script is unchanged. Ordinary
paired acceptance uses unchanged frozen `fb13d48b7bc377bceb5da5a1d4ed5cd11555e162`, pinned Node runtimes,
each original module/glue, no forced tiers/profiling/census/extra optimizer.

| Original artifact | WASM SHA-256 | Glue SHA-256 |
| --- | --- | --- |
| baseline | `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d` | `b93d7f484286d64ae8f19d86bf67eb8d4309cf49720cbb06f59557c401b7ad73` |
| candidate | `f5231e69301de1be22426adf7ff31f4515df1698d4bbccad8c4f5628d0a66f63` | `339deaca58b4c5a5319f95168b8356a9d0b495905383d1d2166e527c8f2cb3cd` |

## Every measured gain, loss and floor

Values are median / minimum RTx; Δ compares medians. Each row retains ten
windows per artifact on the same runner. Every measured window must meet ≥1×.
Different rows use different CPUs and do not establish Node-version effects
or post-RAM-versus-selective placement causality. No confidence interval or
statistical significance is claimed. These are selected active F0 RAM/GPIO
and micro:bit motion workloads scaled by engine cycles at nominal 48/64 MHz,
not silicon CPI calibration, all targets, browser/UI/circuit/debugger speed or
physical behavior qualification.

| Runtime/order | Guest | Baseline | Candidate | Median Δ | Floor baseline / candidate |
| --- | --- | --- | --- | --- | --- |
| Node 20.20.2 ABBA | motion | 0.595389 / 0.548191 | 0.655027 / 0.645284 | +10.02% | fail / fail |
| Node 20.20.2 ABBA | RAM | 2.829985 / 2.722515 | 2.841464 / 2.765065 | +0.41% | pass / pass |
| Node 20.20.2 ABBA | GPIO | 0.561357 / 0.554974 | 0.607390 / 0.589209 | +8.20% | fail / fail |
| Node 20.20.2 BAAB | motion | 0.863658 / 0.837618 | 0.845094 / 0.758987 | -2.15% | fail / fail |
| Node 20.20.2 BAAB | RAM | 3.845417 / 3.653599 | 3.810556 / 3.772580 | -0.91% | pass / pass |
| Node 20.20.2 BAAB | GPIO | 0.720538 / 0.717714 | 0.758083 / 0.754059 | +5.21% | fail / fail |
| Node 22.23.3 ABBA | motion | 1.561824 / 1.408634 | 1.608083 / 1.489986 | +2.96% | pass / pass |
| Node 22.23.3 ABBA | RAM | 5.244254 / 5.134191 | 4.827674 / 4.320930 | -7.94% | pass / pass |
| Node 22.23.3 ABBA | GPIO | 1.292341 / 1.158204 | 1.329425 / 1.247580 | +2.87% | pass / pass |
| Node 22.23.3 BAAB | motion | 0.776954 / 0.756411 | 0.767854 / 0.509397 | -1.17% | fail / fail |
| Node 22.23.3 BAAB | RAM | 3.068636 / 2.996215 | 3.062402 / 2.924849 | -0.20% | pass / pass |
| Node 22.23.3 BAAB | GPIO | 0.611127 / 0.600587 | 0.657277 / 0.605308 | +7.55% | fail / fail |

| Runtime/order | CPU model | Hosted run |
| --- | --- | --- |
| Node 20.20.2 ABBA | AMD EPYC 7763 64-Core Processor | [37044289314](https://github.com/CrispStrobe/bw-board/actions/runs/37044289314) |
| Node 20.20.2 BAAB | AMD EPYC 9V74 80-Core Processor | [37044647612](https://github.com/CrispStrobe/bw-board/actions/runs/37044647612) |
| Node 22.23.3 ABBA | Intel(R) Xeon(R) 6973P-C | [37045021314](https://github.com/CrispStrobe/bw-board/actions/runs/37045021314) |
| Node 22.23.3 BAAB | AMD EPYC 9V74 80-Core Processor | [37045248021](https://github.com/CrispStrobe/bw-board/actions/runs/37045248021) |

## Evidence and next step

`manifest.json` binds 115 original/reversibly wrapped files:
immutable config/controller, native/build/integration/floor logs and metadata,
four paired run/artifact receipts, and all 32 ordinary children / 240 windows.
Portable tests reparse raw measurements and compare medians, minima, floors,
guest observations, signals, wrapper exits and original build hashes.

No local engine download/build/profile/benchmark occurred. At 18:13 UTC the
four-CPU VPS load was 16.45/14.48/12.32, available memory 2718 MiB and workspace
disk free 1.9 GB, so agents and heavy local tasks were refused. Missing VPS
repeats are not passes. Keep this source unmerged and physical acknowledgements
unchanged. Further source work needs profile-backed justification and its own
correctness plus repeated ordinary acceptance; do not stack mixed variants or
relax the ≥1× floor to manufacture qualification.
