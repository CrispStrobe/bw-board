# Native-only cold-BIOS performance arm — source preparation

This unqualified source draft implements two closed modes for the fixed cold
reset → before F000:E16 slice. It neither executes nor qualifies a guest by
itself. The source-owned capture binding remains PENDING, refusing execution
before compiled module import, factory construction or addon loading. A separately
reviewed successful one-Q diagnostic and independent audit must pin their bytes,
driver identity and actual target Q. Failed diagnostic attempts and the ordinary
JS census are not performance baselines or valid target-Q authorities.

The worker uses the fixed no-argument compiled provider and original ABI4 APIs
from compiled `7632e6a0995ceaab88bc8cede91506a5330d2e1c`. It is based on the frozen
`8d444cfb` driver, preserving its represented architectural selector comparison.
The compiled 125-file inventory/build/prepared tree/addon/configuration authenticate
separately from the new worker source closure before native load. No C/NAPI change
or rebuild is part of this arm. Native create receives the authenticated config
file path, and Bochs supplies the audited reset model. No JS execution or reset
normalization is performed by this native-only worker.

`oneQ` uses maxN1/maxQ1; `batched` uses maxN600/maxQmin(300,remainingQ).
UINT64_MAX disables only an artificial native-N deadline. Actual owned clock
transfer, device deadlines, ordered preflight, mandatory PIO flushes and return
phases remain active. The loop stages the actual PIC line, calls setIRQ only on
a real line change, begins the lease, resumes, and ends it. N and Q are independent.
The Q tail is clipped to the exact audited target and the final raw CS:EIP must be
F000:E16 before executing E16. Real asserted PIC state with IF0 is preserved.
No HLT marker or synthetic interrupt mask is introduced.

Execution process CPU and monotonic wall include actual scheduling, IRQ changes,
owned device/PIO work, progress guards/counters, GC and the mandatory ABI4 return
of all166 words plus metadata on every native resume. Those fields are not stripped.
There is no per-return hash, disk write, growing snapshot array or JS oracle
comparison in timing. Setup/authentication/native create, final inspect/catchup,
CPU/board/RAM/PIO evidence comparison, output and close occur outside that timer.
Returned intermediate words are discarded after use: reset/final/first-failure
full166 and actual aggregate returns/counters are retained, without a claim that
every intermediate boundary can be independently reconstructed. Separate actual
diagnostic qualification supplies stronger boundary evidence.

Outside timing, the complete ordered actual PIO tape, raw final166 words and
meaningful JS counterparts, full settled board including PIC, and whole raw RAM
hash must exactly match the pinned capture. No raw word, RAM witness or clock
normalization is accepted. Final native N must equal the audited capture's N
independently of final Q; there is no N=Q assumption. CPU counterparts come from
the named pre-settle E16 cut; board/RAM use actual settled evidence.
Provider.records copies once at terminal or once on first failure, never per
return. Batch-dependent attempts/REP partial counters remain raw; they are not
normalized to the one-Q protocol. The provider has no paused
RAM-range API, so there is no per-element native store-byte parity claim.

Pure tests use manufactured protocol fixtures only, with no machine construction,
CPU instruction, addon load, native guest or benchmark. A future parent must freeze
source/Node/input/helper/artifact pins, supply process-group CPU/wall/file/core limits
and retain raw stdout/stderr/exit plus whole-child rusage and host context. Those
whole-child costs differ from execution timing. The pending binding is not a guest
authorization. No source control success establishes speed or adoption.

Native-only one-Q versus batched execution measures complete-slice scheduling/API
costs. Native batching versus the separate plain JS Bochs-reset worker measures
backend speed for this cold slice. Both require the future consolidated parity and
paired harness; no mixed diagnostic timing is reusable as a native baseline. Six
board clocks per completion is a configured functional model, not physical 386
calibration, and this gate cannot establish Windows/Doom or full AT 10× speed.
