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
architectural faults, real-mode IVT delivery, 16- and 32-bit
interrupt/trap gates, TSS-based inner-ring entry, and same-task IRET. It implements the 80386
benign/contributory/page-fault pairing table: contributory followed by
contributory, or page fault followed by contributory/page fault, becomes #DF;
a fault during #DF delivery enters CPU shutdown. Fault stack images set RF,
while traps and software INT do not. STI and MOV/POP SS interrupt shadows are
modeled; MOV/POP SS also inhibit NMI through the following instruction and
suppress debug delivery at the segment-load boundary. Accepted NMI is blocked
until IRET. Gate/frame checks complete before frame writes, and host bus
callback errors remain host errors rather than guest exceptions.

The current profile implements bounded VM86 entry, interrupts and return as
detailed below. It still refuses task switching, expand-down privilege stacks,
and unimplemented opcodes. LDT lookup, LLDT/LTR, protected call gates,
conforming code, and privilege-changing interrupt/return paths are implemented
within the bounded contracts below.
Only architecturally invalid encodings implemented by this profile raise #UD;
valid instructions outside the profile still throw `UnsupportedI80386`.
Descriptor and exception checks cover the owned protected-mode programs below;
they are not a complete 80386 protection model. Cycle counts are placeholders
and make no 386DX or 386EX timing claim.

MOV/POP data-segment loads check descriptor type, privilege and presence;
null data selectors load an unusable cache, while null SS raises #GP. Invalid
table bounds and descriptor admission raise architectural exceptions.
Expand-down descriptors remain an explicit implementation refusal.

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

The unchanged 64 KiB `test386` capture disagrees with that missing-PTE
ordering. Its first paging case uses a present PDE and absent PTE, then expects
the PDE A bit to remain clear in the #PF handler (`test386-capture.lst`
`A067-A071`). Pinned PCjs likewise checks PTE presence before installing the
paged access handler that sets both A bits (`cpux86.js` `mapPageBlock`). The
original 80386 manual says both corresponding A bits are set before a page
read or write, but does not separately spell out this failed-walk boundary.
The capture README says it was not run on physical hardware, so this remains a
named oracle disagreement rather than a reason to rewrite the admitted paging
contract.
Memory read-modify-write instructions perform write admission before the
operand read, including zero-count shifts. The pinned PCjs group decoder also
executes its memory writeback path when the shift helper returns the unchanged
operand for count zero.

PSE, CR0.WP behavior from later processors, task switching, and
TLB timing are outside this stage. Reloading CR3 takes effect immediately
because this functional executor does not cache translations.

The bounded I/O profile provides explicit `inPort(port, width)` and
`outPort(port, value, width)` bus callbacks for 8-, 16-, and 32-bit IN/OUT.
Real mode and protected execution with CPL no greater than IOPL are admitted.
Less privileged scalar I/O checks the current 386 TSS permission bitmap as
described below; denied transfers make no device callback.

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
loads distinguish #GP, #NP and #SS across GDT and loaded-LDT paths; null
data selectors install unusable caches. Expand-down data and stacks enforce
an exclusive lower limit and a B-selected upper bound (FFFF or FFFFFFFF).
Full operand spans are checked before memory or stack-pointer commits.
Opcode 8C writes 16 bits to memory and zero-extends a register destination
under 32-bit operand size. The original manual lists only the r/m16 form;
the register upper-half policy follows pinned
PCjs and fixed samples from the pinned SST386 physical 386EX capture; the
hardware profile makes no protected-mode or timing claim.

XCHG supports byte, word, and dword register/memory forms plus the accumulator
short forms, with full write admission before a memory read. A pinned SST386
profile grades nine fixed non-exception samples; LOCK-prefixed and exception
inputs are counted and excluded because LOCK semantics remain outside this
stage. CLC, STC, CMC, CLD, and STD provide the adjacent scalar flag controls.

