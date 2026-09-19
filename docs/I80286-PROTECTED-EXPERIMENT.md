# Experimental 80286 protected-mode slice

`ProtectedI80286` is an opt-in CPU helper. It executes a bounded 16-bit
protected-mode subset with GDT/LDT segments and ring-0/ring-3 interrupt
transitions without changing the production `i80286` target, which remains
the vector-qualified real-mode core. Pass
`{deliverProtectedFaults:true}` as the second constructor argument to enable
the supported IDT and privilege-transition subset. The default preserves
host-visible diagnostic faults.

The supported entry sequence is `LGDT`, `LMSW`, and a direct far `JMP` to a
present ring-0 nonconforming code descriptor. Protected execution supports
byte and word `MOV` among registers, memory, immediates, segment registers,
and `moffs`; `LEA`; the ADD/OR/ADC/SBB/AND/SUB/XOR/CMP families and groups;
`TEST`; register and ModR/M `INC`/`DEC`; general-register `PUSH`/`POP`; near
`CALL`/`RET`/`JMP`; short conditional jumps; `LOOP`/`LOOPE`/`LOOPNE`/`JCXZ`;
direct far `JMP`; `NOP`; and `HLT`. All classic 16-bit ModR/M effective-address
forms are decoded, with BP-based forms defaulting to SS and the other forms to
DS. ES, CS, SS, and DS overrides replace that default. Read-modify-write
instructions validate the destination for writing before reading its operand.
MOVS, STOS, LODS, CMPS, and SCAS support byte and word operands, DF, source
segment overrides, and REP/REPE/REPNE. Repeated strings execute one completed
iteration per `step()`: IP remains at the prefix while repetition continues,
so interrupts may enter between iterations. A fault rolls back only its current
iteration; earlier memory writes, indices, count, and comparison flags remain
committed. Every current iteration validates all source and destination spans
and permissions before its first operand bus access. CX zero performs no
operand access. The protected CMPS implementation does not claim bus-read-order
grading beyond those preflight and architectural-state guarantees.

The bounded common subset also includes CLD/STD, CLC/STC/CMC, LAHF/SAHF,
PUSHF/POPF, CLI/STI, byte and word IN/OUT, immediate and segment PUSH/POP,
XCHG, CBW/CWD, immediate TEST, NOT/NEG, and register/immediate shifts. CLI,
STI, and I/O enforce CPL against IOPL. STI has a maskable-interrupt-only shadow;
the existing MOV/POP SS shadow remains distinct because it also inhibits NMI.
`canTakeInterrupt()` exposes both constraints and `canTakeNmi()` exposes only
the SS shadow; a machine embedding this experimental CPU must consult the
latter before delivering NMI. An SS shadow is retained across the executor's
one-iteration REP steps because the prefixed REP remains the following
architectural instruction. That choice follows the manual's instruction-level
wording; the PCjs receipt does not grade interrupt-shadow timing.

The optional IDT subset supports 286 interrupt gates (type 6) and trap gates
(type 7) targeting present nonconforming code in the GDT. It implements
`INT imm8`, `INT3`, `INTO`, public hardware interrupt entry, same-ring and
ring-3-to-ring-0 entry, and same-ring or outer `IRET`. Software interrupts
enforce the gate DPL. The gate selector's RPL is
ignored on entry and visible CS is normalized to CPL. Entry preflights the
entire six-byte frame, plus the two-byte error code where applicable, before
writing. The observable push order is FLAGS, CS, IP, then error code. Both gate
types clear TF and NT; interrupt gates also clear IF, while trap gates preserve
IF. Faults save the restarting IP. Software interrupts save the following IP.
Ring-0 IRET may restore IOPL and NT, clears reserved bits 15, 5, and 3, and
forces FLAGS bit 1. A later IRET while NT is set explicitly refuses the
unsupported task return. TF single-step delivery remains unsupported, so a
subsequent instruction with restored TF also refuses before execution.

LLDT/LTR cache 286 LDT and available-TSS descriptors; SLDT/STR expose their
visible selectors. LTR sets the descriptor busy bit but does not perform or
claim a task switch. LDT data and code selectors, legal null DS/ES loads, and
CPL/RPL/DPL checks are supported for the bounded segment forms. A ring-3
interrupt or trap may enter a nonconforming ring-0 handler using SS0:SP0 from
the current TSS. The complete new frame is validated before descriptor or
stack writes. Outer IRET validates the ten-byte old frame and restores the
outer CS:IP and SS:SP; inaccessible cached DS/ES values become null. Full task
switches, task gates, call gates, conforming segments, and expand-down segments
remain unsupported.

