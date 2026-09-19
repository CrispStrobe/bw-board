# x86 emulation lane

2026-09-19. Astra coordinates, audits and lands; up to two Sol agents implement
in separate worktrees. The user assigned 8086/8088 through 80286, eventual
80386DX, protected mode, performance and real software including Doom and
Windows. FPGA and SPICE/ASC schematic import/export belong to other lanes.

## Starting evidence

The qualified implementation is `84842a8678ef08766a6447618e0662c0f7cd40f2`;
`acb68f2` corrects documentation only. Both independent fast286 and Harris
semantic adapters passed 1,477,997 real-mode vectors (three revoked) in
[run 35438804417](https://github.com/CrispStrobe/bw-board/actions/runs/35438804417).
This does not establish protected mode or application compatibility.

Reference wired Harris has a fresh DOS-prompt receipt; compiled/scheduled wired
Harris has a historical source-pinned DOS-prompt receipt. See
[SST286-RUNNER.md](SST286-RUNNER.md) for execution-route boundaries. The shipped
fast-machine memory map remains one MiB with no PC/AT A20 or extended-memory
model. The real DOS persistence test initially covered only 8086 and 80186.

## Current increment

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
comparison independently matches the owned bootstrap. IDT delivery, full
instruction coverage, privilege transitions, gates and tasks remain unfinished;
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
instruction/address coverage followed by architectural exception delivery;
the next machine milestone is PC/AT memory and A20 behavior.

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
