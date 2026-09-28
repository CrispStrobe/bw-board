# Experimental 80386 speed path

## Current checkpoint (2026-09-28)

The 10× goal is still open. On the VPS (four KVM Skylake vCPUs, Node
20.20), a complete stock-xv6 `forktest` retires 24,338,279 guest steps.
The [three-run xv6 baseline](receipts/2026-09-28-x86-vps-throughput.json)
has a 25.16-second median user-CPU time for the ordinary JS executor; its
opt-in native executor has an 18.21-second median. Both produce the same
serial output, final RAM hash, and 163,891,880 board cycles. These are host
execution times from source `8261e891`; 27.315 seconds at the configured
6 MHz board clock is *virtual* time. Neither ratio is a measured speed
relative to a physical 16 MHz 386DX.

A later [same-page write optimization](receipts/2026-09-28-i80386-same-page-write-performance.json)
improved a paired three-run ordinary-executor mean from 24.53 to 23.55
user-CPU seconds (1.042×), with the complete guest result unchanged. These
different-source samples should not be spliced into an invented cumulative
RTx figure. The [cross-platform benchmark](X86-RTX-PLATFORMS.md) now has
VPS, Kaggle CPU-host, and [GitHub-hosted](receipts/2026-09-28-x86-platform-gh.json)
receipts. The GitHub runner's AMD EPYC 7763 measured 4.05 million 386-core
and 2.24 million 386-AT instructions/s on its fixed real-mode benchmark.
The three hosts ran identical benchmark source files, but these short
media-free probes are not xv6 or Windows workloads. Their reported 386
factors use configured virtual time and explicitly are not physical-386 RTx.

The [reference-emulator audit](I80386-REFERENCE-EMULATORS.md) identifies the
useful design gap: QEMU TCG translates and chains host-code blocks; Bochs
caches decoded traces; this board still pays much of the JavaScript decode,
translation, event, and JS↔WASM dispatch cost. The next retained change must
show a meaningful paired full-xv6 user-CPU gain, identical complete guest
state, and FreeDOS/Windows plus protected-mode requalification. A
[full-xv6 native fallback census](receipts/2026-09-28-i80386-native-entry-negative.json)
found 16.43 million native instructions in 4.00 million calls and 7.91 million
JavaScript steps. Raising the block budget and caching program transfers
preserved guest state but gained only 1.6% in one pair and 0.8% across two
pairs, respectively; both were discarded. The published
[fallback observer](../scripts/observe-i80386-native-fallback.mjs) identifies
executed memory, string, TEST and branch forms for a grouped, page-safe
coverage experiment. Its five selected forms are only 11.0% of all xv6 steps,
so they cannot alone deliver 10×. A subsequent
[grouped 32-bit trial](receipts/2026-09-28-i80386-native-coverage-no-go.json)
retired 579,024 more xv6 instructions natively yet gained only 0.22% mean
user CPU across three pairs, with one reversal; its executable changes were
discarded. The [current Windows code16 diagnostic](I80386-CODE16-WINDOWS-CURRENT.md)
matched selected reported guest fields but took 392.05 versus 78.52 user CPU
seconds, about 4.99× longer. Neither result supports another narrow opcode
addition. The next experiment is a bounded dynamic-memory slow-exit contract
that can preserve exact faults, page-table/code coherence and device-event
boundaries while reducing block-entry work. The measurements below are an
experiment ledger; earlier statements about work remaining refer to their
dated source revisions.

The direct stock-xv6 `forktest` A/B from `2feb23a3` to `bc539d33` took 39.655
versus 29.575 user-CPU seconds for 24,338,279 guest steps (1.341×). The later
IOAPIC pending-mask experiment measured another 1.078× on the same workload.
These are bounded measurements, not evidence of the requested 10× overall
speedup. Reproduction details and hashes are in the dated receipts.

