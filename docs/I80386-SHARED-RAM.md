# Experimental 80386 shared RAM backing

The opt-in `createI80386RamBridge()` replaces an already-constructed 386 AT
machine's RAM view with a view of a fixed WebAssembly memory. It copies the
initial board bytes once. Subsequent CPU, host and DMA writes use the same
bytes that a future WASM executor would read, without a copy at each block
boundary. The module reserves 16 MiB, the board's maximum physical address
space, and forbids memory growth so the JavaScript view cannot detach.

This is a storage contract, **not an accelerated CPU**. The JavaScript 386
still executes every instruction, translates pages, handles faults, and
arbitrates devices. The ordinary board bus remains responsible for A20 alias,
ROM/MMIO, APIC, VGA, paging A/D effects, and write coherence. A future WASM
executor must use that same backing view but cannot bypass those checks just
because the bytes are shared.

Set `XV6_SHARED_RAM=1` on `scripts/probe-xv6-stock.mjs` to exercise the bridge.
The complete lean stock xv6 `forktest` ran for 24,338,279 machine steps and
matched the ordinary runner's serial transcript, interrupts, display and
final CPU state after normalizing worktree paths and the new receipt flag. The
run used 27.45 user-CPU seconds; no speedup is claimed. The
[source-bound receipt](receipts/2026-09-27-i80386-shared-ram.json) records the
media and source hashes. Two focused tests also cover CPU/host/DMA byte
visibility, A20 aliasing, APIC decode and the fixed memory size.

The next implementation has to execute a *broad* instruction block against
this backing memory, with exits before faults and device boundaries. The
earlier narrow register-only WASM spike cannot accelerate real xv6, because
almost every eligible instruction is isolated. The board event-horizon trace
shows that chip deadlines alone allow complete 64-instruction spans for
95.9% of retired xv6 instructions; code and memory semantics are the remaining
constraint. This bridge is opt-in and does not change the shipped 386 target.
