# x86 emulation lane

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

2026-09-19. Astra coordinates, audits and lands; up to two Sol agents implement
in separate worktrees. FPGA and SPICE/ASC schematic import/export belong to other lanes.

## Current checkpoint (2026-10-05)

Use [the loading guide](X86-LOADING-GUIDE.md) for the distinct direct-program,
functional AT, wired Harris and fixed native diagnostic paths. Lite now exposes
local FreeDOS floppy/HDD and DOSBox HDD forms, VGA widgets and Controller
fullscreen controls. That GUI source audit is separate from a new guest run.
ZIP/package extraction, ISO/CD-ROM loading and CLI disk writeback/export remain
unfinished. The language/device matrix still needs explicit 286/386 coverage;
its native-language notation does not identify a CPU backend.

The native 386 lane has bounded protected-stack and nonidentity-paging parity
results; see [protected stack](I80386-PROTECTED-STACK-RESULTS.md) and
[nonidentity paging](I80386-NONIDENTITY-PAGING-RESULTS.md). The paged INT/IRET
fixture now has a [native/JS INT and IRET correctness result](I80386-PAGED-INT-IRET-RESULTS.md):
41 N/Q, a real nonidentity SS frame, fourteen named cuts and ten copied pages.
Its declared prefetch transitions remain unmatched, and whole RAM is compared
by hash. The separate [private JS page-fault recovery/retry source control](I80386-PAGED-PAGEFAULT-JS-SOURCE.md)
now retains a genuine error frame, CR3 reload, IRET and once-only store retry:
57 attempts, 56 completed Q and ten full copied pages. Native page-fault
admission and differential execution remain the next separate correctness step.
A [finite native PF ownership/ledger source policy](I80386-PAGED-PAGEFAULT-NATIVE-POLICY-SOURCE.md)
passed six manufactured controls. A [concrete fault-admitted runtime/provider and differential driver source](../scripts/bochs-cpu3-native-paged-pagefault/NATIVE-DRIVER-SOURCE.md) now retains an initial seven-pass/one-fixture-failure capture and a separate passing affected-case repair. Its production acceptance remains strict. The first fresh PF static build (run 37262460989, new DSO `14bc8ef0`) passed independent audits without loading an addon. The source-owned READY binding and counted 4 MiB manifest reader retain an initial two-pass/two-header-failure epoch and two repaired affected passes, with 106 current/Git inputs. [Exact compact receipts](receipts/i80386-paged-pagefault-ready-driver-source-20261005/index.json) preserve both epochs; actual native PF execution remains pending.
These small owned programs do not qualify the addon as a general OS loader.