On 2026-09-28, a guarded 25-instruction mappages trace preserved xv6 and a
bounded Windows report, but repeated admission slowed paired xv6 user CPU by
16.0% and 19.8%. It still executed every instruction through the ordinary
interpreter, so that prototype is a no-go. Two smaller CPU changes were
retained instead. Coalescing a four-byte immediate fetch only from ordinary
same-page RAM improved paired xv6 user CPU by 10.7% and 5.2%; direct register
field access improved it by 8.4% and 5.4% on the resulting board. Each pair
retired the same 24,338,279 guest steps with identical serial output and final
RAM hash. The Windows 60-million-step diagnostic matched its preceding source
except provenance fields; both free-BIOS and browser-target FreeDOS receipts
were rerun for 45.8 million steps after each source change. The full 386 suite
passed 494 tests with four skips after each qualification. Raw reports, timings,
profiles, and negative results are kept under
`brickwright-firmware-private/performance/2026-09-28`. These are bounded xv6
host-CPU gains, still far short of the 10× target or a hardware RTx calibration.

The `probe-xv6-stock.mjs` runner can now set `XV6_LEAN=1` to omit its
per-instruction milestone, user-mode, and recent-instruction records while
retaining the serial command, stopping condition, interrupts, display, and
final CPU state. One normal and two lean full `forktest` runs took 27.88 versus
26.24 and 26.48 user-CPU seconds, respectively. This isolates roughly 1.5
seconds of diagnostic-runner cost; it is **not** an emulator improvement. Use
the lean mode for future paired performance tests and the normal mode for
diagnosis. The [lean-probe receipt](receipts/2026-09-27-i80386-lean-probe.json)
pins the media and complete-run result.

A direct-RAM byte-read shortcut in the AT board preserved the complete lean
`forktest` report but changed one adjacent user-CPU pair from 26.64 to 26.16
seconds (1.018×). That is below the predeclared 5% board-only retention
threshold, so the candidate was discarded. The [negative read-path receipt](receipts/2026-09-27-i80386-at-readfast-negative.json)
pins both source variants and the identical guest result.

An inline decoder for common 32-bit memory `MOV 8B` and `LEA 8D` forms also
preserved the complete xv6 guest report, but two alternating A/B pairs averaged
27.405 versus 27.05 user-CPU seconds (1.013×). The individual pairs disagreed
on the winner, and the mean was below the predeclared 10% threshold for
duplicating effective-address logic. That source experiment was discarded;
the [negative MOV/LEA receipt](receipts/2026-09-27-i80386-mov-lea-fastpath-negative.json)
records the measurements. A broad block executor with memory, branches and
strings remains the next CPU speed project.

An [opt-in shared WASM RAM backing](I80386-SHARED-RAM.md) now passes a complete
xv6 `forktest` with identical guest state. It removes the need to copy guest
RAM at every future native-block boundary, but still runs the JavaScript CPU
for every instruction; its 27.45-second run is not a speedup claim. The native
block executor, decoder coverage and exact fault/device exits remain unbuilt.

