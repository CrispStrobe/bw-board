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
LIDT, MOV CR0, and a far jump to enter a flat ring-0 32-bit code segment.

The opt-in `deliverFaults` profile adds precise instruction restart for
architectural faults, real-mode IVT delivery, same-ring ring-0 16- and 32-bit
interrupt/trap gates, and same-ring IRET. It implements the 80386
benign/contributory/page-fault pairing table: contributory followed by
contributory, or page fault followed by contributory/page fault, becomes #DF;
a fault during #DF delivery enters CPU shutdown. Fault stack images set RF,
while traps and software INT do not. STI and MOV/POP SS interrupt shadows are
modeled; MOV/POP SS also inhibit NMI through the following instruction and
suppress debug delivery at the segment-load boundary. Accepted NMI is blocked
until IRET. Gate/frame checks complete before frame writes, and host bus
callback errors remain host errors rather than guest exceptions.

This stage deliberately refuses paging, VM86, LDT selectors, system
segments, privilege-changing gates/IRET, tasking, and unimplemented opcodes.
Only architecturally invalid encodings implemented by this profile raise #UD;
valid instructions outside the profile still throw `UnsupportedI80386`.
Descriptor and exception checks cover the flat, same-ring owned-program path;
they are not a complete 80386 protection model. Cycle counts are placeholders
and make no 386DX or 386EX timing claim.

Ordinary MOV/POP segment loads still report null, table-limit, and not-present
descriptor cases as implementation refusals. This stage does not claim their
architectural fault delivery; gate target and frame failures within the
admitted same-ring profile do use architectural exceptions.

`scripts/compare-pcjs-protected386-faults.mjs` binds a clean PCjs revision
`c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70` and compares independent 32-bit
interrupt- and trap-gate frames, IF/TF behavior, and IRET state. The owned
tests additionally cover real-mode delivery, RF/restart EIP, the 80386 #DF
matrix, shutdown, shadows, preflight atomicity, and host-error separation.

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
raise a diagnostic refusal. The bounded same-ring recovery above does not
qualify the excluded hardware exception cases or complete segment-load,
paging, task, and privilege-transition recovery.