Two first evidence attempts remain failures. The [owned paged INT/IRET run](https://github.com/CrispStrobe/bw-board/actions/runs/37242883561) initialized the native addon, then failed while persisting an oversized receipt; no capture or divergence survived, so instruction execution, parity and closure are unknown. The [native-symbol observation](https://github.com/CrispStrobe/bw-board/actions/runs/37243459679) returned an observer failure and could not upload its root-owned output directory; no artifact exists, and the original observer cause and worker/native extent are unknown. Those first failures remain unchanged. A separately source-qualified INT/IRET observation now passed with lossless compressed evidence; see the result above. The evidence-export attempt is a separate profiling checkpoint. See the [preserved profiling failure](receipts/i80386-native-symbol-first-export-failure-20261004/index.json) and [manufactured export controls](receipts/i80386-native-symbol-evidence-export-controls-20261004/index.json). These diagnostics use owned fixtures and freely licensed inputs, and provide no new speed or broader software-compatibility result.

The latest [paired scalar benchmark](I80386-COLD-PAIRED-RESULTS.md)
retained the JS baseline: on a GitHub-hosted AMD EPYC 7763 runner, the native
candidate used 5.25 times the execution CPU time and 8.94 times the execution
wall time. Configured virtual time divided by mean wall time was 1.594 RTx
for JS and 0.178 RTx for native. Those are fixed-workload measurements, not
physical 16 MHz 386DX calibration or VPS/Kaggle comparisons. A corrected [native-symbol observation](I80386-NATIVE-SYMBOL-OBSERVATION.md) now has terminal parity and 165 decoded CPU-clock leaves (136 main-thread, 29 background). Its Xeon 8573C host differs from the paired EPYC host; unresolved frames and unproven clock alignment prevent native cost-share or execution-only claims. Callback/property and allocation source analysis is next; the tenfold target remains unfinished.

The earlier milestone sections below preserve their original source-bound
results. Their “next” statements describe those historical checkpoints.
Licensed guest reproduction notes and their original Markdown remain in the
private archive linked above.

## Historical AT boot through applications (2026-09-20)

The historical qualified implementation was `74c47bbe250bb96c7a65f17539c2bbae935025ad`,
merged to master. Its [CI](https://github.com/CrispStrobe/bw-board/actions/runs/35490696573),
[CPU qualification](https://github.com/CrispStrobe/bw-board/actions/runs/35490696554)
and [native qualification](https://github.com/CrispStrobe/bw-board/actions/runs/35490696525)
passed. The
[application receipt](receipts/2026-09-20-x86-application-persistence.json)
records exact source/input hashes and the retained failed diagnostics. These are bounded experimental milestones.

At this checkpoint, application acceptance was CLI-driven and a browser AT
adapter was still pending. The current GUI loading guide above supersedes that
old implementation status; it does not retroactively turn these CLI receipts
into browser acceptance.

The functional 286 AT profile boots MIT-released DOS 2.00/Command 2.02, writes a file through the guest shell and reads it in a
fresh boot. Unchanged official FreeDOS 1.4 also completes guest write and
fresh-remount read acceptance. BIOS and media bytes remain external. See
[AT boot evidence](I80286-AT-BOOT.md) and the
[FreeDOS/platform receipt](receipts/2026-09-19-at-freedos-386-platform.json).

The independent [386 executor](I80386-EXPERIMENTAL.md) remains opt-in and
incomplete. Landed stages cover protected far control, privilege transitions,
TSS I/O permissions, VM86 entry/interrupt/return, BIOS selector checks, common
compiler ISA, functional AT pacing and experimental ATA disk access. The
current continuation now passes genuine BIOS POST, INT19, DOS 2 shell write,
and fresh-machine file persistence on the 386. A separate owned HDD boot program
writes and verifies all 512 bytes of a sector through BIOS INT13. These are
source-bound at `72f56ab1a5a4606e17d821bed2bb1e3ac36a998e`; see the
[DOS/HDD receipt](receipts/2026-09-20-386-at-dos-hdd.json). The unchanged test386 capture now reaches a named
paging accessed-bit disagreement; it has not passed the complete ROM.

The earlier firmware workload benchmark and exact firmware reproduction
context are retained in the
[private firmware notes](https://github.com/CrispStrobe/brickwright-firmware-private/blob/master/docs/LEGACY-PC-FIRMWARE.md).

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
external compiler test skipped because external compiler executable is absent. Real Microsoft DOS/MASM/LINK/
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
integration. None of those results follows automatically from these eight programs.

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
broader guest/broader game compatibility claim. The next CPU milestone is broader protected
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
required instruction and machine contracts are covered. 386DX, broader guest and
broader game remain later acceptance targets, not results of this increment.

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
switching with fault tests, then a reproducible existing protected-mode binary. The AT side still needs keyboard protocol/reset and BIOS/disk/DMA integration. Choose and inventory an exact existing binary before broadening its required
contracts. 386DX, broader guest and broader game remain later milestones; this increment does
not establish compatibility with them.

## Milestones and acceptance

| Stage | Concrete acceptance | Still separate |
| --- | --- | --- |
| Real 286 DOS software | Boot the pinned DOS kernel/shell, create a file, reboot, read and overwrite it; execute the supplied assembler/linker tools and run their output | BIOS-assisted functional machine versus wired peripheral execution |
| 286 protected execution | Owned guest enters through LGDT/LMSW/far transfer; uses independently cached code/data/stack descriptors and high physical memory; explicit negative permission/limit cases | Ring transitions, gates, tasks and full exception delivery until individually implemented |
| PC/AT machine | Configurable extended RAM, A20/reset behavior, interrupt controllers, RTC/keyboard/disk/video integration; guest-visible checks | Device timing versus functional state |
| 386DX architecture | 32-bit registers/operands/addresses, prefixes, expanded descriptors and control registers, paging and virtual-8086 mode; explicit exception tests | No automatic compatibility claim from an ISA label |
| Applications | Versioned executable/media manifests; startup, interaction, persistence and repeatable output for each broader guest release or game | A splash screen alone is not acceptance |
| broader game | Run the chosen DOS executable and extender in the emulated machine; reach gameplay and complete a repeatable demo with framebuffer/output checks | Recompiling a host-native port does not prove DOS/386 emulation |

Start with small owned protected guests,
then increasingly demanding existing binaries. Keep first failures and their
minimal reproductions rather than weakening the acceptance criterion.

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

The public historical MASM/LINK/EXE2BIN results here use the specific 1982
tools in Microsoft's [MIT-licensed release](https://github.com/microsoft/MS-DOS/blob/2d04cacc5322951f187bb17e017c12920ac8ebe2/LICENSE):
[MASM 1.10](https://github.com/microsoft/MS-DOS/blob/2d04cacc5322951f187bb17e017c12920ac8ebe2/v2.0/bin/MASM.EXE),
[LINK 2.00](https://github.com/microsoft/MS-DOS/blob/2d04cacc5322951f187bb17e017c12920ac8ebe2/v2.0/bin/LINK.EXE)
and [EXE2BIN](https://github.com/microsoft/MS-DOS/blob/2d04cacc5322951f187bb17e017c12920ac8ebe2/v2.0/bin/EXE2BIN.EXE).
Their local bytes were checked against that official revision on 2026-10-04;
the [provenance receipt](receipts/2026-10-04-msdos2-toolchain-provenance.json)
retains the exact hashes, matching the historical guest receipt. This release
license does not cover unrelated later assembler/compiler releases.

The [real N-API key-helper fixture](../scripts/property-key-real-napi-qualification/SOURCE.md) passed its bounded helper-plus-fixture checks; it establishes neither guest parity nor speed. A [separate compact-progress source candidate](../scripts/bochs-cpu3-native-compact-progress/README.md) proposes smaller production returns while retaining requested full snapshots and the immutable diagnostic comparator.
