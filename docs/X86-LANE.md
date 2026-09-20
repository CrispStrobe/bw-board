# x86 emulation lane

2026-09-19. Astra coordinates, audits and lands; up to two Sol agents implement
in separate worktrees. The user assigned 8086/8088 through 80286, eventual
80386DX, protected mode, performance and real software including Doom and
Windows. FPGA and SPICE/ASC schematic import/export belong to other lanes.

## Active continuation: AT boot through applications

The user authorized continued implementation toward genuine AT boot, 386DX,
Windows and Doom. The [acceptance roadmap](X86-COMPATIBILITY-ROADMAP.md) fixes
observable milestones and distinguishes the first Windows target from broader
compatibility. Two Sol workers now own AT platform integration and the new
386 core; Astra audits, integrates and maintains source-bound evidence.

The latest landed milestone is `88d960eecb566db3939710b844ca03a36e5ea8c1`,
tag `milestones/x86-386-vm-isa-platform-20260920`. Its [CI](https://github.com/CrispStrobe/bw-board/actions/runs/35477928736)
passed 5,614 tests with 272 skips and zero failures; [CPU qualification](https://github.com/CrispStrobe/bw-board/actions/runs/35477928733)
and [native qualification](https://github.com/CrispStrobe/bw-board/actions/runs/35477928839)
also passed. CPU qualification covers the existing full fast/Harris corpora,
443 selected physical 386EX cases and bounded PCjs comparisons. The exact
qualified candidate was fast-forwarded to master.

The functional 286 AT profile executes the external IBM Rev1 BIOS, boots
DOS 2.00/Command 2.02, writes a file through the guest shell and reads it in a
fresh boot. Unchanged official FreeDOS 1.4 also completes guest write and
fresh-remount read acceptance. BIOS and media bytes remain external. See
[AT boot evidence](I80286-AT-BOOT.md) and the
[FreeDOS/platform receipt](receipts/2026-09-19-at-freedos-386-platform.json).

The independent [386 executor](I80386-EXPERIMENTAL.md) remains opt-in and
incomplete. Landed stages cover protected far control, privilege transitions,
TSS I/O permissions, VM86 entry/interrupt/return, BIOS selector checks, common
compiler ISA, functional AT pacing and experimental ATA disk access. The
current continuation reaches genuine INT19 and an exact floppy boot-sector
handoff after adding absent-NPX handling; DOS shell/file and BIOS HDD
acceptance are being measured separately. The unchanged test386 capture now reaches a named
paging accessed-bit disagreement; it has not passed the complete ROM.
Windows and Doom remain unexecuted acceptance targets.

An isolated snapshot-copy comparison reduced median host time for the same
million-step BIOS workload by 5.19 times. All six runs matched the recorded
architectural state, POST trace and interrupts. This is a single-host workload
result, not silicon timing or full-boot acceptance. The
[benchmark receipt](receipts/2026-09-19-386-snapshot-performance.json) records
exact source hashes, reconstruction, trial timings and report hashes.

## Earlier milestone: common ISA, gates, tasks and existing binaries

The opt-in protected executor now implements the common multiply/divide,
frame/stack, pointer, bounds, BCD, port-string and selector-query families;
far CALL/JMP/RETF; call gates with parameter copying; and 286 hardware task
CALL/JMP, task gates and nested-task IRET. Conforming code, expand-down stack
limits, MSW.TS/CLTS, outgoing TSS saves, busy/backlink/NT behavior and incoming
LDTR/cache loading are covered. Task faults after the commit point retain the
incoming context; they do not restore the outgoing task. The detailed Intel
Appendix B sequence is the documented basis where its overview table differs.
See [the common ISA](I80286-PROTECTED-COMMON-ISA.md) and
[far/task contracts](I80286-FAR-CONTROL-EXPERIMENT.md).

Eight unchanged MIT-licensed JA1UMI boot images now complete their declared
local acceptance checks. Five finish their own text-output loops; two complete
repeated dispatch/return through two tasks; the eighth completes two interrupt
task entries and returns across privilege levels. Inputs, original upstream
revision and license are pinned in the repository. The harness supplies a BIOS
handoff and deterministic retrace input; it does not execute an AT BIOS or
claim a protected DOS application result.

Seven images are also compared against exact pinned PCjs. The result is
`pass-with-known-oracle-differences`, not full equality: PCjs retains inaccessible
DS/ES after outer RETF, loses dispatcher IOPL on task return, and differs in
seven saved-TSS bytes per dispatch example. The grader requires the exact
manual-derived local state and the exact observed reference differences;
every other graded byte/field must agree. The eighth PCjs image is a separately
identified historical reset diagnostic. See [the image qualification](I80286-PROTECTED-EXTERNAL-IMAGES.md)
and [receipt](receipts/2026-09-19-protected286-external-images.json).

Local combined validation: 120 protected/image/AT tests passed; 31 current
BASIC/C/menu/toolchain tests passed; 15 DOS tests passed, with one optional
Turbo C test skipped because TCC.EXE is absent. Real Microsoft DOS/MASM/LINK/
EXE2BIN execution remains green. Six owned PCjs comparisons passed; the external
comparison has zero unexpected differences. Five external result mutations
(video, task return, input hash, sector and saved task state) were each rejected
at their exact expected fields. Affected protected and AT-memory receipts were
rerun against the combined source; unchanged DOS/device dependencies retain
their earlier source-bound receipts.

Astra integrated concurrent BASIC/C and NMOS work before freezing qualification.
Hosted CI, full real-mode 286 corpora and Harris native contracts qualify the
frozen combined head before landing. The milestone tag records their links.
No new wired speed result or production fast-core change is claimed.

Next separate acceptance work is complete exception/trap/double-fault recovery,
NPX boundaries and broader protected OS software, plus AT BIOS/reset/disk/DMA
integration. The 386DX register/address/operand and paging model is still a
separate implementation, followed by versioned Windows and Doom application
runs. None of those results follows automatically from these eight programs.

The sections below retain the milestone history; their “next” paragraphs refer
to the state at each earlier increment.

## Starting evidence

The initial qualified implementation was `84842a8678ef08766a6447618e0662c0f7cd40f2`;
`acb68f2` corrects documentation only. Both independent fast286 and Harris
semantic adapters passed 1,477,997 real-mode vectors (three revoked) in
[run 35438804417](https://github.com/CrispStrobe/bw-board/actions/runs/35438804417).
This does not establish protected mode or application compatibility.

Reference wired Harris has a fresh DOS-prompt receipt; compiled/scheduled wired
Harris has a historical source-pinned DOS-prompt receipt. See
[SST286-RUNNER.md](SST286-RUNNER.md) for execution-route boundaries. The shipped
fast-machine memory map remains one MiB with no PC/AT A20 or extended-memory
model. The real DOS persistence test initially covered only 8086 and 80186.

## Initial DOS/protected increment

The real DOS 2 kernel and shell now exercise persistence on 80286 as well as
8086/80186. On fast 286, the actual Microsoft MASM, LINK and EXE2BIN binaries
build an owned guest program inside DOS and execute its exact expected COM
bytes: `GUEST-TOOLCHAIN-OK`, shell return, no unsupported services, 1,111,040
steps. See [the source-bound receipt](receipts/2026-09-19-dos-toolchain-fast286.json).
This uses the machine's BIOS services. The high-memory word shortcut now follows
the CPU address policy, fixing 286 reads/writes incorrectly aliasing low RAM.

An [opt-in protected executor](I80286-PROTECTED-EXPERIMENT.md) proves ring-0 GDT
entry, separate hidden segment caches, accessed bits, high memory, bounded
permission/limit checks and restart diagnostics. Its small instruction subset
is isolated to preserve the production decoder's throughput. A pinned PCjs
comparison independently matches the owned bootstrap. Full
instruction coverage, privilege transitions, call/task gates and comprehensive
exception handling remain unfinished;
the ordinary fast core explicitly refuses continued protected execution.

[Native writer suppression](HARRIS-NATIVE-WRITER-SUPPRESSION.md) removes
2,004,603 unchanged submissions in the fixed memory-only workload, preserving
state, progress and unaffected counters. Twelve paired timing samples remain
inconclusive; no stable speedup is claimed. The measurement source history is
retained at tag `receipts/astra-x86-native-20260919` so the receipt's original
candidate and harness revisions remain available after integration.

Qualification now includes hash-pinned real DOS toolchain execution and the
protected PCjs bootstrap, alongside the full real-mode 286 corpora and native
contracts. These are separate acceptance results, not a full protected-mode or
Windows/Doom compatibility claim. The next CPU milestone is broader protected
instruction/address coverage followed by remaining exception and privilege machinery;
the next machine milestone is PC/AT memory and A20 behavior.

## Same-ring IDT continuation

The optional protected executor now admits 286 ring-0 interrupt and trap gates,
`INT`, `INT3`, `INTO`, same-ring `IRET`, and delivery of its supported
#UD/#NP/#SS/#GP faults. Enable it with `{deliverProtectedFaults:true}`; the
default preserves host-visible diagnostics. Frame construction and return
validation preflight the full stack span. The gate selector is normalized,
interrupt/trap IF behavior differs correctly, and protected IRET restores flags
that real-mode IRET must clear.

An owned guest now reaches its #GP handler, consumes the error code, replaces
the faulting return address, returns through IRET and reaches HLT. The pinned
PCjs comparison checks the full entry/return state and independently requires
the expected guest completion. Its negative controls must fail for the exact
corrupted frame, IF or restart-IP observation. See
[the IDT oracle scope](PROTECTED286-IDT-PCJS-ORACLE.md) and
[the source-bound receipt](receipts/2026-09-19-protected286-idt.json).

Two PCjs disagreements are recorded separately: its handling of target-selector
RPL and stack-frame wraparound. Those historical same-pin observations are not
counted as passing differential cases. Local architectural boundary tests
follow Intel's manual. Task/privilege transitions, TF single-step delivery and
nested/double-fault delivery remain explicit unsupported boundaries. Malformed
public hardware interrupt delivery returns a diagnostic fault to the host.

This increment also incorporates upstream widget/PS2, gamepad, and terminal DOS
runner work. The terminal runner supplies DOS services directly; the existing
MASM/LINK/EXE2BIN acceptance boots the real DOS kernel. Keep those execution
routes distinct. Its DOS receipt was refreshed because upstream changes altered
`src/i8086-machine.js`, even though the guest output and instruction count stayed
the same. Broader protected instruction/address coverage and PC/AT memory/A20
remain the next implementation steps.

## Protected ISA and extended-memory continuation

The remote review for this increment started at
`028a387a48b119f023b13aaad7ebe324f72839b1`. Since the IDT milestone,
upstream added a drawable PS/2 mouse, corrected the DOS host-service arena,
and added terminal runner file mounting and artifact collection. A further refresh incorporated
`b3a8aa2` with MASM/LINK/EXE2BIN chain support and its guarded test. Concurrent
analog changes are retained. The host-service runner and real DOS kernel
acceptance remain distinct.

The experimental executor now supports the complete 16-bit ModR/M address
matrix, common MOV and arithmetic forms, near calls/returns, conditional
branches and loops. An owned high-memory arithmetic guest is compared with
the pinned PCjs implementation. This extends the supported subset; it does
not establish complete 286 instruction coverage. REP, privilege/task
transitions, and nested/double-fault delivery remain unfinished.

[Extended memory and A20](EXPERIMENTAL-AT-MEMORY.md) are explicit machine
options. The bounded 8042 D0/D1 interface lets guest software switch A20;
the gate clears only bit 20 and preserves higher address bits. The optional
protected backend runs through the machine bus and skips the RAM word
shortcut so segment protection cannot be bypassed. Its machine checkpoints
are explicitly unavailable until hidden CPU state has a complete codec.
Default CPU checkpoints include the configured A20 controller state.

Fresh source-bound receipts record the [protected ISA guest](receipts/2026-09-19-protected286-isa.json),
[AT memory guest](receipts/2026-09-19-at-memory-guest.json), and refreshed
IDT and real DOS toolchain results. Default-path timing samples overlap
widely; this increment makes no speed claim. The combined focused Node 22
validation passed 71 tests, including the upstream DOS chain. Pinned PCjs
bootstrap, IDT and ISA comparisons passed. The final branch head is qualified
by hosted CI, the full 286 corpora and native contracts before landing; run
links are recorded in the milestone tag to avoid another source-only SHA bump.

Next, expand protected execution with restartable string operations and the
remaining common instruction families, then implement privilege/LDT/TSS
machinery against independent architectural cases. The machine needs a
complete AT keyboard/reset path, cascaded interrupt controllers and RTC
before a PC/AT compatibility claim. Retain small owned reproducers for each
new capability, and introduce existing protected-mode binaries once their
required instruction and machine contracts are covered. 386DX, Windows and
Doom remain later acceptance targets, not results of this increment.

## Restart, privilege and AT device increment (2026-09-19)

The experimental protected executor now supports restartable byte/word strings
with REP/REPE/REPNE and a wider common instruction subset. Each completed
iteration survives a later fault. A pinned PCjs guest demonstrates a real #GP
handler repairing the descriptor and returning to finish REP MOVSW.

LLDT/LTR cache LDT/TSS descriptors, LTR marks the TSS busy, and bounded
nonconforming privilege transitions use the TSS stack. A second PCjs guest
returns to ring 3, reads LDT data, enters a ring-0 handler, returns outward,
and enters a final handler. This is a privilege-transition result, not hardware
task switching. The focused tests exercise fault codes, preflight behavior,
flag permissions, descriptor caches, and machine interrupt arbitration.

The opt-in [AT device profile](AT-DEVICE-PROFILE.md) adds keyboard command-byte
and queue behavior, cascaded PIC delivery, and deterministic RTC/NMI handling.
An owned IRQ8 guest reads status C, sends both EOIs, returns, and halts. Audit
reproducers cover exact checkpoint restore after acknowledged keyboard/RTC
interrupts, malformed RTC state rejected before machine mutation, and unrelated
A20 changes preserving IRQ edges. Protected-machine checkpoint encoding remains
explicitly unsupported.

Upstream DOS chain execution, allocation/free/resize, and the toolchain
registry were merged before integration checks. The real DOS kernel/shell
still runs MASM, LINK, EXE2BIN and the generated COM to `GUEST-TOOLCHAIN-OK`
in 1,111,040 steps. This uses the fast real-mode core and BIOS-service machine.
No new wired throughput or full AT boot result is claimed.

Receipts under `docs/receipts/2026-09-19-*` record affected source hashes and
actual execution revisions. Local validation passed 93 focused tests (54 protected CPU, 20 AT/machine,
19 DOS/toolchain); all five pinned PCjs guests passed and the new REP and
privilege negative controls rejected exactly their intended field.
Hosted qualification runs on the frozen combined
head before landing; the milestone tag records run links without another code
revision. The independently evolving lanes remain on their own scopes.

Next acceptance targets are the remaining common protected instructions
(including multiply/divide and far procedure transfers), call gates and task
switching with fault tests, then a reproducible existing protected-mode binary.
The AT side still needs keyboard protocol/reset and BIOS/disk/DMA integration.
Choose and inventory an exact existing binary before broadening its required
contracts. 386DX, Windows and Doom remain later milestones; this increment does
not establish compatibility with them.

## Milestones and acceptance

| Stage | Concrete acceptance | Still separate |
| --- | --- | --- |
| Real 286 DOS software | Boot the pinned DOS kernel/shell, create a file, reboot, read and overwrite it; execute the supplied assembler/linker tools and run their output | BIOS-assisted functional machine versus wired peripheral execution |
| 286 protected execution | Owned guest enters through LGDT/LMSW/far transfer; uses independently cached code/data/stack descriptors and high physical memory; explicit negative permission/limit cases | Ring transitions, gates, tasks and full exception delivery until individually implemented |
| Complete 286 protection | Privilege checks, LDT/TSS, gates, interrupt/exception delivery and restart, task switching; independent architectural comparisons and regression guests | PC/AT devices and actual Windows compatibility |
| PC/AT machine | Configurable extended RAM, A20/reset behavior, interrupt controllers, RTC/keyboard/disk/video integration; guest-visible checks | Device timing versus functional state |
| 386DX architecture | 32-bit registers/operands/addresses, prefixes, expanded descriptors and control registers, paging and virtual-8086 mode; explicit exception tests | No automatic compatibility claim from an ISA label |
| Applications | Versioned executable/media manifests; startup, interaction, persistence and repeatable output for each Windows release or game | A splash screen alone is not acceptance |
| Doom | Run the chosen DOS executable and extender in the emulated machine; reach gameplay and complete a repeatable demo with framebuffer/output checks | Recompiling a host-native port does not prove DOS/386 emulation |

Windows is a family of targets: record the exact release and execution mode
before making a compatibility claim. Start with small owned protected guests,
then increasingly demanding existing binaries. Keep first failures and their
minimal reproductions rather than weakening the acceptance criterion.

The [Intel 80286 programmer's reference](https://bitsavers.org/components/intel/80286/210498-005_80286_and_80287_Programmers_Reference_Manual_1987.pdf)
is the architectural basis for the protection work; independent emulator
comparisons complement it. [id Software's source-release README](https://github.com/id-Software/DOOM/blob/master/README.TXT)
describes a Linux source release, so building that release alone cannot stand
in for the DOS executable milestone.

## Performance work

Measure fixed inputs and configurations on the same host. Keep startup,
uncapped sustained execution, paced browser throughput, tracing, and wired
clock capacity distinct. Preserve reference execution and guest-visible state.

The next wired experiments follow the measured producer profile: avoid
unchanged external-bus/latch submissions, then measure the cost of native
execution separately from receipt materialization. Empty-settle elimination
requires evidence that no pending net or device event is lost. Existing dirty
queues, sparse evaluation and admitted memory paths must not be reimplemented
as if they were missing. Each improvement needs a matching behavior comparison
and a same-host performance receipt before it earns a speed claim.

## Revisions and software inputs

Record full source revisions, relevant file hashes, guest input hashes,
configuration, runtime and acceptance predicates in receipts. A historical
result remains historical; source-hash equivalence can justify reuse only for
its declared dependencies. Refresh an affected receipt when those dependencies
change. Batch Lite pin adoption after a meaningful qualified upstream milestone;
do not churn a package pin for every documentation edit or speculative branch.

Local DOS tools currently live outside the repository in
`/mnt/volume1/code/msdos-v2-bin`; use `MSDOS_BIN_DIR` to select them. Automated
public fixtures should identify their exact upstream revision and bytes. Guest
media and test results are separate artifacts; receipts must not silently
substitute a different executable, host service, CPU model or execution mode.
