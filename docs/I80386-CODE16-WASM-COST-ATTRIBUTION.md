# Code16 WASM sampled-cost attribution: inconclusive

The [public receipt](receipts/2026-09-28-i80386-code16-sampled-cost.json)
reduces one sampled-timer run of the pinned private Windows 3.11
60-million-step workload. All 31 execution-source blobs on current master
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
