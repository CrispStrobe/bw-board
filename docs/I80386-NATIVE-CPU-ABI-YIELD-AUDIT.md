# Pinned Bochs CPU3 execution and yield boundary audit

**Status (2026-09-30): source audit and proposed native experiment.** No CPU
adapter, WebAssembly build, guest run, or speed measurement was made for this
note. It concerns the pinned Bochs source revision
`0e45b736ef9792eb9b752b0a35db49eaf2faea47` and the existing native
CPU-level-3 build, which has one CPU, repeat speedups off, and handler chaining
off ([`config.h` options](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/config.h.in#L658-L712)).
The existing [owned paging and page-fault oracle receipts](I80386-BOCHS-CPU3-PAGEFAULT-RETRY-ORACLE.md)
remain unchanged. This is a functional CPU-boundary investigation separate
from the failed register-stack trace opportunity gate.

## What the source currently exposes

The CPU class declares [`cpu_loop()` and an SMP-only `cpu_run_trace()`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/cpu.h#L4295-L4304).
There is no callable `cpu_single_step` in this pinned source. In the single-CPU
build, [`main.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/main.cc#L1045-L1055)
calls `cpu_loop()` continuously until a whole-machine quit request. The
[`cpu_loop` body](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/cpu.cc#L52-L153)
checks pending events before fetch; then an instruction hook precedes RIP
advance and execution, followed by committed RIP, an after-execution hook,
`icount++`, and a PC-system tick. An instruction that faults does not take that
normal completion path.

[`exception()`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/exception.cc#L918-L1003)
reports the exception callback, restores the faulting RIP, delivers the guest
exception, and `longjmp`s to the loop's `setjmp` site. The catch path
[`icount++` and ticks](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/cpu.cc#L60-L84)
before the handler's first instruction. An external ABI cannot yield from a
host callback in the middle of a C++ instruction or assume a normal stack
return after a fault. It needs a safe return after this catch, with a distinct
fault-delivered reason or pending-fault cut. That cut matters for the current
AT [`runBlock()`](../src/experimental/i80386-at-machine.js), which returns
`reason: 'fault'` when a guest fault was delivered without retiring an
instruction, before the handler executes. Bochs's native fault tick is **not**
the board's configured six-clock instruction charge: the AT `step()` assigns
no flat charge to a delivered fault without a completed instruction. Native
ticks, attempted instructions, completed instructions, and REP progress must
therefore be recorded separately; none is already a board cycle count.

[`repeat()` and `repeat_ZF()`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/cpu.cc#L301-L535)
count and tick intermediate iterations internally. On an asynchronous stop
they restore RIP to the repeated instruction and set `STOP_TRACE`. In the
16-bit REP path, the `async_event` test is **after** executing and decrementing
an iteration but **before** the intermediate `icount`/tick
([`cpu.cc` lines 350–385](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/cpu.cc#L350-L385)).
If only a tick callback sets `async_event` when a budget reaches zero, the
next iteration runs before that test and overruns the budget. A bounded ABI
must check the last available budget at the post-iteration, pre-intermediate-
tick boundary (then let the normal outer loop charge that iteration), or use
an equivalent pre-iteration guard without double charging. Budget **one** is
the essential falsification case. A resulting `AFTER_EXECUTION` hook for a
partial REP is a slice boundary, not retirement of the whole architectural
string instruction. The configured build disables bulk REP speedups, but
[`string.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/string.cc#L127-L155),
[`faststring.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/faststring.cc#L85-L105),
and [`io.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/io.cc#L327-L350)
show additional batching and tick deadlines that would need a separate audit
if that configuration changes.

Every [`BX_TICK1`/`BX_TICKN`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/pc_system.h#L106-L121)
can reach [timer callbacks](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/pc_system.cc#L321-L384)
that schedule device work or signal a CPU event. Event priority and interrupt
inhibits live in [`handleAsyncEvent()`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/event.cc#L172-L379).
The single-CPU [`HLT` wait](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/event.cc#L30-L105)
advances ten ticks at a time while waiting, so an adapter needs a bounded
halt/event return instead of relying on that loop. Physical memory and ports
also depend on Bochs globals ([`BX_MEM`, `BX_INP`, `BX_OUTP`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/bochs.h#L193-L203)).
The CPU's [physical memory access and direct-page path](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/paging.cc#L2604-L2653)
must reach host-owned RAM or an explicit veto. Page walks and A/D updates
also use those paths ([`paging.cc` reads and writes](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/paging.cc#L1159-L1272)).

## Smallest proposed native functional gate

Introduce a CPU3-only native `resume(max_ticks, host_callbacks)` boundary
returning a reason (`budget`, `fault-delivered`, `port`, `halt`, or failure),
native tick delta, fault attempts, completed instructions, REP iterations,
CS:EIP, and pending-event state. Host callbacks supply page-contained
physical reads/writes and safe direct-page pointers or vetoes, port I/O, a
tick/next-event deadline, and event signals. A port callback may synchronously
flush preceding host device debt before performing the I/O. A requested port
yield must occur **after** the instruction's architectural I/O and CPU commit;
abandoning the C++ instruction stack inside the callback is invalid. All
fallback calls to Bochs RAM, devices, or timer service in the tested interval
must fail closed and be counted. This is the minimum distinction between a
host-adapted CPU seam and a wrapper around a whole Bochs machine.

Use the existing [free page-fault fixture](../test/fixtures/i80386-bochs-cpu3-pagefault-retry.S)
from its post-BIOS `setup` at `CS:IP=0000:7e00`, with the source-bound owned
image already loaded. That interval includes `REP STOSL`, 4 KiB page-table
setup, one recoverable `#PF`, guest repair and CR3 reload, `IRETD` retry, and
port `0xe9` output. Run the native adapter once continuously and again with
tick budgets **1, 2, and 257**, forcing cuts inside REP and at the fault/port
boundaries. Require every call to return within its budget and resume from the
same architectural state. Compare final selected CPU state, frame/PDE/PTE/data
RAM words, exactly one fault and retry, architecturally relevant host RAM
writes, port-byte sequence, and cumulative native tick/event schedule. Count
an attempted fault separately from a completed instruction; require a
`fault-delivered` cut before the handler to demonstrate the later board-facing
boundary. Slicing can re-enter a REP at its restored RIP and produce extra
fetch or instruction-hook records, so those callback counts are **not** an
equality gate. Preserve the historical oracle source, build, and receipts.

Passing this gate would establish only continuous-versus-sliced **native
self-parity** for the owned fixture and host callback interval. It would not
establish parity with JavaScript AT chip debt, IRQ arbitration, zero-charge
fault cuts, A20 or DMA mapping/cache invalidation, cold reset/CPU seeding, or
complete bus events. It would not prove a WebAssembly build or any speed gain.
`emcc` was absent on the audit host; native `clang` was present. A later
board comparison needs explicit chip/IRQ/fault-cut and invalidation tests,
then a separate WASM build and measurement. Strict CPU3 also remains unable
to run the unmodified stock xv6 CR4/PSE bootstrap.