FE/FF implement INC/DEC with exact carry preservation, near indirect CALL/JMP,
and PUSH r/m at 8/16/32-bit applicable widths. Effective addresses are decoded
before stack changes, and target plus stack spans are admitted before commits.
Real-mode immediate and indirect far CALL/JMP plus RETF are included with full
pointer/frame preflight. Protected far transfers and call gates now follow the
bounded protection contracts below. A pinned 386EX profile grades 21 fixed non-exception FE/FF samples;
exception and LOCK-prefixed inputs are counted and excluded.

LES, LDS, LSS, LFS, and LGS load complete far pointers with independent
address and operand sizes. The complete source pointer is admitted before bus
reads; paging still exposes page-walk and earlier-byte read effects in address
order. A selector-load failure leaves the destination register and segment
cache unchanged. LSS establishes the same interrupt, NMI, and debug boundary
shadows as MOV SS. A pinned 386EX profile grades 30 fixed real-mode samples;
protected selector faults and page ordering are covered by owned tests rather
than claimed as hardware-oracle coverage.

The basic ALU families cover ADD, OR, ADC, SBB, AND, SUB, XOR, and CMP through
their accumulator-immediate, ModRM direction, and group-1 immediate encodings
at byte, word, and dword widths. ADC/SBB include carry or borrow in result and
status-flag calculation. Memory-writing forms establish write permission and
paging intent before reading the destination; CMP remains read-only. A pinned
386EX profile grades 42 fixed OR/ADC/SBB/AND cases under the capture's published
flag masks and does not infer values for undefined flags.

PUSHA/POPA support word and dword operand sizes independently of the stack
address size. PUSHA records the pre-instruction SP/ESP value; POPA advances
over the saved stack-pointer slot without loading it. The complete segment
span is checked before stack memory effects, while paging accesses remain in
architectural stack order. Instruction-fault rollback restores registers and
SP/ESP; page-table and already-issued destination writes are not represented
as transactional. A pinned 386EX profile grades 12 fixed non-exception cases.
The samples also pin a physical 386EX POPAD behavior with a 16-bit stack
address: the nominally discarded dword supplies ESP's upper half while the low
SP advances. This differs from the Intel pseudocode's simple `throwaway` and is
reported as a sampled 386EX observation rather than a general x86 claim.
Real-mode PUSHA/PUSHAD implements the Intel-documented shutdown at an original
SP/ESP of 1, 3, or 5 and #GP at 7, 9, 11, 13, or 15.
Register encodings of FF /3 and /5 raise #UD before the bounded protected far
transfer refusal.

MOV moffs implements A0-A3 with independent operand and address sizes plus
segment overrides. Stores do not read their destination, and complete segment
spans are admitted before load or store effects.

BOUND compares a signed 16-bit or 32-bit register against two inclusive signed
bounds from memory. It admits the complete pair within the source segment
before reading either value, rejects register encodings with #UD, and raises a
restartable #BR without changing the tested register or guest memory.

ROL, ROR, RCL, and RCR support the immediate, one, and CL-count groups at all
three operand widths. Counts are masked to five bits, then reduced by the data
width for ROL/ROR or the carry-ring width for 8/16-bit RCL/RCR. A masked count
of zero preserves flags. A nonzero full ROL/ROR circle still updates CF, while
a full RCL/RCR carry-ring circle retains its incoming CF. Rotates define OF
only for a masked count of one and preserve SF/ZF/PF. Memory forms establish
write intent before reads.
The broad pinned profile is deliberately limited to 36 count-one physical
386EX samples, where OF is defined. A separate exact two-case profile grades
count-eight ROL/ROR carry output under the capture's published mask, which
excludes undefined OF; variable counts are otherwise covered by manual-derived
owned tests rather than described as hardware-qualified.
A preliminary 72-case run spanning immediate and CL counts produced ten
differences, all in OF for counts greater than one where Intel marks OF
undefined. That preliminary report was not retained and is not acceptance
evidence or an implementation rule; the defined-CF full-circle cases are graded
separately with a carry-flip negative control.