Each of CS, SS, DS, and ES has its own hidden descriptor cache. A load reads a
286 descriptor, validates the bounded capability, sets the descriptor's
accessed bit in memory, and retains its 24-bit base and 16-bit limit. Data and
stack word accesses check the full span before the first bus cycle. Instruction
fetch checks every byte against the unwrapped logical CS offset, so decoding at
`CS:FFFF` cannot continue from `CS:0000`.
`pc` reports cached-CS-base plus IP. `getProtectedState()` and
`setProtectedState()` include the visible registers, hidden segment caches,
MSW, GDTR/IDTR, cached LDTR/TR state, CPL, halt state, SS and STI interrupt
shadows, and cycle counter.

```js
import ProtectedI80286 from '../src/experimental/i80286-protected.js';

const cpu = new ProtectedI80286({read, fetch, write});
// Install an LGDT/LMSW/far-JMP bootstrap and descriptors, then:
while (!cpu.halted) cpu.step();
const checkpoint = cpu.getProtectedState();
cpu.setProtectedState(checkpoint);
```

This slice refuses full task switches, task/call gates and task returns,
conforming and expand-down segments, nested/double-fault delivery,
far `CALL`/`RET`, TF single-step delivery, and all opcodes or address forms
outside the lists above. With delivery disabled, a supported protection fault
is surfaced as `ProtectedModeFault` with vector, error code, and restart IP.
With delivery enabled, #UD, #TS, #NP, #SS, and #GP raised by the bounded decoder are
restored to their instruction boundary and delivered through a valid supported
gate; #NP/#SS/#GP push their error code. A malformed public hardware-interrupt
gate still surfaces the diagnostic fault instead of recursively synthesizing
#GP. Unsupported features raise `UnsupportedProtectedMode` before architectural
data or stack writes. If TF requests a trap on the instruction that sets PE,
LMSW commits and post-instruction delivery is refused without falling through
the real-mode IVT.

The implementation uses a small protected decoder above the existing
real-mode core. An earlier attempt to thread segment-identity tokens through
the production decoder measurably slowed the legacy hot path, so sharing more
decoder machinery is gated on both conformance and performance evidence.
Instruction cycle values are estimates and are not graded.

The semantic contract follows Intel's *80286 and 80287 Programmer's Reference
Manual* (1987): §6.6.1 for visible selectors and hidden segment caches, §7.2
and §7.4 for reference and descriptor checks, §7.4.1 for pre-access stack
checks and restart, the INT and IRET definitions in Chapter 8 for gate entry,
frames, flags, error codes, and return validation, §10.2.2 for LMSW/PE, and
§10.4.2 for protected-mode initialization. The primary manual is archived at
<https://bitsavers.org/components/intel/80286/210498-005_80286_and_80287_Programmers_Reference_Manual_1987.pdf>.

`scripts/compare-pcjs-protected286.mjs` runs the owned bootstrap against clean
PCjs revision `c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70`. It compares the
selectors, IP, cached bases, 24-bit PC, result register, high-memory data, and
descriptor accessed bits. This is evidence for that bootstrap only; it makes
no timing, gate, task, privilege, or broader protected-mode compatibility
claim.

`scripts/compare-pcjs-protected286-isa.mjs` independently runs a bounded guest
with an arithmetic loop, 16-bit ModR/M high-memory read-modify-write, near
call/return stack traffic, and halt against the same exact PCjs revision. It
compares the resulting registers, defined flags, selectors, IP, stack balance,
and high-memory result. The receipt is evidence for that program and opcode
subset only; instruction timing remains ungraded.

`scripts/compare-pcjs-protected286-rep.mjs` runs a guest-owned restart path on
both executors. The first REP MOVSW iteration commits, the second faults on the
cached DS limit, and the #GP handler switches to a flat segment, expands the
descriptor in memory, reloads DS, removes the error word, and IRETs to the REP
prefix. The receipt requires both engines to finish the remaining copy with
matching registers and memory. The owned executor uses one `step()` per REP
iteration; PCjs may complete several iterations within one host step. Neither
step count nor instruction timing is graded.

`scripts/compare-pcjs-protected286-privilege.mjs` independently executes the
owned LLDT/LTR and ring-transition guest. It IRETs from ring 0 to LDT ring-3
code, reads LDT user data, enters ring 0 through a DPL-3 interrupt gate and
TSS stack, checks the full inner frame, IRETs outward, and enters a second
ring-0 handler that halts. It compares selectors, privilege, registers, stack,
both observed frames, and completion with the exact pinned PCjs revision. It
does not claim hardware task switching.
