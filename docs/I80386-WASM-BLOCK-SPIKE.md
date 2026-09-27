# Static WASM 386 block spike

The bundled 3,404-byte WASM module executes prevalidated register-only MOV,
CMP, TEST, NOP, JZ, JNZ and JMP operations plus physical RAM loads in one
JS→WASM call. It accepts an instruction budget from the board's event horizon. A budget of
zero returns before execution; reaching the budget returns at the exact
instruction boundary. Unsupported or potentially faulting operations are
represented by exit markers and cause no partial execution of that
instruction. Tests compare state and flags against the JavaScript 386,
including both 16- and 32-bit operand widths. Branch IR uses `dst` as the
target instruction index and `src` as its already validated guest EIP.
Conditional branches can loop within the call; each branch charges one
instruction against the event budget. An invalid target exits before
committing the branch. The [branch-link receipt](receipts/2026-09-27-i80386-wasm-branch-link-spike.json)
pins the branch-only predecessor and its focused tests.

The module can now import the [shared guest RAM backing](I80386-SHARED-RAM.md)
used by the AT board. Its state and program occupy reserved bytes above the
16 MiB guest RAM region, leaving board, host, DMA and native reads on the same
live buffer. The new `LOAD_PHYS` IR form reads a prevalidated 16- or 32-bit
physical RAM value into a register. The host must first perform x86 segment,
paging, permission and RAM/device checks; the IR never makes those decisions.
An out-of-range physical read exits before changing state. The
[shared-load receipt](receipts/2026-09-27-i80386-wasm-shared-load-spike.json)
pins the layout and a comparison with the JavaScript CPU.

The full 24,338,279-step xv6 `forktest` supplied a decisive coverage bound
before any board integration. The implemented register forms occurred
3,659,017 times (15.03%) but formed 3,657,970 contiguous runs. Exactly
3,656,951 runs were length one; only 1,019 runs had at least two safe
instructions, totaling 2,066 instructions (0.0085% of the guest run). A
bridge restricted to these forms would cross JS↔WASM almost once per guest
instruction. This is a negative integration result, not a performance gain.
The temporary histogram instrumentation was removed after measurement.

This module does not decode x86 or fetch guest instruction bytes. The host
must check CS bounds, paging/permissions, code-page versions, instruction
bytes, branch target EIPs and physical load addresses before writing IR. It
must terminate a block before an
IRQ/NMI-visible boundary, I/O, REP, HLT, indirect branch, control-register
change, segment reload, or any unmodelled faultable operation. A directly
linked JZ/JNZ/JMP may stay inside the prevalidated block. A block exit
returns control to the existing JavaScript interpreter, which handles faults
and device interactions. The module's `event_budget` alone is insufficient to
make a board integration correct; the board must derive it from its nearest
chip event and pending interrupts.

The next useful implementation step is an end-to-end opt-in `runSafeBlock`
path in `ExperimentalI80386ATMachine`:

1. Record a bounded block from bytes fetched during successful instructions,
   stopping at a physical code-page boundary or any unsafe instruction.
2. Invalidate on CPU, host, and DMA writes to watched physical code pages;
   also reject keys after CR0/CR3/CR4, A20, CS, privilege, or page-table
   changes. Reuse the existing translation-cache coherence ingress.
3. At each call, cap the block by `_chipDeadline - _chipDebt`, pending IRQ/NMI,
   interrupt shadows, and single-step debug state. Return to the regular
   board loop after every exit and verify exact guest state.
4. Measure the full xv6 `forktest` and Windows desktop transitions against
   JavaScript-only runs. Include state equality and paired user-CPU time.
   A microkernel throughput number would not establish emulator speed.

Given the measured run lengths, step 1 must cover the common memory MOV/LEA,
short branches, REP STOS and ALU forms before a production bridge is worth
benchmarking. That is a larger native CPU project: it needs a guest RAM
backing view shared with the board, explicit MMIO exits, exact access/dirty
page effects, write coherence, restartable page/segment faults, and a board
batch entry point. Existing `machine.step()` remains the single-instruction
debug contract; an opt-in `runSafeBlock` would need to serve both
`advanceToMs` (browser) and the CLI runner to produce a user-visible gain.

`src/experimental/i80386-block-spike.js` loads the fixed module in Node or
through a browser URL. Browser deployment needs a CSP that permits Wasm
compilation; it never uses runtime JavaScript generation. Clang/wasm-ld 18.1.3
and Rust 1.98.1 are available locally. The repository already has a bundled
WASM loader in `src/riscv-cc-wasm.js`; this spike follows that loading shape.
It is deliberately unconnected to the production CPU until the block keys,
event exits, and full-guest A/B above exist.
