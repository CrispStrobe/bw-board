# Draft: a guarded cross-mode trace engine for the 80386

**Status:** design for audit only. No runtime implementation or speed claim.
Board evidence base: `5f4d53831568cf15c00a1a4e1e4b03ed785e60cb`; published against board main `1032537d14173ecb9af95180dfd73d5ce0a1befa`.

The ordinary Windows 60M profile assigns 4,491/13,718 disjoint V8 self
samples (32.74%) to `step` and `_stepInstruction`, but those functions include
required execution, not removable overhead. The opt-in fetch-page cursor
covered only 34.26M/147.71M fetch bytes and made one uninstrumented Windows
pair 8.21% slower. The code16 event-run observer found only 13.02M of 44.69M
completed 16-bit ordinals (29.12%) in syntactically eligible runs of at least
four; that observer excluded 32-bit execution and did not prove executable
traces. Register-only native successor chaining also failed its necessary
1.5M-call gate on xv6 (0.558M optimistic calls). These receipts rule out another
narrow opcode, fetch, or straight-line chaining patch as the next 10× step.
Sources: [ordinary core profile](receipts/2026-09-28-i80386-ordinary-core-other-audit.md),
[fetch cursor no-go](receipts/2026-09-28-i80386-fetch-page-cursor-no-go.md),
[code16 event-run observer](receipts/2026-09-28-i80386-code16-event-run-observer.json),
[native successor census](receipts/2026-09-28-i80386-native-successor-census.json).

| Upstream primary source | Mechanism and implication for this board |
| --- | --- |
| [QEMU TCG translator design](https://github.com/qemu/qemu/blob/81ce3a87737aa50716c42db8886082d12783e0a1/docs/devel/tcg.rst) | Translation blocks specialize on CPU state. Direct links avoid the main-loop lookup, but may link only when the branch and page relation are safe; page-owned translated code is invalidated on writes. Precise exception recovery maps execution points back to guest state. Our chip/IRQ horizon must additionally cap each trace. |
| [Bochs trace cache](https://github.com/bochs-emu/Bochs/blob/4b46aea873017e56b9baebb2b7e0c7d53ce594e5/bochs/cpu/icache.h) | Cached decoded instructions are keyed by physical address and fetch mode, with up to 32 instructions per trace. Physical-page write stamps, page-split indexing and broken links handle self-modifying code. The [documented cross-page invalidation issue](https://github.com/bochs-emu/Bochs/issues/567) is a reason to end our first trace before a second code page, not to assume cached decode is automatically safe. |
| [MAME PowerPC DRC](https://github.com/mamedev/mame/blob/dcca0e9b281be806813848db869d9ee54b4ad92e/src/devices/cpu/powerpc/ppcdrc.cpp) | Its reusable compiled sequence is keyed by mode and PC, checked against physical mapping and a code signature; a generation change triggers a translation check. This is an architecture analogy from a **PowerPC** backend, not x86 semantics or a reusable backend for our 386. |
| [ThreeAteSix 386 CPU](https://github.com/andrewjc/threeatesix/blob/6c5bb6ecf249fda1fa9c60d7845c2f5d3da70bb8/devices/intel8086/80386_cpu.go) | Its `Step()` invokes decode each instruction. The source offers an independent 386 implementation reference, but no demonstrated decode/dispatch amortization to adopt. |

The proposed architecture is a **single opt-in decoded-trace path across real,
protected16, VM86 and protected32 modes**, with ordinary `machine.step()` as
the precise fallback. A hot CS:EIP site decodes once into a small typed
micro-op sequence for the *existing modeled ISA*, including ordinary ALU,
branch, stack and data forms. Conditional branches choose a guarded cached
successor inside the same code page; cold or unsafe successors exit. Decode
is never allowed to read a second code page speculatively. A trace key binds
physical code page and exact code bytes to CS descriptor values, CPL/VM86,
operand/address defaults, CR0/CR3/CR4, translation generation and effective
A20. Every CPU, DMA or host write to cached code, and every change to the
mapping or mode identity, revokes the trace and incoming links before reuse.
Direct raw `machine.mem` mutation bypasses the normal board write watcher;
the trace API must intercept it or require an explicit invalidation before
further execution, with a differential test for a raw PTE remap after TLB
slot eviction.
The existing [dynamic-memory slow-exit spike](I80386-DYNAMIC-MEMORY-SLOW-EXIT.md)
is a contract reference for data: use only already-valid RAM translations;
exit **before** a missing, permission-changing, cross-page, MMIO, ROM,
page-table or code-writing access so ordinary JS performs the walk, A/D
updates, fault or device effect. It is not yet a fast TLB implementation.

Execution keeps an instruction-boundary commit record: precise CS:EIP,
registers/flags and prior completed steps are visible before a side exit; a
faulting instruction has no later writes. NMI/IRQ arbitration, TF/debug,
interrupt shadows, HLT, chip/LAPIC deadlines and externally scheduled input
are checked at their existing instruction boundaries. A synchronous I/O
helper may let a hot loop continue only if it performs the same ordered board
port access, settles any chip effect and rechecks the next interrupt/event
boundary; otherwise I/O is a slow exit. An eight-instruction polling loop is
useful only if this exit/re-entry cost is small enough. This is a different
cost model from static code16 event runs that stopped at each I/O access.

**Next measurable experiment, before a backend:** make an execution-neutral
observer on the current 60M Windows source that follows *actual retired*
CS:EIP and mode transitions. Build disjoint potential traces using the full
currently modeled opcode grammar, conditional branch outcomes, one physical
code page, and an explicit I/O-helper assumption. Count retired steps in runs
of at least eight, call/exit frequency, code-page and translation revocations,
fault/IRQ/chip exits, and per-mode shares; label every unproved I/O continuation
an optimistic upper bound. Pair observed/unobserved complete guest JSON and
input/source hashes. **Predeclared gate:** at least 30M unique retired instruction ordinals within the 60M-step-call
Windows budget in disjoint ≥8-instruction potential traces, including at least 5M
protected16/VM86 steps, with no double counting or event-boundary inference.
That is roughly half the step-call budget and only a necessary opportunity screen: it would
still require more than 20% cost reduction on covered steps for a 10% total
gain, before entry and helper overhead. If it fails, do not build a backend.

If it passes, prove a small branch + RAM load + port-I/O loop against ordinary
state and exact device/fault order, then run an opt-in full Windows 60M and
lean xv6 parity pair. Only after parity would three serial AB/BA/AB user-CPU
pairs test a predeclared ≥10% mean Windows improvement with every pair
favorable. The path remains opt-in until those gates pass. None of these
upstream designs or current receipts predicts a 10× result for our board.

**License and provenance:** this document uses published *ideas only*; it
copies no upstream code, tables, or generated output. QEMU's TCG documentation
is under GPL-2.0; Bochs `icache.h` says LGPL-2.0-or-later; MAME's cited
`ppcdrc.cpp` carries a BSD-3-Clause file header while MAME as a whole is
GPL-2.0 ([COPYING](https://github.com/mamedev/mame/blob/dcca0e9b281be806813848db869d9ee54b4ad92e/COPYING)).
ThreeAteSix's README claims MIT, but the inspected repository tree has no
standalone license file, so its code should not be reused without resolving
that provenance. Any future implementation should be written from our own
contracts and reviewed separately for license compatibility.
