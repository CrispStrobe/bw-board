# Experimental 80386 executor

`src/experimental/i80386.js` is an opt-in functional executor with a native
32-bit register and instruction-pointer model. It does not select or replace
the production 8086/186/286 CPU.

The current profile implements 16- and 32-bit register aliases, independent
operand- and address-size prefixes, 16-bit ModR/M and 32-bit ModR/M plus SIB
addressing, bounded arithmetic and moves, near branches/calls, and 16/32-bit
stack operands with stack addressing selected independently by SS.B. ES, CS,
SS, DS, FS, and GS have independent visible selectors and
hidden base, limit, and default-size state. A real-mode bootstrap can use LGDT,
MOV CR0, and a far jump to enter a flat ring-0 32-bit code segment.

This stage deliberately refuses paging, VM86, LDT selectors, system
segments, privilege changes, interrupts, faults, tasking, and unimplemented
opcodes. Descriptor checks cover the flat owned-program path; they are not a
complete 80386 protection model. Cycle counts are placeholders and make no
386DX or 386EX timing claim.

The 386EX MOO corpus is suitable for register-level sampling in real mode, but
its 16-bit external bus and SMM instrumentation are not a 386DX timing oracle.
Protected-mode MOO inputs are not presently published in the pinned corpus, so
they cannot validate this stage's protected-mode entry.

`scripts/verify-i80386-moo-sample.mjs` requires the exact clean physical-capture
revision `459d49fbe6280e9ed46fee887b58dacd9cb880ab`. It parses MOO 1.1 directly,
applies published RM32 masks and the pinned revocation list, and samples fixed
first/middle/last non-revoked, non-exception cases from ADD files `01`, `6601`, `6701`, and
`676601`. The receipt binds every compressed input and executed local source by
SHA-256. This is register/RAM evidence across the four operand/address-size
combinations. Cycle chunks are skipped and remain ungraded.

Additional bounded profiles cover byte XOR/MOV and byte MOVZX/MOVSX (36
samples), and immediate SHL/SHR/SAR across operand/address sizes (36 samples).
The three profiles exclude 888, 2,600 and 3,111 published exception cases,
respectively, before deterministic selection. Those cases are neither passes
nor evidence of exception compatibility. The admitted total is only 84
samples, not the full 386 corpus. Owned IMUL tests pass, but IMUL hardware
qualification remains pending. Unsupported instruction/protection paths still
raise a diagnostic refusal; precise architectural recovery is the next stage.
