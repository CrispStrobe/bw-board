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
| AT disk boot | Firmware reads actual mounted sectors via emulated controller/DMA and reaches an identifiable DOS shell; command/file round trip persists across reboot | Source-bound DOS2.00/Command2.02 ECHO/TYPE and fresh-boot TYPE pass, with exact file bytes, final prompts and linked image hashes; named functional AT profile only |
| 286 recovery | Correct contributory-fault escalation, #DF task entry, shutdown/recovery, TF and SS shadows; NPX absent/emulation boundaries | Landed at `3cd5927`; all three hosted qualification workflows green |
| 386DX CPU | 32-bit registers, FS/GS, operand/address prefixes, SIB, descriptor granularity/default sizes, system registers, protected gates/tasks, paging and v86 mode | Bounded independent 32-bit core passes owned PCjs and fixed real-mode hardware samples; original386 4KiB paging, reset, port I/O and group3 arithmetic now have bounded tests; complete ISA, privilege transitions, tasking and v86 remain |
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

The 286 DOS2 acceptance does not establish a 386 application platform. The
experimental 386 adapter still charges one device clock per completed CPU
instruction. Its current IBM timer POST failure needs a declared functional
pacing policy and device-observable tests; any such policy must remain distinct
from measured 386 instruction or bus timing.

The Doom target also requires a larger, separately named memory configuration
and corresponding CMOS report, persistent storage large enough for the pinned
EXE/WAD, and a VGA implementation matched to actual guest accesses. The current
AT profile provides 640KiB conventional plus 512KiB extended RAM. Repository
inspection found no AT hard-disk controller implementation. The existing
`vga-card.js` handles VGA registers and a linear mode-13h framebuffer, but does
not interpret planar VRAM. Reuse its valid device behavior while filling those
gaps; do not count a linear framebuffer demo as original Doom graphics proof.
A VGA option ROM or another explicitly identified firmware configuration must
supply the required BIOS services through guest execution.

FreeDOS's untouched installer medium reaches its prompt. Declining installation
must lead to an actual shell command/file round trip before acceptance; a
stopped banner or echoed choice is diagnostic progress only. Keep the original
image hash, saved-media hash, exact keyboard events and fresh-reboot receipt
linked. Windows acceptance still requires identified external installation
media; no Windows version has been executed by this lane.