The bounded protected system-register profile implements LLDT/LTR and
SLDT/STR, including GDT type, presence, and limit checks, LTR busy-bit commit,
and LDT-backed data/code lookup through supervisor page-table accesses. It also
implements SMSW/LMSW, with CPL checks and the rule that LMSW cannot clear PE.
Owned tests cover TI, type, not-present, short-TSS LTR admission, and busy-write
atomicity. A pinned PCjs comparison grades a ring-0 LDT load, short-TSS busy
marking, selector stores, and one LDT data-segment load. Task switching remains
unsupported; privilege transitions and TSS I/O-map use follow the contracts below.

LEA implements all admitted 16-bit and 32-bit effective-address forms with an
independent destination operand size. It returns the offset without checking a
segment or issuing an operand bus read; the register ModRM encoding raises #UD.

PUSH/POP ES, SS, DS, FS, and GS plus PUSH CS follow independent operand and
stack-address sizes; POP CS has no encoding. Physical 386EX captures show that
a 32-bit segment push decrements by four but writes only the selector word, and
a 32-bit segment pop reads only that word before advancing by four. This
instruction-specific behavior permits SP=FFFE to advance to 0002 without a
wrapped operand read; general dword stack operands retain full-span admission.
Segment-load faults restore the pre-instruction stack/register state,
and POP SS establishes interrupt, NMI, and debug shadows.

POP r/m supports word and dword register/memory destinations. With 32-bit
addressing and an ESP-based destination, the effective address uses ESP after
the pop; operand size and SS stack-address size remain independent. Invalid
group extensions raise #UD before the stack read, while destination faults
restore architectural stack state after the source access. The original 386
manual specifies the source, destination, and stack-pointer operations and the
destination faults; pinned PCjs independently snapshots the pre-pop stack
pointer specifically so a destination page fault remains restartable. Its
decoder also computes an ESP-based effective address after performing the pop.
PUSH imm8 sign-extends its source to the selected word or dword operand size.

SGDT and SIDT store the complete six-byte pseudo-descriptor after validating
the complete writable destination. The pinned PCjs implementation records
that actual 386 behavior writes all 32 base bits with either operand size and
notes software that depends on it, despite contradictory wording in the
original manual; the pinned 386EX corpus has no SGDT/SIDT samples. A
cross-page destination fault may update page-table accessed/dirty state but
commits no pseudo-descriptor bytes.

The protected interrupt profile includes nonconforming 16-bit and 32-bit
interrupt/trap gates that enter a more privileged ring using the current
386 TSS `SSn:ESPn`, plus same-task IRET back to an outer ring. Entry validates
the target code, new stack descriptor, complete new frame, and target offset
before changing visible execution state. Outer IRET follows the original-386
order: complete old frame, return code descriptor, return stack descriptor,
then target offset; it does not eagerly validate the returned stack pointer.
Task gates and nested-task returns remain
explicit refusals.
Ring-0 IRETD can enter VM86 after validating its complete nine-dword frame and
16-bit target. It constructs six real-address segment caches and executes the
bounded 16-bit instruction profile there; I/O and privileged instructions use
VM86 CPL3 admission rather than the visible CS selector bits.
An admitted VM86 interrupt or trap enters a nonconforming inner-ring gate,
builds the nine-dword VM86 frame on the 386 TSS-selected stack, clears the
visible VM86 data segments, and can return through IRETD. The bounded path
requires a 32-bit gate to nonconforming ring-0 code; other target privileges
fault architecturally, while 16-bit VM86 gates remain an explicit refusal.
On the original 386, VM86 PUSHF, POPF, INT imm8, IRET, CLI, STI, and LOCK
require IOPL3; lower IOPL raises #GP(0). INT3 is exempt and enters its IDT
gate. VM86 IRET bypasses nested-task return, preserves VM and IOPL, and IRETD
can restore RF. IN and OUT consult the current 386 TSS I/O bitmap in VM86 even
when IOPL is 3. LOCK execution after that privilege check remains outside the
bounded instruction profile. SLDT, STR, LLDT, and LTR raise #UD in VM86.

Conforming code descriptors are admitted for interrupt gates, direct far
control, call-gate targets, IRET, and RETF. Entry retains the caller CPL and
therefore uses the current stack even when the conforming descriptor has a
numerically lower DPL. Returns apply the original instruction-specific rules:
same-level returns require DPL no greater than CPL, outer RETF permits DPL no
greater than the return RPL, while outer IRET additionally requires the
conforming DPL to be numerically greater than the interrupted CPL.

