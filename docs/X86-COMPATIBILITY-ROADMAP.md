# AT, 386DX, Windows and Doom acceptance

2026-09-19. User-authorized continuation from `220b22b9db5326732c86f549877259d8acbcbb9d`.
Astra audits/integrates; two Sol agents implement independently. This is an
execution roadmap, not a compatibility receipt. Keep each completed milestone
usable and publish its exact source, input and qualification revisions.

## Ordered acceptance

| Milestone | Required observable result | Current evidence |
| --- | --- | --- |
| Genuine AT reset | 286 reset CS F000, IP FFF0, hidden CS base FF0000; physical reset fetch FFFFF0; ROM far jump removes reset base; RAM-preserving controller reset | Implemented with hidden-cache and same-selector far-reload tests; AT firmware first fetch verified |
| AT BIOS POST | Unmodified external IBM 5170 ROM executes timer, controller, memory and device checks; no host interception of firmware services | Rev1 passes the refresh/controller checks, warm reset and checkpoint 30; protected memory scan advances through installed extended RAM |
| AT disk boot | Firmware reads actual mounted sectors via emulated controller/DMA and reaches an identifiable DOS shell; command/file round trip persists across reboot | Not yet demonstrated |
| 286 recovery | Correct contributory-fault escalation, #DF task entry, shutdown/recovery, TF and SS shadows; NPX absent/emulation boundaries | Landed at `3cd5927`; all three hosted qualification workflows green |
| 386DX CPU | 32-bit registers, FS/GS, operand/address prefixes, SIB, descriptor granularity/default sizes, system registers, protected gates/tasks, paging and v86 mode | Bounded independent 32-bit core passes owned PCjs and fixed real-mode hardware samples; system, paging and v86 work remains |
| Windows | First Windows 3.0 standard mode on 286; then a separately identified 386 enhanced-mode configuration, desktop plus keyboard-driven application open/edit/save/reopen | Not demonstrated; exact external media must be identified |
| Doom | Exact DOS executable/WAD version, real DOS/extender startup, rendered gameplay, input and save/load or reproducible demo completion | Original shareware 1.9 inputs pinned externally; not executed; a banner does not pass |

Windows 3.0 standard mode is the initial working target, not a claim covering
all Windows releases. Doom's version and media hashes must be fixed before its
acceptance run. Retain external proprietary media outside public repositories
and CI artifacts. Public notes can record hashes, provenance, test commands,
semantic outcomes and implementation defects.

## CPU implementation and evidence

Preserve the working real-mode production core while developing an opt-in 386
executor. A 32-bit register/address design must not inherit unconditional
16-bit masks from the 286 decoder. Audit fetch, effective addresses, stack
address size, operand size, arithmetic flags, precise faults and memory
preflight separately. Paging needs cross-page accesses, permissions, accessed/
dirty bits, CR2/error codes and TLB invalidation tests before an OS result.
Do not substitute a third-party emulator for our CPU and report its application
success as ours.

Architecture authority: Intel's [80386 Programmer's Reference Manual (1986)](https://pdos.csail.mit.edu/6.828/2018/readings/i386.pdf),
with original-386 behavior kept distinct from later x86 extensions.
[SingleStepTests/80386](https://github.com/SingleStepTests/80386)
revision `459d49fbe6280e9ed46fee887b58dacd9cb880ab` is a candidate real-mode
register/memory oracle. Its chip is 386EX, not DX; its bus timings and address
width do not establish DX timing/physical-bus equivalence. The published tests
do not cover protected mode, v86, TF or interrupts. Respect revoked cases.
[barotto/test386.asm](https://github.com/barotto/test386.asm)
revision `cfd052d1e64d5375dea5a681c1eadeed64ceda2c` is a candidate independent
CPU program; no execution result is claimed here. Review exact licensing and
build inputs before vendoring. Continue pinned PCjs comparisons, resolving
mismatches against Intel rather than silently adopting reference bugs.

## WIP revision discipline

Record the execution SHA plus hashes of the actual dependency files. Fetch
before integrating each worker. Preserve other lanes. Freeze source, tests,
notes and receipts for one exact-head hosted qualification; code changes after
qualification require relevant fresh evidence. Ledger-only merges follow the
repository's documented lean qualification rule. Never rename a failed or
budget-exhausted diagnostic into acceptance, or hide unsupported cases in pass
counts. Timing/performance claims require separately measured workloads.

## External acceptance inputs prepared

Original Doom shareware 1.9 DOS is available locally from the
[id Software archive mirror](https://ftp.gwdg.de/pub/misc/ftp.idsoftware.com/idstuff/doom/doom19s.txt).
Only input hashes and provenance are recorded here; no game bytes are vendored.
The split installer payload was concatenated and its ZIP read without executing
the installers. This is media preparation, not emulator execution evidence.

FreeDOS 1.4 provides an additional independent OS target. Its untouched 1.2MB
boot floppy comes from the [official floppy edition](https://www.freedos.org/download/)
and the archive matches the project's
[published SHA-256](https://www.freedos.org/download/verify.txt). The declared
640KB conventional-memory requirement needs a corresponding machine and CMOS
configuration; the existing 512KB boot profile does not satisfy it.

- Doom 1.9 archive SHA-256: `cacf0142b31ca1af00796b4a0339e07992ac5f21bc3f81e7532fe1b5e1b486e6`.
  `DOOM.EXE`: `b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27`.
  `DOOM1.WAD`: `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771`.
- FreeDOS 1.4 archive SHA-256: `45b1fa7c52dd996c3bfa5e352ffcd410781b952a6ad629f15a4c9ec4bbaefc5a`.
  `120m/x86BOOT.img`: `03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77`.
