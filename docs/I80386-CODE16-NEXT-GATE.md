# Code16 after first-byte admission: next measurement gate

This plan is pinned to board revision
`aafffc245c4c2cc286bb8a226ca5a8efa0962bc2`, which merged the
[retained first-byte admission change](I80386-CODE16-WINDOW-ADMISSION.md).
Its measured two-pair opt-in mean was 259.56 seconds of user CPU for the
private 60-million-step Windows 3.11 input. That remains much slower than
the earlier ordinary 78.52-second checkpoint. The next question is whether
a **broader event-aware code16 executor** has enough reachable work to
justify implementation after the first-byte copy cost was removed.

The first measurement is one post-change opt-in 60M execution with V8 CPU sampling at a
requested 5 ms interval and no per-call timers. Use the same private input,
`AT_CODE16_WASM=1`, diagnostics, and form census as the measured A/B pairs.
Keep a private raw report, profile, `/usr/bin/time` output and start/end host
load. A media-neutral reducer must verify the selected reported guest fields
and six opt-in counters against the retained [A/B receipt](receipts/2026-09-28-i80386-code16-first-byte-admission.json),
and compare execution-source hashes. The console source inventory now
includes the code-window, EA and data-window helper modules. The merged
runner changed its source-list metadata after the A/B timing; that expected
runner hash difference must be identified, not silently normalized away.
No private media identifier, path or guest text goes into the public result.

Classify each V8 **self sample exactly once** by its leaf frame and call
ancestry. The disjoint bins are code-window proof, block decode,
preparation, dispatcher admission, dispatcher diagnostics, other dispatcher,
ordinary interpreter/board called below the code16 dispatcher, WASM, and
remaining process work. Report both counts and percentages using **all
process self samples** as denominator. A dispatcher frame and its callees
must not both receive the same sample. Samples indicate where CPU was
observed; they are neither removable time nor a speedup bound. The first
screen for an event-aware trace is at least **20% of all process self
samples** in the non-window dispatcher bins plus ordinary fallback.
The code-window proof bin is excluded because first-byte admission already
targeted it.

That profile has now completed at source
`ef376f0ca221c3ea988afa4ddfa182751230baad` on the four-vCPU virtual
Intel Xeon Skylake host (Node 20.20.2). Its
[media-neutral receipt](receipts/2026-09-28-i80386-code16-post-admission-profile.json)
checks all 60M selected guest fields, private inputs, six opt-in counters,
and all other reported JSON fields against the retained B1/B2 reports after
normalizing only the execution revision, changed runner source-list hash and
three newly listed helper hashes. The profile took 261.92 seconds user CPU
and 282.70 seconds wall with one-minute load 11.20 to 9.67; this is one
profiled run, not a timing A/B.

Among 52,168 all-process self samples, code-window proof has 12,599
(24.15%); non-window dispatcher has 18,878 (36.19%); ordinary interpreter
and board below the dispatcher have 16,027 (30.72%); WASM has 51 (0.10%).
The latter two non-window groups total **34,905 samples (66.91%)**, clearing
the predeclared 20% screen. These are disjoint leaf-frame counts, not nested
inclusive time. The 66.91% is **not a removable share**: a broader executor
would still perform much of the guest work and would add its own guards.
No runtime optimization is selected until the unique-step feasibility
observer below passes.

If that screen passes, build a media-neutral, non-executing feasibility
observer before changing the runtime. It must report the exact number of
completed step ordinals entered in real, protected16 and VM86 modes. That
is the denominator for coverage; the older 44,722,493 such entries is a
cross-check, not a substitute for the new count. Partition those ordinals
into **maximal, disjoint** candidate runs, capped at 64 instructions and
split at an unhandled I/O, interrupt, chip event, fault, translation change
or code/data mutation boundary. Do not count nested starts or count one
retirement twice. Feasibility requires both:

- Mean length of **all admitted candidate runs**, including short ones, at
  least four retired instructions per run.
- Unique mode-eligible step ordinals in admitted runs of length at least four
  divided by all real/protected16/VM86 completed step ordinals, at least 25%.

Implement the observer around the existing ordinary `machine.step()`
boundary, not inside an executor. Before each call, record its unique
completed-step ordinal, entry mode, CS:EIP, relevant segment/cache and
translation identity, A20 state and pending chip horizon. Wrap actual
instruction fetch to collect only bytes the ordinary CPU fetches, calling
the original fetch once per byte; never read ahead. Wrap ordinary data and
I/O callbacks only to classify observed addresses and device boundaries,
without changing return values or call counts. After a completed step,
classify its fetched form and actual memory effects, branch successor,
cycle/event outcome and post-step identity. If a fault, device read/write,
unproved mapping, page-table/code write or event edge is seen, end the
current run **before** assigning that ordinal to an executable-safe span.
The ordinary CPU still executes the step. The next observed entry may join
a conditional branch only when the actual post-step target, next fetch and
all identity guards agree. CALL/RET/stack or dependent-memory forms join
only when their observed address and write/fault proof is explicit; otherwise
they end the run. Repeated string micro-iterations remain one completed
step ordinal, matching the runner's step budget.

Maintain one active run per ordinary trace. On each safe completed step,
append its ordinal once; on any cut, emit that maximal run's length and
start a new one at the next eligible ordinal. Keep `eligibleOrdinals =
admittedOrdinals + refusedOrdinals` and require the sum of run lengths to
equal `admittedOrdinals`. Histograms for runs of length at least four are
subsets of the same admitted ordinals and must never be added again to
coverage. Abort/fault calls with no completed step are counted separately
and excluded from the denominator. Record refusal reasons and mode-specific
partitions so an apparently long run cannot hide I/O or fault crossings.

The owned [protected16 branch-to-I/O fixture](I80386-WIN16-IO-BOUNDARY-ORACLE.md)
and [opt-in trace fixture](I80386-CODE16-OWNED-IO-TRACE.md) are the first
correctness boundary. Any future executor must stop before the `IN`, retain
the zero-then-one device-read count, and reject branch, deadline and code
mutations. A broader memory/stack/segment grammar also needs exact
translation, permission, dependent-address, write-coherence and fault-order
checks. The earlier selected-form syntax observer averaged only 3.20 steps
per run; this gate requires a broader, executable-safe result rather than
extrapolating that optimistic census.

Only after both measurement screens and focused oracle tests pass should
an opt-in runtime prototype be timed. Retain it only after two alternating
unprofiled 60M A/B pairs against the retained first-byte path, matching
selected and normalized full reported fields, at least 10% mean user-CPU
gain and no individual regression. The report still omits full RAM, disk
and hidden CPU state, so the acceptance claim must stay at reported-field
parity. Default-path adoption would additionally require a contemporaneous
ordinary-vs-candidate comparison. This tranche changed no runtime code and
made no second full-run timing sweep.