Protected far CALL/JMP and RETF support nonconforming same-ring code
transfers. A 16-bit or 32-bit call gate can enter an inner ring through a
386 TSS stack, copying the gate's bounded parameter count at the gate width;
RETF with an immediate returns outward and releases the copied parameters on
both stacks. Complete pointer, old/new stack, descriptor, and target-limit
checks precede visible control-state changes. Direct task descriptors and
task gates remain explicit refusals.

When protected CPL exceeds IOPL, scalar IN/OUT consult the current 386 TSS
I/O permission bitmap for every byte-wide port covered by the transfer. The
bitmap offset and permission bytes use supervisor paging, missing or set bits
raise #GP(0), and a transfer crossing port FFFF consults the trailing deny
byte rather than wrapping its permission check. Per the original manual, a
bitmap base at or beyond the TSS limit means that no bitmap is present and all
ports are denied.
The pinned PCjs comparison covers one permitted byte access and one denied
byte access as semantic evidence; it is not a physical access-order oracle or
a protected-I/O hardware corpus. Task switching remains outside this profile.
INS/OUTS use the same permission admission,
preflight the memory side before a device callback, and expose each REP
iteration as a separate interruptible executor step. Operand size selects the
port width, address size selects SI/ESI or DI/EDI, OUTS accepts a source
segment override, and INS always targets ES.

VERR and VERW query descriptor type and privilege without requiring the
descriptor P bit, as specified for the original 386. The pinned PCjs oracle
agrees for P=0 accessible data, RPL rejection, execute-only code rejection,
null selectors, unchanged non-ZF flags, and exact completion. The same PCjs
revision reports a system descriptor as readable while the original manual
and local implementation reject system types; that observed mismatch is kept
outside the accepted cross-engine set rather than weakening the architectural
check.

LAR and LSL likewise return ZF=0 without a selector-derived fault when the
selector, descriptor type, or privilege is rejected; faults while reading a
memory operand or descriptor table still propagate. Conforming code bypasses
both CPL and RPL admission as specified by the original manual. This profile
retains the original 386 LAR gate-type table, including 286/386 interrupt and
trap gates, and treats system type 8 as invalid for LSL despite the isolated
instruction-page table's contradictory “Invalid/Valid” row; the architecture
chapter's type table and descriptor semantics identify that row as a manual
typo. LAR returns the masked access-rights image, while LSL expands a granular
limit to its byte limit. Both preserve the destination when ZF is cleared.

Single-iteration MOVS, CMPS, STOS, LODS, and SCAS implement independent
operand/address sizes, source overrides, fixed ES destinations, and DF index
direction. REP/REPE/REPNE execute one string iteration per executor step. A
continuing repeat leaves EIP at the prefix while retaining the completed
count/index/memory effects, which exposes a real external-interrupt boundary.
A fault restarts only the uncompleted iteration, and zero-count repeats make
no operand access. This is functional restart evidence, not a cycle count or
prefetch/timing claim.
STI and MOV/POP SS inhibition expire after the first completed repeat
iteration, and TF can trap after each completed iteration with restart EIP at
the prefix. The original manual establishes inter-iteration interrupt
boundaries but does not explicitly resolve the STI-plus-REP distinction;
this bounded choice follows the pinned PCjs instruction-boundary behavior and
is not claimed as independent original-386 hardware evidence. Intel's original
REP exception table specifies #UD/interrupt 6
when the prefix precedes an instruction outside its permitted list; those
encodings therefore raise architectural #UD rather than an implementation
refusal. REP INS/OUTS are included in the permitted string set and follow the
same one-iteration-per-step boundary.
If a later REPE/REPNE iteration faults before its comparison completes, a
repeat-span checkpoint restores the flags from before the entire instruction,
as specified by later Intel manuals. An interrupt or debug handoff ends that
span, so IRET begins a fresh span with the interrupted flag image. The
available original-386 manual does not state this restoration rule explicitly,
so it remains later-Intel-derived rather than independent 386 hardware proof.
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

