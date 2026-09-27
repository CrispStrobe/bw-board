# Experimental 80386 speed path

The direct stock-xv6 `forktest` A/B from `2feb23a3` to `bc539d33` took 39.655
versus 29.575 user-CPU seconds for 24,338,279 guest steps (1.341×). The later
IOAPIC pending-mask experiment measured another 1.078× on the same workload.
These are bounded measurements, not evidence of the requested 10× overall
speedup. Reproduction details and hashes are in the dated receipts.

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
