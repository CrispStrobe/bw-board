# Experimental 80386 executor

`src/experimental/i80386.js` is an opt-in functional executor with a native
32-bit register and instruction-pointer model. It does not select or replace
the production 8086/186/286 CPU.

The current profile implements an explicit original-80386 hardware reset entry
at physical `0xfffffff0`; an ordinary constructor retains the zero-based test
fixture reset. The reset CS cache remains based at `0xffff0000` until a real CS
reload. Reset CR0 clears PE, MP, EM, TS, and PG. Its ET value is selected by
the explicit `none`, `80287`, or `80387` reset profile; original-386 undefined
CR0 bits are deterministically zero rather than assigned later-processor cache
semantics. EDX reports device ID 3 and a caller-selected byte-sized stepping.
The current profile also implements 16- and 32-bit register aliases, independent
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

This stage deliberately refuses VM86, LDT selectors, system
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

The paging profile implements original-80386 two-level 4 KiB translation
through CR3. It combines PDE/PTE present, U/S, and R/W permissions, applies
the original supervisor-writes-ignore-R/W rule, records CR2 and the 386
three-bit #PF error code, and translates instruction, data, stack, GDT, and
IDT accesses. Present PDEs acquire A before a missing-PTE fault; present PTEs
acquire A after permission admission, and writable accesses acquire D before
the data write. Cross-page reads retain completed reads and page-table effects
if a later page faults. Scalar writes preflight the full translated destination
before changing guest bytes; page-table A/D effects from completed walks remain
visible. Architectural register state restarts at the instruction boundary.
Interrupt frames translate and preflight their complete span before writing
frame bytes; descriptor accessed-bit admission precedes frame writes.
Memory read-modify-write instructions perform write admission before the
operand read, including zero-count shifts. The pinned PCjs group decoder also
executes its memory writeback path when the shift helper returns the unchanged
operand for count zero.

PSE, CR0.WP behavior from later processors, VM86, task/ring transitions, and
TLB timing are outside this stage. Reloading CR3 takes effect immediately
because this functional executor does not cache translations.

The bounded I/O profile provides explicit `inPort(port, width)` and
`outPort(port, value, width)` bus callbacks for 8-, 16-, and 32-bit IN/OUT.
Real mode and protected execution at or above IOPL are admitted. An access
which requires a TSS I/O-permission bitmap is an explicit implementation
refusal; the executor does not silently grant it.

The F6/F7 group-3 profile implements TEST, NOT, NEG, MUL, IMUL, DIV, and
IDIV at 8, 16, and 32 bits. Products and double-width dividends use exact
BigInt intermediates. Divide-by-zero and quotient overflow raise #DE before
changing accumulator/result registers. NOT and NEG perform write admission
before reading a memory destination, including paging permissions. MUL/IMUL
grade only their architecturally defined CF and OF results; other flags, and
all DIV/IDIV flags, remain unchanged as an explicit deterministic treatment
of architecturally undefined outputs. The pinned PCjs comparator covers
non-faulting unsigned and signed multiply/divide plus NEG and has a rejecting
quotient mutation. Owned tests cover #DE delivery and boundary failures.

`scripts/run-i80386-test386-diagnostic.mjs` runs the unchanged 64 KiB capture
build from pinned `barotto/test386.asm` revision
`cfd052d1e64d5375dea5a681c1eadeed64ceda2c`. It requires a clean source checkout
and exact ROM/provenance hashes, and records POST port 80 and debug port e9 output.
The GPL-3.0-or-later guest derives from PCjs test386; it is an external
software diagnostic, not an independent hardware oracle. The capture build
changes only POST/debug output ports through configuration. It stops at the
first unsupported instruction or a finite instruction
budget. Its `accepted: false` and `fullRomPass: false` fields are deliberate:
the artifact measures bounded progress and does not claim complete ROM,
hardware, or timing compatibility.

MOV from ES/CS/SS/DS/FS/GS and MOV to ES/SS/DS/FS/GS use a 16-bit
selector. MOV to CS and other invalid encodings raise #UD. Protected
data-register loads admit null selectors with an unusable cache, distinguish
#GP, #NP, and #SS for the bounded GDT path, and leave LDT and expand-down data
as explicit valid-but-unsupported paths. Opcode 8C writes 16 bits to memory
and zero-extends a register destination under 32-bit operand size. The original
manual lists only the r/m16 form; the register upper-half policy follows pinned
PCjs and fixed samples from the pinned SST386 physical 386EX capture; the
hardware profile makes no protected-mode or timing claim.

XCHG supports byte, word, and dword register/memory forms plus the accumulator
short forms, with full write admission before a memory read. A pinned SST386
profile grades nine fixed non-exception samples; LOCK-prefixed and exception
inputs are counted and excluded because LOCK semantics remain outside this
stage. CLC, STC, CMC, CLD, and STD provide the adjacent scalar flag controls.

Single-iteration MOVS, CMPS, STOS, LODS, and SCAS implement independent
operand/address sizes, source overrides, fixed ES destinations, and DF index
direction. REP/REPE/REPNE execute one string iteration per executor step. A
continuing repeat leaves EIP at the prefix while retaining the completed
count/index/memory effects, which exposes a real external-interrupt boundary.
A fault restarts only the uncompleted iteration, and zero-count repeats make
no operand access. This is functional restart evidence, not a cycle count or
prefetch/timing claim.
The STI interrupt shadow spans every iteration of the following REP until the
instruction completes. MOV/POP SS inhibition expires after the first repeat
boundary, and TF can trap after each completed iteration with restart EIP at
the prefix. Intel's original REP exception table specifies #UD/interrupt 6
when the prefix precedes an instruction outside its permitted list; those
encodings therefore raise architectural #UD rather than an implementation
refusal. REP INS/OUTS are on that permitted list but remain explicit
implementation refusals until their per-iteration I/O semantics are added.
If a later REPE/REPNE iteration faults before its comparison completes, the
saved state retains the flags from the last completed iteration.
`scripts/compare-pcjs-protected386-paging.mjs` runs an owned PG=1 guest against
the pinned PCjs revision. It compares two CR3 mappings, successful reads, CR2,
and the delivered #PF restart/error frame. PCjs omits Intel's RF bit in the
saved fault frame at this pin, so that single difference is recorded and
ungraded; the remaining paging state is strict.

`scripts/compare-pcjs-protected386-faults.mjs` binds a clean PCjs revision
`c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70` and compares independent 32-bit
interrupt- and trap-gate frames, IF/TF behavior, and IRET state. The owned
tests additionally cover real-mode delivery, RF/restart EIP, the 80386 #DF
matrix, shutdown, shadows, preflight atomicity, and host-error separation.
PCjs omits RF in the observed #GP saved-flags image; that single bit is
explicitly ungraded by the comparison and checked against Intel in owned tests.
The [source-bound receipt](receipts/2026-09-19-386-bounded.json) preserves both
observed states and the hardware sample accounting.

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
nor evidence of exception compatibility. Six additional segment-move samples pass, with 46 exception inputs excluded.
The admitted total is only 90
samples, not the full 386 corpus. Owned IMUL tests pass, but IMUL hardware
qualification remains pending. Unsupported instruction/protection paths still
raise a diagnostic refusal. The bounded same-ring recovery above does not
qualify the excluded hardware exception cases or complete segment-load,
paging, task, and privilege-transition recovery.