## Experimental AT bridge

`ExperimentalI80386ATMachine` is a separate opt-in adapter around the existing
AT devices. It preserves 32-bit CPU physical addresses, decodes only the IBM
reset-ROM window at FFFF0000h as the existing FF0000h ROM storage, and applies
the motherboard A20 gate without truncating unrelated addresses to 24 bits.
Byte devices receive 16- and 32-bit I/O as ordered little-endian byte cycles.
The bridge routes PIC interrupts and NMI through the 386 interrupt API and
wakes HLT through the ordinary machine scheduler.

The default profile retains the bounded AT platform's 640KiB conventional and
512KiB extended RAM. `PCAT80386_EXPERIMENTAL_4M` is a separate opt-in profile
with 640KiB conventional plus 3456KiB extended RAM, matching the base and
extended sizes and checksum reported in CMOS. The surrounding 16MiB address
space exists for AT ROM decode; undeclared ranges remain open bus. Neither
profile claims a 4GiB installed-memory array or a complete 386-class chipset.
Legacy machine checkpoints, 16-bit debug-register snapshots
and 8088 cycle timing refuse explicitly because their codecs and timing tables
cannot represent this CPU. This adapter proves reset, bus, A20, port and interrupt wiring only. It is
not yet a 386 BIOS or operating-system boot qualification.

The configured cold board reset restores the 8042 output port with A20 enabled
before the first CPU step, so FFFFFFF0h reaches the reset alias. A CPU-only
reset while an external A20 gate is deliberately held low leaves bit 20 low and
does not invent a second alias. The bounded board profile does not claim that
unsupported combination can boot firmware.

The earlier four-clock profile passed PIT POST but its finite RTC polling
loop could end before the update-in-progress window. The current six-clock
profile passes a firmware-shaped regression that rejects the old charge and
observes both UIP assertion and clearing. The real BIOS then advances beyond
its date/time error prompt. This changes functional scheduling only; earlier
source-bound four-clock diagnostics and benchmark timings retain their scope.

The AT adapter advances board time by a declared six machine clocks for each
completed 386 instruction. This is a deterministic functional pacing policy:
it lets bounded firmware polling loops observe PIT/device progress while the
experimental executor lacks per-opcode 80386 timing. It is neither a measured
silicon timing table nor a cycle-accuracy claim. HLT continues to advance to
the next device deadline rather than receiving this flat instruction charge.
An interrupt that wakes HLT charges the handler instruction it actually
executes. Fault delivery with no completed instruction receives no flat charge.

`scripts/run-i80386-at-bios-diagnostic.mjs` executes an externally supplied,
hash-pinned IBM 5170 Rev1 ROM through this adapter. It admits a clean exact HEAD
and hashes every tracked JavaScript source plus the harness before execution,
then rejects source or HEAD changes afterward. Its result is always diagnostic:
budget exhaustion, architectural shutdown, an explicit unsupported opcode, and
a surfaced architectural fault are separate outcomes. HLT is left to the
machine scheduler so a pending device interrupt can wake it; HLT alone is never
reported as success. The runner does not claim POST or operating-system boot.

An optional `ataImage` plus explicit geometry attaches the bounded
`ExperimentalATA16` task-file device at 1F0h–1F7h/3F6h. Its data FIFO is one
native 16-bit access at 1F0h; the adapter does not split it into byte accesses
to 1F0h and 1F1h. It provides synchronous CHS/LBA sector reads and writes,
IDENTIFY data, persistent output bytes, status/error reporting and IRQ14.
Command latency, DMA, multiple-mode transfers, power management and a complete
WD1003/ATA compatibility claim remain outside this stage.
The interrupt-pending, `nIEN`, software-reset and PIO block boundaries follow
ATA-3 revision 7b sections 4.2.10, 5.2.7 and 8.2; device 1 remains explicitly
absent rather than aliasing the writable master image.
`PCAT80386_EXPERIMENTAL_4M_HDD` advertises one IBM BIOS drive type 1 in CMOS
(306 cylinders, 4 heads, 17 sectors). The bounded controller also implements
the recalibrate, verify, initialize-parameters, seek and diagnostic commands
used by the 1984 IBM AT fixed-disk BIOS. This profile and its command tests are
still controller-level evidence until a firmware-issued sector round trip is
recorded.
`scripts/run-i80386-at-hdd-roundtrip.mjs` supplies a deterministic owned FAT16
superfloppy with the same type-1 geometry. Its boot sector asks the real IBM
INT 13h path to write and reread the final physical sector, which lies outside
the declared FAT volume, and emits a success marker only after comparing the
returned bytes. The runner requires native 16-bit 1F0h accesses and records
every BIOS/guest task-file command. Until that runner produces an accepted
source-bound report, the image and controller tests remain preparation only.

