# WASM interpreter outlining: rejected experiment

Exact core baseline `4deee6f04266a73d0d2696cacfb2eac0b29aed84`, outlined
candidate `614cc64b6e5b12f66ce026bad289a590aa42dbf2`. Only WASM interpreter
inlining changed; native policy stayed unchanged. [Core PR 144](https://github.com/CrispStrobe/labwired-core/pull/144)
is closed without merging. No deployed pin, qualification floor or hardware
capture/acknowledgement was changed for this experiment.

| Exact-artifact hosted A/B/B/A | Baseline median / min | Candidate median / min | Median change |
| --- | --- | --- | --- |
| [Primary](https://github.com/CrispStrobe/bw-board/actions/runs/36864571206) | 0.890428 / 0.873132 | 0.822047 / 0.809757 | −7.68% |
| [Independent repeat](https://github.com/CrispStrobe/bw-board/actions/runs/36866493155) | 0.730047 / 0.713244 | 0.698151 / 0.686552 | −4.37% |

All forty windows were below 1×. Both engines ran on the same EPYC 9V74 runner
within each comparison; do not compare absolute speeds across runs. The motion
harness, guest and all-window floor were unchanged. Both original glue hashes
matched. Each receipt contains all four raw process outputs and twenty samples:
[primary](primary-abba.json), [repeat](repeat-abba.json). Runner metadata:
[primary](primary-runner.txt), [repeat](repeat-runner.txt).
Re-parsing both receipts with the stronger comparison confirmed that all
cycle-indexed guest observations match across their four runs. Full ELF hashes
vary because GCC embeds random temporary-object names in non-loaded symbol
metadata; those hashes remain provenance, not a byte-equality claim.

Fresh independent builds [baseline 36862730233](https://github.com/CrispStrobe/bw-board/actions/runs/36862730233)
and [candidate 36863052371](https://github.com/CrispStrobe/bw-board/actions/runs/36863052371)
passed determinism and all 101 existing integration tests, with zero skipped.
Motion functionality passed, but the realtime floors failed; publication was
skipped. Those separate runners are not paired performance evidence.

## What profiling actually showed

The primary run collected default traces and CPU profiles **after** ordinary
A/B/B/A. [Selected receipt fields and hashes](profile-extract.json) are retained
here; full raw traces and CPU profiles remain in that run's uploaded evidence
artifact and the local evidence directory, not in this repository extract.

Default traces show the baseline `CortexM::step_batch` body (77,465 bytes)
already reaches TurboFan: 97 ms compile time in the unsampled trace. Outlining
reduced that body to 8,753 bytes (13 ms TurboFan compile) and added a 35,460-byte
`step_internal` body (33 ms compile). **Smaller functions and faster compilation
did not improve steady-workload throughput.**

Whole-process baseline self-samples attributed about 46.3% to `step_batch`,
8.1% to the T16 fast block, 7.9% to bus `read_u32`, and 4.0% to read-level
reconciliation. These include initialization and warmup, not just timed guest
windows; they identify investigation targets, not removable overhead.

The old profiling tool (`c0e6e369`) requested Liftoff with
`--liftoff --no-wasm-tier-up`, but its traces contain both Liftoff and TurboFan.
Those receipts must **not** be interpreted as baseline-only runs. The tool is
corrected to use `--liftoff-only`, disable dynamic tiering, and fail on any
contradictory compiler record while preserving raw evidence first. Ordinary
A/B, default traces and sampling results are independent of this flag mistake.
Forced or sampled timings are never qualification results.

Next experiment: reuse the existing guarded cached T16 scalar executor, from
the original baseline rather than stacking the rejected outlining change.
This remains experimental until differential, actual WASM and repeated A/B
checks pass; no speedup is claimed here.
