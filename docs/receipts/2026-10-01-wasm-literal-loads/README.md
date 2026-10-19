# WASM literal-load experiments (2026-10-01–02)

Baseline: landed core `43b2d62f5a0fa24ae0b38a645069f5aaa78af685`.
Original candidate: `7e1c2553c0ceace31cb390d31b629fc37b54990a`, on
`perf/wasm-literal-loads-20261001`. This candidate is **rejected for landing**:
correctness passed, but repeatable performance improvement did not.
No app pin, qualification floor, hardware capture or acknowledgement changed.

The candidate admits guarded T16 PC-relative literal loads in the bounded
cached run. Its low-linear word read declines MMIO/alias windows, overlapping
extra memory, disabled optimized bus access and read tracing, and preserves
RAM/flash/boot-alias precedence and read accounting. Native production dispatch
is unchanged. The native library suite passed **4,236 tests**, zero failures,
with three existing ignored tests; differential cases cover registers, PC
alignment, bus fallback and bounded-run retirement budgets.

## Same-runner comparisons

| Original candidate A/B/B/A | Baseline median / minimum | Candidate median / minimum | Median change |
| --- | --- | --- | --- |
| [Hosted first](https://github.com/CrispStrobe/bw-board/actions/runs/36921910178) | 0.820609 / 0.775324 | 0.815192 / 0.784489 | −0.66% |
| [Hosted repeat](https://github.com/CrispStrobe/bw-board/actions/runs/36922212282) | 0.823770 / 0.809792 | 0.689455 / 0.482601 | −16.30% |
| VPS first | 0.374882 / 0.194168 | 0.375593 / 0.318424 | +0.19% |
| VPS repeat | 0.430607 / 0.269166 | 0.455092 / 0.339779 | +5.69% |

Hosted runs used AMD EPYC 7763 and Node 22.23.3; VPS runs used Xeon Skylake
and Node 20.20.2. All eighty windows failed 1×. Cycle-indexed guest observations
match across all four processes within every comparison. VPS load drift and
the discordant hosted repeats do not support a speedup claim. A diagnostic
workflow success means valid evidence, **not** a passing realtime gate.

Raw receipts: [hosted first](hosted-1-abba.json), [hosted repeat](hosted-2-abba.json),
[VPS first](vps-primary.json), [VPS repeat](vps-repeat.json).
[First runner](hosted-1-runner.txt) and [repeat runner](hosted-2-runner.txt)
record actual hosts. Original glue is paired explicitly, not rewritten to
pretend its hashes match. Both source build records are retained for
[first baseline](hosted-1-baseline-build-info.json),
[first candidate](hosted-1-candidate-build-info.json),
[repeat baseline](hosted-2-baseline-build-info.json) and
[repeat candidate](hosted-2-candidate-build-info.json).
[Pipeline receipt](original-pipeline.json) binds source IDs and verdicts.

## Fresh qualifications are host-specific

Fresh landed-main [build 36915940413](https://github.com/CrispStrobe/bw-board/actions/runs/36915940413)
passed independent deterministic builds and **101 actual WASM integration tests**
with zero failures/skips. Motion functionality passed, but all five timing
windows failed: **0.775416× median / 0.769654× minimum** on EPYC 7763.
The module hash `7bd66fe4e926fbf14322621499f3fbddefefae763f61742c4c8c7312113b7a3d`
is byte-identical to the earlier measured fixed runtime source `2f5d9355`.
This fresh result supersedes the earlier 0.834235× / 0.808772× measurement as
the latest landed-main qualification here; it does not imply a code regression.
[Raw output](baseline-fresh-motion-results.txt),
[runner](baseline-fresh-motion-runner.txt), [build info](baseline-fresh-BUILD-INFO.json).

Original candidate [build 36915922464](https://github.com/CrispStrobe/bw-board/actions/runs/36915922464)
also passed deterministic builds and 101 integration tests without failures/skips.
Its five windows passed at **1.585183× median / 1.580895× minimum**, but on a
different **Intel Xeon 6973P-C** host. This is a selected-host result, not a
gain over main or all-host/all-chip qualification. Publication was explicitly
disabled for both builds. [Raw candidate output](candidate-fresh-motion-results.txt),
[runner](candidate-fresh-motion-runner.txt), [build info](candidate-fresh-BUILD-INFO.json).

## Compiler-policy follow-up

The original literal arm increased the old fast-block body by 381 bytes despite
that path retaining its admission filter. A separate experimental branch,
`perf/wasm-literal-specialization-20261001`, head
`e3656b23017c81071c176ffbdce415c222de2a63`, makes the existing checked executor
const-generic: bounded cached runs enable literals; old fast blocks disable
them at compile time. It does not duplicate the executor or widen debugger,
observer, interrupt or budget guards. Smaller WASM bodies alone are not
performance proof. Its native suite passed **4,237 tests**, zero failures,
three existing ignores; the additional test checks that the disabled policy
declines without changing CPU state or memory-read counts.

The specialized candidate is also **rejected for landing** after two negative
hosted comparisons completed on 2026-10-02:

| Specialized A/B/B/A | Baseline median / minimum | Candidate median / minimum | Median change |
| --- | --- | --- | --- |
| [Hosted first](https://github.com/CrispStrobe/bw-board/actions/runs/36958393317), EPYC 9V74 | 1.000298 / 0.985716 | 0.978005 / 0.951285 | −2.23% |
| [Hosted repeat](https://github.com/CrispStrobe/bw-board/actions/runs/36958517114), EPYC 7763 | 0.828190 / 0.807166 | 0.802622 / 0.748649 | −3.09% |
| VPS | 0.344414 / 0.192641 | 0.362518 / 0.235953 | +5.26% |

Both hosted runs used Node 22.23.3. The first baseline had five passing
individual windows, but neither engine passed the **every-window** floor in
either comparison. All observations match within each comparison. VPS load
drift was severe: baseline process medians changed from 0.420675× to 0.200893×;
the positive pooled ratio is not reliable evidence of a gain. Raw evidence:
[first](specialized-hosted-1-abba.json), [repeat](specialized-hosted-2-abba.json),
[VPS](specialized-vps.json); [first runner](specialized-hosted-1-runner.txt),
[repeat runner](specialized-hosted-2-runner.txt).
[Specialized pipeline](specialized-pipeline.json) retains exact references and
build hashes; its source records also have separate copies for
[first baseline](specialized-hosted-1-baseline-build-info.json),
[first candidate](specialized-hosted-1-candidate-build-info.json),
[repeat baseline](specialized-hosted-2-baseline-build-info.json) and
[repeat candidate](specialized-hosted-2-candidate-build-info.json).

Specialized [build 36921096974](https://github.com/CrispStrobe/bw-board/actions/runs/36921096974)
passed independent builds, determinism and 101 actual integration tests with
zero failures/skips. Functionality passed; all five fresh windows failed on
EPYC 9V74: **0.757706× median / 0.749203× minimum**. Publication stayed disabled.
[Raw output](specialized-fresh-motion-results.txt),
[runner](specialized-fresh-motion-runner.txt), [build info](specialized-fresh-BUILD-INFO.json).

Read-only inspection of the verified WASM code-section bodies found these
sizes (bytes, including locals):

| Source | `step_batch` | `run_t16_fast_block` | `run_t16_cached_run` |
| --- | ---: | ---: | ---: |
| Landed baseline `43b2d62f` | 77,390 | 32,735 | 31,605 |
| Original `7e1c2553` | 77,284 | 33,116 | 32,005 |
| Specialized `e3656b23` | 77,388 | 32,772 | 32,019 |

Specialization mostly removed the fast-block growth, but did not improve
measured throughput. Function indices were 73, 77 and 78 in all three modules;
names came from the WASM name section. Module hashes and exact source are
bound by the retained build info. Raw body hashes include relocated indices
and are not semantic-equivalence proofs. The original hosted repeat contains
one particularly slow candidate process; its −16.30% pooled result is retained
without claiming that the entire slowdown is caused by the code change.

Both original and specialized WEB artifacts passed the current clean
BrickwrightLite `24fdffc85e7a9074611dbca0603c016f45bbc060` generic input-route
proof: **4 passed, zero failures/skips** each. This used an explicit BW source
override, unchanged runtime sources relative to tooling head
`1cac10ba28ddd5e71c5a7e32437a3b0080d47f14`, not the shipping app dependency.
The fixture is an STM32F0 factory with two held ADC inputs; it proves atomic
route writes and recording/replay, **not guest execution, browser RTx or UI
qualification**. No package pin was promoted.

## Remaining work

CP13 remains open. Main still needs every-window Node qualification followed
by browser/worker guest and debugger acceptance. These 64 MHz micro:bit motion
measurements do not establish STM32F0 48 MHz RTx or all-target speed. Physical
re-capture remains owed for the seven previously approved main acknowledgements;
this experiment neither refreshes them nor changes their 2026-10-31 expiry.

Next useful work is a separate, baseline-derived profile of bus reads and
fast-path admission, plus a repeatable STM32F0 48 MHz timing fixture. Do not
stack either rejected literal change onto that baseline. Keep ordinary timing
separate from sampled/forced-tier runs, and require differential correctness,
exact-artifact integration and repeated same-runner A/B before landing.