## REP and ISA continuation receipt

The [continuation receipt](receipts/2026-09-19-386-rep-isa.json) binds execution
revision `a6de5455456efa05d7fb6a8017067607201140e7`: 91 focused tests, 266
admitted hardware samples, four owned PCjs comparisons and eight rejecting
mutation controls. Exception and LOCK-prefix exclusions remain explicit.
The unchanged diagnostic ROM reaches LLDT at CS00D0:EIP2AAC after 802,807
instructions; `accepted` and `fullRomPass` remain false. The separate external
IBM Rev1 BIOS probe now reaches SMSW at F000:060D after 1,100,307 instructions.
Neither diagnostic is an accepted 386 OS boot. Fresh DOS2 RTC-dependent write/reboot receipts pass at `439560e`; hosted
qualification passed at candidate `3fa9afa`: CI `35472633235`, CPU
`35472633257`, and native `35472633215`.

## System and stack continuation receipt

[The system/stack receipt](receipts/2026-09-19-386-system-stack.json) records
source `a797266`: 362 bounded hardware samples, five PCjs comparisons, ten
rejecting controls, and 111 focused tests (including the separately rerun
external parser cases). Candidate `68b6aa92d76ac9416451d9f0dc48db24c5254035` passed
[CI](https://github.com/CrispStrobe/bw-board/actions/runs/35473644024)
(5,527 pass, 272 skip),
[CPU qualification](https://github.com/CrispStrobe/bw-board/actions/runs/35473644021)
and [native contracts](https://github.com/CrispStrobe/bw-board/actions/runs/35473644044).
The exact external test386 reaches POST20 and refuses outer IRET. The genuine
386 AT BIOS reaches POST2A, then enters its CLI/HLT error path at F000:0C93;
the diagnostic budget result does not establish successful POST or boot.
Later privilege transitions and platform work require separate receipts.

## Ring, far-control and I/O continuation receipt

The source-bound [protection receipt](receipts/2026-09-19-386-protection.json)
records the integrated ring, far-call, conforming-code and I/O stage. The
unchanged test386 ROM reaches POST21 and stops at VM86 IRET after 805,601
steps; this is diagnostic progression, not full-ROM acceptance.

The pinned PCjs gate implementation derives a new CPL from the gate target
selector RPL (`segx86.js`, line 856). For the owned conforming interrupt it
therefore selects an inner stack, while original-386 semantics retain CPL3
and the current stack. The comparator separately requires the exact expected
local result and the exact known reference result; it does not claim equality
for that case. Denied I/O requires entry into the owned #GP handler, error
code zero, the restart EIP and saved CS, and zero port callbacks. A generic
reference abort is never accepted as proof of a protection fault.

## Functional AT platform continuation

The [platform receipt](receipts/2026-09-19-at-freedos-386-platform.json)
records a six-million-step run on the integrated 4MiB profile. POST31 samples
show successive DS bases 10000h, 20000h and 30000h, with about 852,831 executor
steps per 64KiB scan. This demonstrates forward RAM-test progress; it does not
qualify full POST or DOS boot. The separately accepted FreeDOS round trip uses
the functional 286 AT profile.

A one-million-step BIOS CPU profile attributes 70.3% of sampled self time to
instruction-state copying and 5.1% to garbage collection. This identifies an
optimization candidate; no speedup or fault-recovery simplification is claimed.
