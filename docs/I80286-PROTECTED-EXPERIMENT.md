# Experimental 80286 protected-mode slice

`ProtectedI80286` is an opt-in CPU helper. It executes one bounded ring-0,
GDT-only protected-mode path without changing the production `i80286` target,
which remains the vector-qualified real-mode core. Pass
`{deliverProtectedFaults:true}` as the second constructor argument to enable
the same-ring IDT subset. The default preserves host-visible diagnostic faults.

The supported entry sequence is `LGDT`, `LMSW`, and a direct far `JMP` to a
present ring-0 nonconforming code descriptor. Protected execution supports
`MOV r8/r16,imm`, register and direct-address forms of `MOV r/m,r` and
`MOV r,r/m`, register-form `MOV Sreg,r16`, general-register `PUSH`/`POP`,
`NOP`, short and near direct `JMP`, direct far `JMP`, and `HLT`. Data addressing
supports register-to-register and the 16-bit direct `[disp16]` form. Segment
overrides are supported for those direct data accesses.

The optional IDT subset supports 286 interrupt gates (type 6) and trap gates
(type 7) targeting present ring-0 nonconforming code in the GDT. It implements
`INT imm8`, `INT3`, `INTO`, public hardware interrupt entry, and same-ring
`IRET`. Software interrupts enforce the gate DPL. The gate selector's RPL is
ignored on entry and visible CS is normalized to CPL. Entry preflights the
entire six-byte frame, plus the two-byte error code where applicable, before
writing. The observable push order is FLAGS, CS, IP, then error code. Both gate
types clear TF and NT; interrupt gates also clear IF, while trap gates preserve
IF. Faults save the restarting IP. Software interrupts save the following IP.
Ring-0 IRET may restore IOPL and NT, clears reserved bits 15, 5, and 3, and
forces FLAGS bit 1. A later IRET while NT is set explicitly refuses the
unsupported task return. TF single-step delivery remains unsupported, so a
subsequent instruction with restored TF also refuses before execution.

Each of CS, SS, DS, and ES has its own hidden descriptor cache. A load reads a
286 descriptor, validates the bounded capability, sets the descriptor's
accessed bit in memory, and retains its 24-bit base and 16-bit limit. Data and
stack word accesses check the full span before the first bus cycle. Instruction
fetch checks every byte against the unwrapped logical CS offset, so decoding at
`CS:FFFF` cannot continue from `CS:0000`.
`pc` reports cached-CS-base plus IP. `getProtectedState()` and
`setProtectedState()` include the visible registers, hidden caches, MSW,
GDTR/IDTR, CPL, halt state, interrupt shadow, and cycle counter.

```js
import ProtectedI80286 from '../src/experimental/i80286-protected.js';

const cpu = new ProtectedI80286({read, fetch, write});
// Install an LGDT/LMSW/far-JMP bootstrap and descriptors, then:
while (!cpu.halted) cpu.step();
const checkpoint = cpu.getProtectedState();
cpu.setProtectedState(checkpoint);
```

This slice refuses LDT selectors, system descriptors, null data selectors,
privilege levels other than ring 0, conforming and expand-down segments, task
gates and task returns, privilege-changing gates, nested/double-fault delivery,
REP partial progress, TF single-step delivery, and all opcodes or address forms
outside the lists above. With delivery disabled, a supported protection fault
is surfaced as `ProtectedModeFault` with vector, error code, and restart IP.
With delivery enabled, #UD, #NP, #SS, and #GP raised by the bounded decoder are
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
