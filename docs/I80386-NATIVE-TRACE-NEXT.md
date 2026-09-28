# Protected32 native trace: next bounded experiment

Source at `140afc7aec2ae126400ebf7fde080ad56a7c06ff` (PR #90 merged).
This is a design and standalone branch-side-exit proof, not a dispatcher or
performance change.

The [native dispatcher](../src/experimental/i80386-native-dispatch.js) makes
4,001,848 WASM block calls to retire 16,428,211 instructions in the pinned
xv6 forktest (4.105 per call). [Packed entry](receipts/2026-09-28-i80386-packed-entry-performance.json)
cut user CPU by 10.19%, but still transfers CPU state and dispatches each
block separately. The [dynamic-memory spike](../src/experimental/i80386-dynamic-memory-spike.js)
proves a precise cached-RAM slow exit, yet its two-byte 8B/89 grammar has
zero four-instruction fallback spans in the [current native-fallback census](receipts/2026-09-28-i80386-dynamic-span-no-go.json).
Build traces from **already supported production blocks**, not that narrow
decoder or an unmeasured opcode expansion.

The first trace tranche should join two or more cached, register-only blocks
into one at most 64-instruction WASM program. Preserve each original guest
EIP and branch target. A conditional branch to a successor outside the trace
must retire the branch, set the exact target EIP, and side-exit before any
other instruction. Its other edge may enter the next trace block. The
standalone [side-exit spike](../src/experimental/i80386-native-trace-side-exit-spike.c)
and [differential proof script](../scripts/prove-i80386-native-trace-side-exit.mjs)
exercise this new boundary without connecting it to the dispatcher.

At trace entry, check the current CS, mode, CR0/CR3/CR4, translation
generation, A20 state, segment descriptors, every constituent code-window
identity and permission, and every decoded code byte. Reject a changed
mapping or byte before instruction 1. Validate all constituent pages **once
at entry**, then execute synchronously without a JS block boundary. The
first tranche excludes every memory write, REP string, page-table update,
control-register/segment change and I/O operation. Thus no guest instruction
inside the trace can invalidate the admission proof. Ordinary CPU/board/DMA
writes between entries still trigger the current translation invalidation
and/or fail the next entry's byte/window checks; a DMA or chip event cannot
interleave because the batch stops at the existing chip deadline. Host
mutation of shared RAM by an external concurrent actor is outside the
current native runner's synchronous-memory contract.

Clip the instruction budget by the caller's maximum, chip debt/deadline and
LAPIC timer deadline exactly as in the [current runner](../src/experimental/i80386-native-byte-block.js).
Refuse pending IRQ/NMI, debug/single-step, interrupt shadow, reset, halted,
and interpreter-only states before entry. The WASM loop checks the budget
before **each** instruction, including the first instruction of a stitched
successor. On side exit or deadline, commit only retired state, cycles and
chip debt; ordinary `machine.step()` resumes at the exact EIP. Allowed ALU
forms may change condition flags but cannot change IF, IDT, CR3 or event timing.

The second tranche, only if the first passes coverage and correctness gates,
may use the existing [dynamic-memory contract](receipts/2026-09-28-i80386-dynamic-memory-contract.json)
for already-supported native loads whose effective address depends on prior
IR. It must retain the guest *linear* displacement during decoding rather
than reuse the current physical-window-adjusted `disp`. Mirror only relevant
already-valid JS translations; a missing, stale, unclean, cross-page,
permission-failing, MMIO or ROM access exits before that instruction. JS then
owns page walk, A/D updates, #PF/#GP, CR2, and I/O side effects. No native
store is admitted in that tranche: tracked code and page-table writes remain
ordinary, with immediate translation/cache coherence. This prevents the
earlier [mappages/deallocuvm proof failures](receipts/2026-09-28-i80386-xv6-hot-loop-prototype-no-go.json)
from being hidden by trace length.

Before production integration, run an execution-neutral **disjoint native
successor-call census** on current packed-entry xv6. Count only completed
native calls with a cached successor at the actual returned CS:EIP; partition
side exits, deadline exits, unsupported successors, code-page changes,
data-window dependence and repeat/string calls. Do not count a branch already
linked *inside* the existing native call, a chip/LAPIC deadline exit, an
invalidated block, or a cold/missing/unsafe successor. Exclude a self-loop or
budget-exhausted call that the existing block could already have continued
under a larger budget; the [prior 16-to-64 budget trial](receipts/2026-09-28-i80386-native-entry-negative.json)
saved only 1.6% in one pair. A proposed trace is counted
once along its observed path, never once per overlapping candidate. Require
at least 1.5 million of the current 4.0 million calls to be *elidable* in
two-or-more-block traces under the first-tranche proof. Separately require a
**post-packed** V8 profile with at least 15% of samples in the affected entry
path, before
coding dispatcher integration. These are necessary opportunity gates, not
native eligibility or a speed prediction. Then require focused branch,
deadline, code-write, page-remap, A20, privilege, IRQ and fault differential
tests; full xv6 guest/RAM parity; and three serial paired user-CPU A/B runs
with at least 5% lower mean and all pairs favorable. Measure Windows mode
effects separately. No full-run census or A/B was run for this design while
the VPS timing window was occupied.
