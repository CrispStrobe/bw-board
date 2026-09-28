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

The source-bound observer is available as `AT_CODE16_EVENT_OBSERVER=1` in
`run-i80386-at-console.mjs` and requires ordinary, noninteractive,
single-step execution. It calls the original board and CPU fetch, memory,
I/O, chip, and interrupt paths and records only what the completed step did.
Its deliberately narrow admission grammar handles unprefixed register and
proved RAM memory forms, unprefixed short/near conditional jumps and direct
jumps, and cuts at device I/O, event, fault, unsafe mapping, code or tracked
page-table write, code-page crossing, or instruction-slot budget. It refuses
protected32 and prefix-bearing forms pending separate proof. Host/DMA RAM
writes through the board `_write` path split runs; direct edits to `mem`
outside the board API are outside this observer's mutation witness.

The emitted report checks three partitions per mode: entry attempts equal
retired steps plus no-retirement calls plus aborted calls; retired steps equal
admitted plus refused ordinals; and the run-length histogram expands to
exactly the admitted ordinals. A run is recorded only once, on closure, so
long-run coverage is a subset of admitted ordinals. The owned fixture tests
exercise taken and fallthrough JZ joins, the first I/O read, chip/event and
fault cuts, bytewise and direct 32-bit immediate fetch reconstruction,
physical page-table and code writes, and host code mutation. These are
observer correctness checks, not proof that a future executor may safely
implement the same grammar.

The single pinned 60M Windows 3.11 census finished at source
`e1fd5c60a30e8c5a8dcc3d13ddc96a49fa45ad95`; its
[media-neutral receipt](receipts/2026-09-28-i80386-code16-event-run-observer.json)
retains every mode's full run-length histogram and refusal counts. The four
vCPU KVM Intel Xeon Skylake host used Node 20.20.2. Wall/user/system CPU
seconds were 497.76/497.82/3.32. These are observer overhead, not an
executor speed measurement. The input pins and all selected reported guest
fields match both the retained opt-in 60M report and an older ordinary 60M
report. The ordinary CPU, AT board, and base board source blobs match the
retained opt-in report; opt-in executor modules and the runner differ.
An exhaustive normalized JSON diff against that opt-in report has only
14 expected provenance, observer, input-option, and opt-in diagnostic field
paths, with zero other differences. The reducer records those paths without
publishing their guest values.
Neither report includes full RAM, disk state, or hidden CPU state.

The run made 60,000,000 ordinary step calls. Exactly 59,971,215 retired an
instruction; 28,785 no-retirement calls are outside the completed-step
denominator. The real, protected16, and VM86 completed-step denominator is
**44,693,708**: real 13,435,142; protected16 10,036,060; VM86 21,222,506.
The observer admitted 21,516,981 unique ordinals in 7,254,598 disjoint
runs, giving **2.966 retired steps per run**. Runs of length at least four
contain 13,015,581 unique ordinals, **29.12%** of the denominator. The
coverage gate passes, but the predeclared mean-four gate fails. No broader
runtime executor is justified by this census.

The largest cuts are ROM or mapped-code refusal in real and VM86, and
prefix-bearing forms in protected16 (2,439,708 refusals). Ordinary input,
chip, interrupt, fault and code-write boundaries remain cut. Prefix support
is a plausible grammar extension, but its operand/address/segment semantics
and frequency of safe joins were not established by this run. There is no
measured, clearly safe addition shown to lift the all-run mean from 2.966
to four. The source stays an observer only; the next experiment needs an
owned prefix/stack semantic proof and a bounded, non-executing reach check
before any executor work.

At the observed admission count, mean four would require at most 5,379,245
runs, **1,875,353 fewer** than observed (25.85% of current runs). More
generally, if an extended observer admits `N` new ordinals and changes the
run count by `ΔR`, it must satisfy `N - 4ΔR ≥ 7,501,411`. One newly admitted
instruction that perfectly bridges two current runs reduces `ΔR` by one
and improves this deficit by five, so even that idealized case needs at
least **1,500,283** such bridges. A prefix instruction that forms a new
isolated run makes the mean worse. These are exact arithmetic requirements,
not a forecast from the 5,811,973 prefix refusals.

The existing opt-in code16 WASM slice has differential proof for one
`0x26` ES override on memory `8A`/`8B` loads and `3A` byte CMP, including
segment selection, paging, faults and JZ flag effects. An observer-only
extension could recognize **only those exact uncombined forms** after the
ordinary CPU has fetched and retired them, with exact instruction length,
non-device data addresses, unchanged segment/translation identity, and the
same event/write cuts. The existing `0x66` form census parses instruction
width but does not execute those forms natively; it is not an equivalent
semantic proof. The old opt-in `first26` and `first66` histograms count
dispatcher refusals, not all ordinary retired prefix steps or disjoint
bridges, so they cannot establish the required 1.5M useful bridges.

The next bounded measurement would first add owned ES-versus-DS/SS,
paged/fault, MMIO, code-write, taken/fallthrough JZ, and event-cut tests to
an **observer-only** shadow classifier for exact `26 8A/8B/3A` forms. After
those pass and a VPS window is available, at most one pinned 60M ordinary
replay would compare all selected reported guest fields and input pins,
report incremental admitted ordinals, bridges versus isolated additions,
the full disjoint run histogram, and the same two gates. It must not infer
full RAM/disk parity or runtime speed from that replay. No `0x66` or
general prefix support follows without separate owned proof.

An audit of the retained [pre-ES form census](receipts/2026-09-27-i80386-code16-wasm-form-census.json)
adds a useful negative screen. At its older source, exact first-byte
`26:8B:mem:o16:a16`, `26:3A:mem:o16:a16`, and
`26:8A:mem:o16:a16` dispatcher refusals were 670,274, 482,417, and
407,566 calls, respectively: **1,560,257 combined**. Each was an eligible
dispatcher start that fell back to an ordinary step, not a census of all
completed ES instructions or disjoint bridges. The current observer's
5,811,973 prefix refusals cover *all* prefixes, including `0x66`, and do
not identify this subset. The older CPU and AT-board source blobs also
differ from the current run, so 1,560,257 is **not an upper bound** on the
current trace.

As a deliberately optimistic arithmetic proxy, if exactly those 1,560,257
calls were the only newly admitted ordinals now, and every one bridged two
current runs, mean length would reach only **4.053**. If the rest merely
joined one neighboring run, at least **95.2%** would have to be perfect
bridges to meet mean four; any isolated additions, unsafe mappings, or
event cuts tighten that requirement. The current opt-in `first26` census
cannot fill the gap because it omits ES forms already handled by its WASM
slice. Thus the retained full-run form census is a better decision screen
than a new first-5M-step prefix sample: an early boot sample would miss the
later Windows mode mix and cannot certify a 60M disjoint-run gate. The
defensible decision is to defer the ES-only observer extension. If a future
broader grammar merits another measurement, use a source-bound full-run
shadow census in a free VPS window; a 5M run can validate instrumentation
only, not promote an executor candidate.