An architectural reference is [v86's own description of its hot-page
x86-to-WASM compiler](https://github.com/copy/v86/blob/master/docs/how-it-works.md):
it profiles hot pages, emits blocks, and keeps physical-page translation,
MMIO and code-write invalidation in a fast TLB path. This is a design reference,
not evidence that v86 is a drop-in backend or that our 386 will reach 10×.
Its [documented missing CPU features](https://github.com/copy/v86/blob/master/Readme.md)
include task gates and some 16-bit protected-mode behavior that our accuracy
lane explicitly tests. For our board, a future fast path must also retain the
AT chip event contract and Debugger single-step behavior.

A final-source V8 sample over the xv6 run attributed 17.7% of time to
`_stepInstruction`, 7.1% to `_fetchN`, 5.0% to `_decodeEA`, 7.8% to
`_translate`, 6.1% to `_read386`, and 6.1% to `_serviceInterrupts`. The
instrumented probe script itself accounted for about 2.85 seconds. Removing
`_fetchN`, `_decodeEA`, and `_fetch8` entirely would save only 14.4% of sampled
time, an optimistic 1.17× ceiling for a decode-only cache. Removing all of
those plus `_linear`, `_translate`, and `_read386` would save about 31%, an
optimistic 1.45× ceiling; those latter functions also serve data accesses, so
the actual cache ceiling is lower. The baseline's roughly 40-second run would
need to reach roughly four seconds for 10×, while this probe's own sampled
work already uses most of that budget.

Executed CS:EIP pairs repeated 24,322,722 times after 12,329 first visits:
99.95% of decoded instructions revisit an address. The hot opcode mix matters
more than the hit rate. `8B` register-from-memory and `8D` LEA account for
about 18% of instructions and are entirely memory-address forms in this xv6
run. `AB` STOS accounts for 8.9%; short JE/JNE for 12.2%. Six register-form
families (`89`, `39`, `85`, `81`, `C1`, `83`) total about 28.1% of executed
instructions. A narrowly cached register template can test feasibility, but
it cannot by itself reach 10×. If its paired CPU-time gain is below 10% or
within run-to-run noise, stop widening the JS template set.

That bounded trial cached register-form `89`/`39`/`85` on extended RAM code
pages with version checks for guest, host and DMA writes. Two adjacent xv6 A/B
pairs took 27.925 seconds baseline versus 27.25 seconds candidate on average:
1.025×, or about 2.4%. Complete guest reports matched except their worktree
paths. The source experiment was discarded under the stopping rule; the code
coherence and precise-fault tests remain. The dated negative receipt records
the measurement.

The next architectural experiment should use a static, CSP-safe decoder into
compact typed-array basic blocks, with no `eval` or `new Function`. Populate a
block only from instruction bytes already fetched during successful execution
or from side-effect-free RAM after the first fetch has passed ordinary segment
and paging checks. Stop a block at a code-page boundary, branch, I/O,
privilege/control-register change, REP iteration, or any operation whose
fault/restart behavior is not yet covered. A per-physical-code-page version
must change on CPU, host, and DMA writes; CR0/CR3/CR4, A20, segment reloads,
and page-table writes must invalidate or fail a cache key. Executing a cached
instruction still has to preserve the one-instruction snapshot, partial
memory effects, trap flags, and interrupt boundary. The board may batch only
up to its next scheduled chip event and must break immediately when an IRQ,
NMI, HLT, fault, or shadow transition requires service.

If that bounded block interpreter cannot substantially cut total time, a
static WebAssembly executor backed by the same RAM buffer is the likely next
route. It must run multiple safe instructions per JS↔WASM crossing and return
at exact device/event boundaries; one crossing per byte or instruction would
erase the benefit. The repository's `src/riscv-cc-wasm.js` already shows a
bundled module loader. A 386 module would need the site's explicit Wasm CSP
allowance and a CLI loading path; it must not use runtime JavaScript code
generation. Benchmark the full
Windows transition and xv6 guest-state equality after each stage, including
self-modifying code, host/DMA writes, CR3 remaps, and precise later-instruction
faults. These are design requirements, not a claim that the 10× goal is solved.

A [static WASM block spike](I80386-WASM-BLOCK-SPIKE.md) now proves the toolchain
and an event-budgeted multi-instruction call, but its register-only instruction
set is too narrow to integrate. On the complete xv6 `forktest`, only 1,019 of
3,657,970 eligible runs had at least two instructions; these covered just
2,066 of 24,338,279 guest steps. The [negative feasibility receipt](receipts/2026-09-27-i80386-wasm-safe-run-feasibility.json)
records exact counts and hashes. The production executor was not changed.
For a 10× total speedup, Amdahl's law requires moving at least 90% of total
runtime even if the moved work becomes infinitely fast. At 20× faster native
execution, the required share rises to 94.7%, before board/device overhead.
Guest instruction coverage is not CPU-time coverage, so the next trial must
measure both full-workload time and the share spent at block exits.

The [opt-in board block contract](I80386-RUN-BLOCK-CONTRACT.md) now defines a
bounded entry and exact chip-event exit using the existing per-instruction
step. It covers memory and branches semantically but has no fast backend and
claims no acceleration. It is a baseline against which a native executor can
be tested.

A [source-bound opcode-run trace](receipts/2026-09-27-i80386-hot-opcode-runs.json)
now measures the complete xv6 `forktest` with the ordinary CPU left intact.
Its broad memory/ALU/branch/stack opcode set accounts for 84.8% of retired
instructions, or 73.1% after removing string operations. These are
optimistic opcode-family matches, not valid compiled blocks. Only 56,064
instructions, 0.230% of all retirements, fit complete 64-instruction spans in
the broad non-string runs, even before a branch, fault, code page, device, or
chip event splits them. Repeated strings account for most of the apparent
long-run opportunity. Four-instruction spans cover at most 53.0% of retired
instructions in the same optimistic non-string set; eight cover 29.8%, and
sixteen cover 7.4%. Each count ignores branches as block boundaries and is
therefore only a ceiling for unlinked blocks. The next executor should use
short blocks and cheap branch linking, with a separate interruptible REP
path. A design that requires long straight-line runs cannot deliver the 10×
end-to-end target on this workload.

The static [WASM block spike](I80386-WASM-BLOCK-SPIKE.md) now links
prevalidated JZ/JNZ/JMP targets inside a bounded call. A CMP/JNZ loop matches
the JavaScript 386 at a five-instruction event exit, and an invalid target
exits without committing the branch. This established the control-flow
contract; that predecessor had no guest memory access.

The [shared-RAM load spike](I80386-WASM-BLOCK-SPIKE.md) now lets the native
module read the AT board's live RAM without a copy. A prevalidated 32-bit
physical load matches a JavaScript 386 `MOV` in a focused test, and an invalid
end-of-RAM load exits without changing state. This removes one prerequisite
for a fast CPU backend; paging, MMIO, writes and exact fault exits remain to
be implemented before it can run xv6 instructions. The spike remains
disconnected from the AT board's execution path and changes no end-to-end
speed.

The native spike now also evaluates register-based SIB addresses at runtime,
and a host helper admits a physical RAM page only from an existing 386 TLB
entry. A protected-mode test maps a high virtual page to low physical RAM,
matches the JavaScript 386 for MOV/LEA, and rejects the window after a board
page-table write. This establishes a side-effect-free read admission and
remap exit for one page, not a general native paging implementation. A
decoder, wider opcode coverage, precise writes/faults and a measured AT
integration remain necessary for 10×.

The full xv6 [read-window trace](receipts/2026-09-27-i80386-read-window-admission.json)
shows that 92.6% of attempted `MOV 8B` memory reads use an already cached,
flat DS or SS mapping to plain RAM above 1 MiB. The complete guest report
matches the ordinary probe. This makes dynamic RAM reads a credible component
of a broad native block executor, but `MOV 8B` is only about 10.8% of retired
instructions and no guest opcode was accelerated by that trace.

An [opt-in real-byte native probe](receipts/2026-09-27-i80386-native-byte-block-negative.json)
now decodes a narrow subset of paged 32-bit guest code and executes bounded
MOV/CMP/TEST/LEA/NOP/JZ/JNZ blocks against the board's shared RAM. On the full
stock xv6 `forktest`, 5,131,681 of 24,338,279 guest instructions retired in
2,076,324 WASM calls. Every ordinary guest-report field matched the paired
JavaScript run, including CPU, serial, interrupts and 24,338,279 total steps.
The native run took **46.31 user CPU seconds versus 25.82 seconds** for the
ordinary lean run on the same host. This is a 1.79× slowdown, not a speedup.
The typical call retired only 2.47 instructions; the runner also checks code
bytes, mappings, events and state on every entry. A 10× target needs much
broader opcode coverage and cheaper block entry, plus precise writes and
fault exits. The production CPU and ordinary probe remain unchanged.

A second [real-byte A/B](receipts/2026-09-27-i80386-native-immediate-direct-state.json)
adds 32-bit register-immediate MOV and CMP, including sign-extended `83 /7`,
and copies CPU state directly to and from the shared WASM memory. The full
guest report still matches. The new path retires 5,202,654 instructions in
2,111,674 calls and takes 42.23 user CPU seconds; the paired ordinary run
takes 25.82 seconds. Direct state transfer cut the expanded path from 48.83
to 42.23 seconds, but the overall native path is still 1.64× slower. Reusing
the last loaded WASM program was also tested and removed after it measured
49.37 seconds on the earlier opcode set versus 46.31 without that cache.
These measurements point to the per-call boundary and short blocks as the
dominant problem; adding rare forms alone will not deliver 10×.

The [numeric block-cache A/B and opcode-form trace](receipts/2026-09-27-i80386-numeric-cache-and-opcode-forms.json)
removed a string allocation from each of roughly 21 million native lookup
attempts. Two complete native `forktest` runs then took 26.50 and 27.17 user
CPU seconds, versus 26.89 and 27.99 for the ordinary lean path. All four
guest reports and the instrumented trace match. This is around parity, not
a robust speedup; the 10× target remains open.

The same trace identifies the next high-volume forms: REP STOS (`AB` with
`F3`) retires 2,168,824 iterations; register SHR immediate (`C1 /5`) retires
1,200,526; register AND immediate (`81 /4`), ADD immediate (`81 /0`), AND
EAX immediate (`25`) and OR immediate (`83 /1`) each retire about 0.49–0.55
million. These are observed retired forms, not proof that a native block can
execute them safely. Register shifts and immediate ALU operations are the
next bounded decoder candidates. REP STOS needs an interruptible write path
with code/page-table coherence and precise event exits.

The [register ALU and shift A/B](receipts/2026-09-27-i80386-native-register-alu-shift.json)
adds 32-bit register ADD/OR/AND immediate, `AND EAX, imm32`, and SHL/SHR
immediate to the opt-in WASM blocks. On two full xv6 `forktest` runs, the
native path retires 8,813,759 of 24,338,279 guest instructions (36.2%) in
1,874,330 calls, about 4.70 instructions per call. Every ordinary guest-report
field matches. Native user CPU time is 22.87 and 22.49 seconds, versus 26.89
and 27.99 seconds for the recent ordinary runs. That is an observed roughly
1.2× gain for the opt-in probe on this host, still far from 10× and still not
integrated into normal CLI or GUI stepping. The next substantial coverage
requires precise native writes for REP STOS and common memory ALU forms.

The [bounded REP STOSD A/B](receipts/2026-09-27-i80386-native-rep-stosd.json)
adds native writes only to already cached, writable, dirty ES pages in plain
high RAM. It rejects page-table pages, the current code page, A20 gating,
MMIO, unvalidated translations and page crossings; other writes fall back to
the JavaScript CPU. The runner also now checks whether PIC or IOAPIC edges
are *deliverable*, matching the AT board's IF, APIC handoff and IOAPIC mask
rules. On full xv6 `forktest`, 2,145,309 REP STOSD iterations retire natively,
98.9% of the 2,168,824 REP STOS events observed in the earlier opcode trace.
Overall native retirement reaches 11,298,966 of 24,338,279 guest steps
(46.4%), at 5.43 instructions per block call. Two native runs take 20.02 and
19.72 user CPU seconds; recent ordinary runs take 26.43 and 26.77 seconds.
The final 4 MiB RAM SHA-256 matches exactly, as do CPU, serial, interrupts,
screen and milestones. This is an observed roughly 1.3× end-to-end gain for
the opt-in xv6 probe on this host, still far from 10×. Production CLI and GUI
stepping do not use this backend yet.

The [16-bit Windows decoder census](receipts/2026-09-27-i80386-code16-block-decode.json)
found 44.72 million 16-bit steps in a 60-million-step Windows 3.11 run.
The code window admitted 44.67 million, but the diagnostic decoder recognized
the first opcode at only 19.14 million steps. Conservative observation credited
18.05 million retired steps in disjoint decoded blocks, including 10.83 million
in blocks of at least two instructions. No guest instructions ran through this
decoder. Memory operands, prefixes and unsupported opcodes stop many blocks;
the high code-window admission rate alone is therefore not an acceleration
result. The paired private 60-million-step ordinary/native comparison took
81.12 versus 87.43 user CPU seconds with matching guest state. A narrow
16-bit dispatch bypass also showed no repeatable gain. The next performance
experiment must measure CPU time by execution mode and block-exit reason,
then test broader memory, prefix, branch and string execution over multiple
instructions per native call. The 10× target remains open.

An [opt-in entry-mode CPU sampler](I80386-MODE-CPU-PROFILE.md) now measures
process CPU over completed AT-console step calls, flushing its clock at each
mode change. In two 60-million-step runs of the same external Windows 3.11
workload, real, protected 16-bit and VM86 entry modes together accounted for
69.8% and 70.2% of attributed user CPU; protected 32-bit accounted for 30.2%
and 29.8%. No clock window mixed modes. The four paired control/profile runs
had identical normalized guest output; the sampler added 2.41–2.86 user CPU
seconds, or about 3.4% on average. These mode shares include board and runner
work and are not strict retired-instruction costs. Even if 16-bit mode became
free, the observed share implies only a 3.31–3.35× overall ceiling for this
workload. A 10× path must accelerate substantial 32-bit work too. Pinned media,
raw reports, timing files and source hashes live in the private fixture repo.

The [opt-in code16 WASM block slice](I80386-CODE16-WASM-BLOCK.md) can execute
read-only `8A`/`8B` memory loads and a few register, immediate and branch
forms. It matched all normalized guest output in a pinned 60-million-step
Windows 3.11 A/B, but retired only 2.73 million instructions in 1.26 million
WASM calls. It took 295.91 user CPU seconds against 78.40 for ordinary
execution, a 3.77× slowdown, and remains off by default. A later opt-in
[refusal census](receipts/2026-09-27-i80386-code16-wasm-diagnostics.json)
accounted for all 57.27 million fallback calls: unsupported first opcode
(29.85 million), 32-bit mode (15.28 million), short block (8.01 million),
repeat context (2.15 million), and unsupported memory form (1.81 million)
dominated. Data-proof refusals numbered only 13,319. These are dispatcher
calls, not unique retired instructions or CPU-time shares. The immediate
priority is to identify complete prefixed and stack/control instruction
forms and find a way to keep useful blocks running across branches.

The read-only [protected-32 native eligibility census](I80386-NATIVE32-CENSUS.md)
observed 15.28 million protected-32 entries in the same Windows workload.
The existing decoder returned null at 10.06 million entries; another 3.06
million produced only a single-instruction candidate. Of 1.81 million
retired `8B` instructions, 0.96 million had a single-instruction candidate,
0.59 million a multi-instruction candidate, and 0.26 million no candidate.
No newly missing narrow opcode family reached the preset 1.5-million
retirement threshold. This census preserves the ordinary guest report and
does not measure native speed. Its counts favor broad grouped-form coverage
and cheaper entry/continuation over a small isolated opcode addition.

Later [ordinary Windows V8 attribution](receipts/2026-09-27-i80386-ordinary-windows-profile-attribution.json)
put 79.65% of samples in the 386 CPU and 10.19% in the AT board;
`step` plus `_stepInstruction` accounted for 31.64%. An independent
[native-dispatch profile](receipts/2026-09-27-i80386-native-dispatch-profile-negative.json)
put all native-specific self samples at only 8.90% of its measured run,
below the preset 10% threshold for a narrow entry/cache patch. These
different profiles cannot be multiplied into a speedup estimate.

The code16 slice later added ES-prefixed reads and a proved, terminal
plain-RAM word store. The [store A/B](receipts/2026-09-27-i80386-code16-wasm-terminal-store.json)
preserved the complete normalized 60-million-step Windows guest report,
but gained only 2,647 native instructions over the prior ES/read slice.
It took 303.48 versus 79.20 user CPU seconds, a 3.83× slowdown. This
write contract is useful correctness groundwork, not a faster path.

Three execution-neutral probes then measured the possible length of broader
blocks before implementing them. The [unlinked broad-grammar census](receipts/2026-09-27-i80386-broad-block-potential-census.json)
found 44.94 million syntactically potential Windows steps in 22.06 million
runs (2.04 steps/run), and 21.60 million xv6 steps in 8.58 million runs
(2.52). Following only [actual conditional-Jcc successors](receipts/2026-09-27-i80386-broad-jcc-linked-potential.json)
raised those means to 2.56 and 3.58. An [opcode-refusal histogram](receipts/2026-09-28-i80386-broad-refusal-opcodes.json)
identified concentrated missing forms: Windows protected16 `3A`/`3C`
accounted for 64.34% of unsupported Jcc successors, while xv6 protected32
`25`/`F6 /0` accounted for 88.82%. `FF` mixed indirect control flow and
other operations and cannot be admitted as one form.

A parallel [selected-form syntax scenario](receipts/2026-09-28-i80386-selected-forms-potential.json)
then included read-only byte compares/tests, accumulator immediate ALU,
`F6/F7 /0` TEST and `0F B6/B7` MOVZX in the observed grammar. Windows
rose to 48.47 million potential steps in 15.13 million linked runs, or
**3.20 steps/run**; xv6 reached 23.72 million in 4.17 million, or **5.69**.
Both full guest reports and the preexisting census views matched exactly.
The predeclared gate required at least 50% potential coverage and four
steps/run on *both* workloads. Windows fails, so no executable path follows
from this selected set. These are optimistic syntax counts, not code/data
proofs, CPU-time shares or measured acceleration.

The next speed experiment must address Windows' short protected16 and
protected32 runs and the expensive per-call admission boundary together.
Adding another isolated opcode to the current code16 WASM dispatcher is not
supported by these measurements. The selected-form receipt already bounds a
proposed eight-step hot-trace gate: only 3.45 million of 10.04 million
Windows protected16 steps (34.35%) and 3.03 million of 15.28 million
protected32 steps (19.83%) occur in potential runs of at least eight.
Identity/replay checks can only reduce those shares, so a proposed 50%
per-mode hot-trace gate fails without another full probe. A path toward 10×
must instead handle more control, stack, segment and string boundaries per
entry, or cut entry cost enough that short runs become worthwhile. Any
executable prototype must preserve guest state and beat ordinary execution
in serial paired full-workload CPU-time tests. The 10× target remains open.

An opt-in [observed backward-Jcc locator](I80386-HOT-LOOP-LOCATOR.md) then
measured actual branch recurrence without changing execution. Its
[aggregate receipt](receipts/2026-09-28-i80386-hot-loop-locator.json) has
exact guest-state parity for pinned Windows 60M and lean xv6; two Windows
reports are byte-identical. Long traversal sums overlap at nested branches
and are not disjoint executable coverage. The strongest retained Windows
protected16 site with at least eight steps repeats 6,580 times for 52,640
steps, just 0.524% of protected16 completed steps and 0.0878% of all 60M
step calls. Windows evicted 6,052 candidate records, so retained per-site
counts are lower bounds. The strongest xv6 protected32 exact-identity site
repeats 8,961 times at 25 steps. Neither single site can deliver a whole-run
10× gain.

Targeted ordinary-step body traces exposed why those sites cannot yet be
batched. The [Windows protected16 audit](I80386-WIN16-HOT-SITE-AUDIT.md)
found a COM1 line-status `IN` on every eight-step traversal; the read has
UART and IRQ side effects, and chip/event and I/O privilege boundaries must
remain exact. The [xv6 proof audit](receipts/2026-09-28-i80386-xv6-hot-loop-prototype-no-go.json)
found a 25-step page-table-writing `mappages` loop, an 18-step loop with a
PDE-dependent PTE read, and a nine-step loop with dependent reads and a
write. Current entry-only code/data windows cannot admit these without
losing translation coherence or precise later-instruction faults. That
initial audit stopped without executable work or CPU-time A/B.
The next architectural work is dynamic per-instruction translation and fault
checkpoints, immediate page-table-write coherence, and bounded event-aware
batching; any implementation still needs full Windows/xv6 parity and paired
CPU-time evidence before a speed claim.

A [current-source Windows code16 follow-up](I80386-CODE16-WINDOWS-CURRENT.md)
paired ordinary and opt-in diagnostic runs at `e7434073` for the same 60
million guest steps and matching selected reported guest fields. The console
report omits full RAM, disk state and complete hidden CPU state. The opt-in
path retired 5.04 million steps in 2.35 million block calls, averaging
2.15 steps/call;
ordinary and opt-in user CPU were 78.52 and 392.05 seconds on a four-vCPU
Xeon Skylake host. Its **4.99× CPU cost** is a no-go for the current
diagnostic configuration. The [public aggregate receipt](receipts/2026-09-28-i80386-code16-windows-current.json)
retains source hashes, modes and exit reasons without private media IDs or
guest text. The bounded next step is an event-aware multi-instruction trace
architecture, not another isolated 16-bit opcode addition.
An [owned protected-16 branch-to-I/O fixture](I80386-WIN16-IO-BOUNDARY-ORACLE.md)
now pins the first acceptance boundary: a taken JZ reaches an `IN` with zero
device reads, then ordinary execution performs one read. QEMU supplies the
pre/post CPU-state checkpoints; Bochs CPU-level 3 independently emits the
same output marker. This is an oracle harness, not an executable block-engine
speed result.

A follow-on [dependent-read observation](receipts/2026-09-28-i80386-dependent-read-xv6-observation.json)
admitted 51,150 of 51,200 reached second-read attempts using cached RAM
proofs. A guarded [two-phase xv6 prototype](receipts/2026-09-28-i80386-deallocuvm-two-phase-negative.json)
then preserved the full guest report and RAM hash while retiring 1,038,726
instructions natively. Serial user-CPU pairs were 27.90/31.39 and
26.55/32.92 seconds for ordinary/opt-in: the opt-in mean was 18.11% slower.
The full-workload no-regression gate failed, so its executable changes were
discarded. Those native retirements cover 4.268% of completed step calls;
that is not a measured CPU-time share.
