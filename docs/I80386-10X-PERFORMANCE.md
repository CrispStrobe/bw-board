# Experimental 80386 speed path

The direct stock-xv6 `forktest` A/B from `2feb23a3` to `bc539d33` took 39.655
versus 29.575 user-CPU seconds for 24,338,279 guest steps (1.341×). The later
IOAPIC pending-mask experiment measured another 1.078× on the same workload.
These are bounded measurements, not evidence of the requested 10× overall
speedup. Reproduction details and hashes are in the dated receipts.

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
long-run opportunity. The next executor should therefore use short blocks and
cheap branch linking, with a separate interruptible REP path. A design that
requires long straight-line runs cannot deliver the 10× end-to-end target on
this workload.
