# AT, 386DX, Windows and Doom acceptance

2026-09-19. User-authorized continuation from `220b22b9db5326732c86f549877259d8acbcbb9d`.
Astra audits/integrates; two Sol agents implement independently. This is an
execution roadmap, not a compatibility receipt. Keep each completed milestone
usable and publish its exact source, input and qualification revisions.

## Ordered acceptance

| Milestone | Required observable result | Current evidence |
| --- | --- | --- |
| Genuine AT reset | 286 reset CS F000, IP FFF0, hidden CS base FF0000; physical reset fetch FFFFF0; ROM far jump removes reset base; RAM-preserving controller reset | Implemented with hidden-cache and same-selector far-reload tests; AT firmware first fetch verified |
| AT BIOS POST | Unmodified external IBM 5170 ROM executes timer, controller, memory and device checks; no host interception of firmware services | Rev1 completes POST and reaches INT19 without displayed errors; the owned DOS image requires the explicit 640KiB profile for its 9F84h SYSINIT relocation |
| AT disk boot | Firmware reads actual mounted sectors via emulated controller/DMA and reaches an identifiable DOS shell; command/file round trip persists across reboot | Source-bound DOS2.00/Command2.02 ECHO/TYPE and fresh-boot TYPE pass on functional286 and experimental386 AT profiles, with exact file bytes, final prompts and linked image hashes; FreeDOS persistence is accepted on functional286 only |
| 286 recovery | Correct contributory-fault escalation, #DF task entry, shutdown/recovery, TF and SS shadows; NPX absent/emulation boundaries | Landed at `3cd5927`; all three hosted qualification workflows green |
| 386DX CPU | 32-bit registers, FS/GS, operand/address prefixes, SIB, descriptor granularity/default sizes, system registers, protected gates/tasks, paging and v86 mode | Bounded independent 32-bit core passes owned PCjs and fixed real-mode hardware samples; original386 4KiB paging, reset, scalar I/O, privilege transitions and VM86 have bounded tests; complete ISA, tasking and full OS acceptance remain |
| Windows | Windows 3.0 standard mode, then a separately identified 386 enhanced-mode configuration; desktop plus keyboard-driven application open/edit/save/reopen | Original Windows 3.0 / PC DOS 3.2 disk reaches Program Manager on experimental386 AT; real Enter launches File Manager and displays C:\WINDOWS. Editing/persistence, enhanced mode and functional286 Windows remain separate |
| Doom | Exact DOS executable/WAD version, real DOS/extender startup, rendered gameplay, input and save/load or reproducible demo completion | Original shareware 1.9 boots through FreeDOS and reaches E1M1; controlled arrow and Ctrl inputs visibly move and fire, reducing ammo from 50 to 48. Completed demo or save/load remains separate |

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
revision `cfd052d1e64d5375dea5a681c1eadeed64ceda2c` is an external
CPU program derived from PCjs test386, under GPL-3.0-or-later. Its unchanged
default 64KiB configuration builds with NASM 2.16.01 to SHA-256
`a53356b0c6073434c3deb8baeed5fbb5f0e61cd027d2923311f6d5be39ed3c8b`.
Source and binary remain external. A capture build changes only POST/debug
ports to 80h/E9h, with SHA-256
`3c4859cac2235f6ef5e8dbf3d706d8226ad860e2a624be3f9751981fadca4067`.
The qualified REP/ISA snapshot at `a6de545` reaches POST00..06 and 08 in
802,807 instructions, then refuses LLDT. The subsequent worker snapshot
`f18b19a5d02640b90e0326010cf0fe3d5076e87c` adds system selectors, LEA and stack
instructions and reaches POST20 in 804,291 instructions, then explicitly
refuses privilege-changing IRET at CS00D0:EIP2B78. Both retain `accepted:false`
and `fullRomPass:false`; the later snapshot awaits hosted qualification.
This does not qualify the entire diagnostic or establish independent hardware
equivalence. The separate 386 AT BIOS diagnostic at `2758458` reaches
1,100,327 instructions and POST12, then refuses SIDT at F000:0667; it is not
a 386 DOS boot.
Continue pinned PCjs comparisons, resolving
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
configuration; `PCAT80286_BOOT_640K` now supplies it explicitly. The default
512KB profile remains available for the earlier POST evidence.

- Doom 1.9 archive SHA-256: `cacf0142b31ca1af00796b4a0339e07992ac5f21bc3f81e7532fe1b5e1b486e6`.
  `DOOM.EXE`: `b8020523561a5ad9706e009a52d61c578f37faafd85ac471962308406292ce27`.
  `DOOM1.WAD`: `1d7d43be501e67d927e415e0b8f3e29c3bf33075e859721816f652a526cac771`.
- FreeDOS 1.4 archive SHA-256: `45b1fa7c52dd996c3bfa5e352ffcd410781b952a6ad629f15a4c9ec4bbaefc5a`.
  `120m/x86BOOT.img`: `03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77`.

## Platform work after the first DOS boot

The 286 DOS2 and FreeDOS persistence acceptance do not establish a 386
application platform. The experimental 386 adapter now charges six functional
device clocks per completed CPU instruction, with actual IRQ-wake, idle and
fault-delivery checks. This resolves the observed IBM timer and RTC UIP polling failures; it
makes no measured instruction or bus timing claim. The separate 4MiB installed
memory profile has corresponding CMOS sizes and checksum.

The 386 BIOS continuation now passes POST, genuine INT19, DOS shell write
and fresh-machine TYPE persistence at combined execution source `72f56ab`.
The [DOS/HDD receipt](receipts/2026-09-20-386-at-dos-hdd.json) keeps source and
input hashes, exact file bytes and separate BIOS-sector evidence. The first
unchanged FreeDOS-on-386 continuation now reaches the shell and lists the
pinned Doom files on C: after correcting explicit 1.2MB media-rate detection.
The DOOM command is invoked; actual extender/game execution remains unaccepted. Snapshot copying is now optimized;
the isolated million-step BIOS benchmark and its limits are recorded in the
[snapshot receipt](receipts/2026-09-19-386-snapshot-performance.json).

An experimental ATA16 controller now supplies native word PIO and persistent
media bytes. IBM fixed-disk setup and an owned BIOS INT13 sector round trip
now pass. The next boundary is guest DOS access to exact EXE/WAD bytes on a
partitioned FAT16 disk, followed by real extender startup. The pinned Doom EXE/WAD needs that
storage and a VGA implementation matched to actual guest accesses. Existing
`vga-card.js` handles registers and a linear mode-13h framebuffer but does not
interpret planar VRAM. A VGA option ROM or another explicitly identified
firmware configuration must supply BIOS services through guest execution.

FreeDOS's unchanged installer medium now boots, declines installation, reaches
a shell, writes a file and reads it after a fresh machine remount. The tracked
fixture links original/saved media hashes, exact keyboard events and both
execution revisions. This accepted result uses the functional 286 AT profile.
Windows acceptance still requires identified external installation
media; no Windows version has been executed by this lane.
