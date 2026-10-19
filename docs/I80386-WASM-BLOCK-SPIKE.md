# Static WASM 386 block spike

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The bundled 6,287-byte WASM module executes prevalidated register-only MOV,
CMP, TEST, immediate MOV/CMP/ADD/OR/AND/SHL/SHR, NOP, JZ, JNZ and JMP operations
plus physical RAM loads and LEA
in one JS→WASM call. It accepts an instruction budget from the board's event horizon. A budget of
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
pins the layout and comparisons with the JavaScript CPU, including a
LOAD/CMP/JNZ loop that sees a host RAM write after an event exit.

`LOAD_WINDOW` and `LEA32` now calculate a 32-bit effective address from
base, index, scale and displacement each time they execute. A load exits
before changing state if the address leaves its approved physical RAM page;
LEA returns the guest offset without consulting RAM. The host can derive the
physical-page delta from an **existing** 386 translation-cache hit through
[`i80386-read-window.js`](../src/experimental/i80386-read-window.js), then
recheck the descriptor before entering a block. It accepts flat DS and SS
segments over plain RAM pages above 1 MiB. A cache miss returns no
window, avoiding an early page walk, fault, or accessed-bit write. Host and
guest page-table changes, CR0/CR3/CR4 changes, segment changes and A20
gating invalidate the descriptor. Tests compare a changing SIB address and
a high virtual page with the JavaScript 386. The
[dynamic-window receipt](receipts/2026-09-27-i80386-wasm-dynamic-window-spike.json)
also covers a later out-of-window exit after an earlier instruction retires.
The host still has to decode and validate each guest instruction; this spike
is not an AT execution path.

On a complete xv6 `forktest`, [read-window admission tracing](receipts/2026-09-27-i80386-read-window-admission.json)
found 2,439,374 qualifying accesses out of 2,635,180 attempted memory
`MOV 8B` reads (92.6%). The 1,636,949 SS accesses are more common than the
998,231 DS accesses. This is an optimistic admission count, not a claim that
those instructions have been decoded, grouped into blocks or accelerated.

The full 24,338,279-step xv6 `forktest` supplied a decisive coverage bound
before any board integration. The implemented register forms occurred
3,659,017 times (15.03%) but formed 3,657,970 contiguous runs. Exactly
3,656,951 runs were length one; only 1,019 runs had at least two safe
instructions, totaling 2,066 instructions (0.0085% of the guest run). A
bridge restricted to these forms would cross JS↔WASM almost once per guest
instruction. This is a negative integration result, not a performance gain.
The temporary histogram instrumentation was removed after measurement.

The WASM module itself does not decode x86 or fetch guest instruction bytes.
An [opt-in host decoder](../src/experimental/i80386-native-byte-block.js)
now checks cached flat 32-bit CS code and DS/SS RAM pages, translates a
narrow real-byte subset into IR, and executes it inside the xv6 probe with
AT chip-event and interrupt exits. The full [A/B receipt](receipts/2026-09-27-i80386-native-byte-block-negative.json)
matches the ordinary guest report but is 1.79× slower (46.31 versus 25.82
user CPU seconds). This path is still experimental and is not wired into
general board stepping, CLI sessions, or the GUI.

The [register-immediate expansion and direct-state receipt](receipts/2026-09-27-i80386-native-immediate-direct-state.json)
adds `B8+rd`, register `81 /7` and `83 /7` to the decoder and eliminates
per-call register-array allocation. The full xv6 report still matches and
the native time improves to 42.23 user CPU seconds, still slower than the
25.82-second JavaScript run. The provenance file now gives the working
shared-memory build command, including its imported memory and fixed global
base.

The [register ALU/shift expansion](receipts/2026-09-27-i80386-native-register-alu-shift.json)
raises full xv6 native retirement to 36.2% and 4.70 instructions per call.
Two opt-in full runs take 22.87 and 22.49 user CPU seconds, while recent
ordinary runs take 26.89 and 27.99 seconds. Guest reports match exactly.
This is a measured gain for the probe only; production AT stepping and the
GUI/CLI adapters still use the JavaScript CPU.

The [REP STOSD integration receipt](receipts/2026-09-27-i80386-native-rep-stosd.json)
adds a bounded 32-bit write operation for exact `F3 AB` continuations after
the JavaScript CPU has performed the first iteration. A side-effect-free
[ES write-window helper](../src/experimental/i80386-write-window.js) admits
only an already cached, dirty, writable high-RAM page; the WASM operation
checks every four-byte store against that page and exits before crossing it.
The host then falls back to the interpreter, which primes the next page and
retains precise faults, paging bits and interrupt behavior. A full xv6 A/B
matches the final 4 MiB RAM hash and all ordinary report fields. Two native
runs take 20.02 and 19.72 user CPU seconds versus 26.43 and 26.77 for the
ordinary probe. This is still an opt-in xv6 path, not a general native CPU.

The host must check CS bounds, paging/permissions, code-page versions,
instruction bytes, branch target EIPs and physical load addresses before writing IR. It
must terminate a block before an IRQ/NMI-visible boundary, I/O, REP, HLT,
indirect branch, control-register
change, segment reload, or any unmodelled faultable operation. A directly
linked JZ/JNZ/JMP may stay inside the prevalidated block. A block exit
returns control to the existing JavaScript interpreter, which handles faults
and device interactions. The module's `event_budget` alone is insufficient to
make a board integration correct; the board must derive it from its nearest
chip event and pending interrupts.

The next useful implementation step is to expand and streamline the opt-in
`runSafeBlock` path before wiring it into `ExperimentalI80386ATMachine`:

1. Add common ALU, stack, write and branch forms to the bounded real-byte
   decoder, stopping at a physical code-page boundary or any unsafe instruction.
2. Invalidate on CPU, host, and DMA writes to watched physical code pages;
   also reject keys after CR0/CR3/CR4, A20, CS, privilege, or page-table
   changes. Reuse the existing translation-cache coherence ingress.
3. At each call, cap the block by `_chipDeadline - _chipDebt`, pending IRQ/NMI,
   interrupt shadows, and single-step debug state. Return to the regular
   board loop after every exit and verify exact guest state.
4. Include state equality and paired user-CPU time. A microkernel throughput number would not establish emulator speed.

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
The opt-in probe connects it to the AT board for the measured A/B; the
production CPU still uses the JavaScript interpreter.
