# Experimental 80386 board block contract

`ExperimentalI80386ATMachine.runBlock(maxInstructions)` is an opt-in bounded
board entry point. It accepts 1–64 instructions and returns the number of
retired instructions, charged cycles, and an exit reason (`instruction-budget`,
`chip-event`, `fault`, `halted`, or `shutdown`). A `chip-event` exit happens
*before* the next instruction; the caller should use `step()` to service that
deadline before calling `runBlock` again. A `halted` exit likewise needs
`step()` to advance chips and potentially wake the CPU; repeatedly calling
`runBlock` while halted cannot make progress.

This first version deliberately calls the existing board `step()` for each
instruction. It preserves the current order of chip settlement, IRQ/NMI
arbitration, CPU execution, fault rollback, and functional cycle charging.
Guest, host, and DMA writes therefore still reach the same page-table and
code-memory ingress. It handles memory operands and taken branches because
the ordinary CPU executes them. It does **not** accelerate xv6 or Windows,
does not use the static WASM spike, and is not yet used by a runner.

The acceptance tests compare a six-instruction memory/ALU/branch sequence
against six ordinary `step()` calls, verify a taken branch changes the next
instruction, verify a guest write changes the next instruction's immediate,
and verify an event deadline stops before a host-modified next instruction.
They establish a baseline contract for a future native backend,
not its performance or complete fault/interrupt proof.

Before replacing the inner `step()` loop, a native backend must exit at every
potential chip event or deliverable IRQ/NMI, preserve TF and interrupt shadows,
and stop before I/O, HLT, privilege changes, or a fault it cannot precisely
restart. Its predecoded code must be keyed by physical code-page version,
CS mode/limits, CR0/CR3/CR4, A20 and relevant page-table generation. CPU,
host, and DMA writes must invalidate affected entries. Memory accesses must
retain paging A/D bits, permissions, MMIO order and partial-fault behavior.
Only a full xv6 and Windows A/B with identical guest state can establish
an end-to-end gain; the 10× target remains open.
