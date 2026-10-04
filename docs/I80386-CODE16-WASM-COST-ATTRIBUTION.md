# Code16 WASM sampled-cost attribution: inconclusive

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

All 31 execution-source blobs on current master
matched the [earlier ordinary/code16 A/B](receipts/2026-09-28-i80386-code16-windows-current.json)
source inventory before the
temporary [probe patch](receipts/2026-09-28-i80386-code16-cost-probe.patch)
changed only the code16 dispatcher. The private input identifiers, step
count, selected reported guest fields and all six exact code16 retirement
counters match the earlier run. The selected fields do not include full RAM,
disk state or complete hidden CPU state.

The uninstrumented ordinary run took **78.52 user CPU seconds**; the earlier
uninstrumented code16 diagnostic took **392.05**. This instrumented run took
**371.36 user CPU seconds** and **469.32 wall seconds**. These are separate
runs under changing host load, so their differences do not measure timer
overhead or an improvement. The opt-in path still retired 5,042,482
instructions in 2,345,288 calls (2.15 per call) and fell back 54,957,518
times. It remains far slower than ordinary execution.

The probe sampled 223,839 of 57,302,806 dispatcher calls using a
multiplicative hash of call number, about one in 256. It timed eligibility,
cache lookup, decode/cache validation, preparation, state packing, the
actual WASM call, state commit and ordinary fallback stepping. Among those
**instrumented sampled calls**, decode/cache validation ranked first at
41.88% of measured sampled call time. Cache lookup was 6.40%, eligibility
11.12%, preparation 5.14%, fallback setup/step 5.32%/19.88%, state
pack/commit 0.85%/0.59%, and the WASM function itself 0.18%. Unassigned
timer bookkeeping and tail time account for the remainder. These figures
are **not whole-run CPU shares or removable costs**.

The simple 256× extrapolation of sampled dispatcher time is **750.2
seconds**, exceeding the observed 469.32-second whole-process wall time.
The sampled path's timer and bookkeeping cost, plus possible pause bias,
therefore distort the measurements. No absolute phase-time estimate or
Amdahl speedup follows from them. This experiment can only suggest which
functions merit a lower-distortion look; it cannot establish a winning
optimization. In particular, the tiny measured WASM-call slice does not
justify kernel tuning, and the workload's short blocks do not justify an
isolated opcode addition.

Before seeing the phase data, the retention gate was set as follows: only
investigate a phase if it appears to be at least 20% of dispatcher time
and a plausible 2× phase reduction could imply at least a 10% whole-run
gain. Any executable change would then require two alternating 60M A/B
pairs with matching selected reported guest fields, at least 10% mean
user-CPU gain and no individual regression. **The sampled data fail the
gate's measurement premise**, so no implementation is selected or retained.

The next measurement should use low-rate V8 CPU sampling, not per-call
timers, on the same pinned ordinary and opt-in sources. It should report
self samples for admission, code-window validation/decode, preparation,
ordinary fallback and WASM execution, and verify selected guest fields and
source blobs again. A paired unprofiled control would bound profiler
overhead and host drift. If code-window work remains a substantial
whole-run cost, test a cheaper validation/cache architecture behind the
same parity and paired-time gate. This tranche made one full sampled run
and no follow-up full run.

The media-neutral reducer is
[`scripts/summarize-i80386-code16-cost.mjs`](../scripts/summarize-i80386-code16-cost.mjs).
The probe patch is retained solely to reproduce this receipt; it is not
applied to the CPU, AT machine, CLI or GUI on this branch.

## Follow-on V8 CPU profile

The [lower-distortion receipt](receipts/2026-09-28-i80386-code16-v8-profile.json)
records four serial runs at execution revision
`55da2360a14e1aecb806d3867bd627351a48d115`: ordinary with a V8 CPU
profile, ordinary control, opt-in code16 diagnostic with a profile, and opt-in
control. The profiler requested a 5 ms sampling interval. All four reached
60 million steps with identical selected reported guest fields, private
inputs and the 31 reported execution-source hashes. The two opt-in runs also
match their decoded-block, native-call, native-retirement and fallback counts
exactly. The CLI source inventory omits the code-window module; the receipt
separately hashes that file from the execution revision. These checks retain
the earlier limit: no full RAM, disk or hidden CPU-state comparison.

| Run | User CPU | Wall | V8 self samples |
| --- | ---: | ---: | ---: |
| Ordinary profiled | 84.50 s | 87.04 s | 16,356 |
| Ordinary control | 82.71 s | 85.57 s | — |
| Opt-in profiled | 382.96 s | 502.74 s | 87,597 |
| Opt-in control | 398.92 s | 954.47 s | — |

The host was a four-vCPU virtual Intel Xeon Skylake with Node 20.20.2.
One-minute load average rose from 6.19 to 13.10 during the opt-in profile,
and from 13.41 to 17.15 during its control. Concurrent builds were visible
during the control. Its wall time is especially load-biased; these single
profile/control pairs cannot isolate profiler overhead or a causal speed
difference.

Before the runs, the sole architecture candidate was cheaper code-window and
cache admission. Its screening gate required at least 20% of **all opt-in
process self samples** in the code-window module plus `decodeBlock`, with
input/source/selected-guest parity. The candidate has **41,473 of 87,597
samples (47.35%)**: 34,767 (39.69%) in the code-window module and 6,706
(7.66%) in `decodeBlock`. Within the code-window module,
`prevalidateI80386Code16Window` alone has 33,277 samples (37.99%). The WASM
frame has 78 samples (0.09%); JS call-boundary cost can appear in its caller.
The ordinary interpreter and board, when reached below the opt-in dispatcher,
account for 20,283 samples (23.15%). These are sample counts, **not removable CPU
shares**; moving validation work elsewhere, preserving mutation checks, and
host contention can change the result.

The screening gate therefore admits one **prototype investigation**:
reduce repeated byte-array allocation and validation in code-window/cache
admission while preserving proof for guest writes, DMA and code mutation.
No executor change or speed claim follows from this receipt. Retention still
requires two alternating unprofiled 60M A/B pairs, matching selected guest
fields, at least 10% mean user-CPU gain and no individual regression. The
media-neutral reducer is
[`scripts/summarize-i80386-code16-v8-profile.mjs`](../scripts/summarize-i80386-code16-v8-profile.mjs);
raw profiles and guest reports remain private.

The screened [first-byte admission prototype](I80386-CODE16-WINDOW-ADMISSION.md)
subsequently passed its two-pair unprofiled retention gate for the opt-in
path: 370.94 to 259.56 seconds mean user CPU, with no pair regression.
