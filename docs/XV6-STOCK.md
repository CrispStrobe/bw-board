# Stock xv6 x86 on the experimental 386 AT

The stock SMP MIT xv6-public kernel at `eeb7b415dbcb12cc362d0783e41c3d1f44066b17`
boots on the experimental 386 AT with either 4 MiB installed RAM or the IBM
BIOS-compatible 15 MiB profile. The pinned builder changes only `PHYSTOP` from
224 MiB to 4 MiB or 14 MiB, compiles for `-march=i386`, and produces both the
boot disk and xv6 filesystem disk.

The guest reaches `init: starting sh`, accepts input through COM1, executes an
external `echo` program, prints its result, and returns to the `$` prompt.
It also completes `echo BW_XV6_FS_OK > bwfile; cat bwfile; rm bwfile`, reads
the marker back from the filesystem, and returns to `$`.
The run observes user-mode execution, `exec`, system calls, the slave-disk IDE
interrupt on IOAPIC input 14, and COM1 receive interrupts on input 4. The
evidence is in [the stock xv6 boot receipt](receipts/2026-09-27-xv6-stock-shell.json).
The 14 MiB kernel on the 15 MiB machine also reaches the shell, executes
`echo BW_XV6_14M_OK`, and returns to `$`; its [memory-profile receipt](receipts/2026-09-27-xv6-stock-14m-memory-profiles.json)
records the image hashes, milestones, and the failed 16 MiB diagnostic.

The 4 MiB kernel also boots with the redistributable LGPL Bochs legacy BIOS
and VGA BIOS already vendored in this repository. It reaches the shell and
completes `echo BW_XV6_FREE_BIOS_FS_OK > bwfile; cat bwfile; rm bwfile` on
the attached xv6 filesystem disk. The [free-BIOS receipt](receipts/2026-09-27-xv6-stock-free-bios.json)
records the boot and command. Public CI now builds the pinned MIT xv6 source,
boots this firmware path, checks user-mode execution and IDE interrupts, and
uploads a fresh full probe receipt. It needs no proprietary ROM or xv6 image.
The Bochs BIOS needs the already-attached ATA slave visible from reset: its
boot path writes sector parameters while the slave remains selected, before
selecting the master and issuing the boot-sector read.
The 14 MiB kernel also boots with this free firmware on the 15 MiB RAM
profile, executes `echo BW_XV6_14M_FREE_OK`, and returns to `$`.
The stock `forktest` program also reports `fork test OK` and returns to the
shell after exercising process exhaustion and `wait`; CI runs it as a third
free-BIOS regression.
The stock `stressfs` program completes its five concurrent write/read phases
and returns to the shell in a bounded local run. Its own output does not check
file contents, so this is completion evidence rather than a filesystem data
integrity claim. The receipt records the serial transcript and step count.
The stock `usertests` program reaches `arg test passed` and completes its
four-worker `createdelete` phase at 163,992,924 instructions. A 120-million-step
run ended before that phase finished, while syscall activity continued; the
longer [prefix receipt](receipts/2026-09-27-xv6-stock-usertests-prefix.json)
establishes that the earlier cutoff was insufficient. The remaining `usertests`
phases have not yet been accepted.

The experimental 386 now reads page-table dwords directly from wholly mapped
RAM above 1 MiB, falling back to the byte bus for boundaries and devices.
A controlled 4 MiB `forktest` A/B completed the identical 24,338,279 guest
instructions and serial transcript in 59.27 seconds with this path versus
148.85 seconds with it disabled on the same host. The [performance receipt](receipts/2026-09-27-i80386-ram-dword-fast-path.json)
records source hashes and the comparison; wall time is host-dependent.
The longer `createdelete` prefix also completed at the same 163,992,924
instructions with identical serial output and kernel milestones after the
change. Its optimized local run took 406.55 seconds.

A later CPU profile of the same `forktest` found instruction snapshots to be
the largest single self-time cost (21.9 seconds in an 85.6-second sampled run).
The executor now retains prior segment-cache and task-state objects by reference
when making each instruction snapshot; it replaces those objects on updates.
A fresh unprofiled A/B took 68.20 seconds before and 48.28 seconds after
(1.41×) for the same 24,338,279 guest instructions, serial transcript,
interrupts, milestones, and final CPU state. The [snapshot performance receipt](receipts/2026-09-27-i80386-snapshot-fast-path.json)
records the measurement; host load can change wall time.

The IBM 5170 [Technical Reference](https://www.minuszerodegrees.net/manuals/IBM/IBM_5170_Technical_Reference_1502243_MAR84.pdf)
maps motherboard ROM near the top of its 24-bit address space. Advertising
RAM through that window caused the BIOS to stop at `164-Memory Size Error`.
The 15 MiB profile reserves the top MiB and advertises 14 MiB extended RAM
in CMOS. This is an inference from the map and the two bounded POST runs;
the 16 MiB profile remains diagnostic and unaccepted with this BIOS.

To reproduce locally, check out the pinned xv6 source and provide a lawful AT
BIOS ROM. The ROM is external and is not part of this repository:

```sh
git clone https://github.com/mit-pdos/xv6-public.git /tmp/xv6-public
git -C /tmp/xv6-public checkout eeb7b415dbcb12cc362d0783e41c3d1f44066b17
node scripts/build-xv6-stock-4m.mjs
XV6_ROM=/path/to/ATBIOS.rom XV6_STEPS=80000000 \
  XV6_COMMAND=$'echo BW_XV6_OK\r' \
  XV6_EXPECT_SERIAL=$'\nBW_XV6_OK\n$ ' node scripts/probe-xv6-stock.mjs

XV6_PHYSTOP=0xE00000 node scripts/build-xv6-stock-4m.mjs
XV6_ROM=/path/to/ATBIOS.rom XV6_PROFILE=14m XV6_STEPS=320000000 \
  XV6_STOP_ON_EXPECT=1 XV6_COMMAND=$'echo BW_XV6_14M_OK\r' \
  XV6_EXPECT_SERIAL=$'\nBW_XV6_14M_OK\n$ ' node scripts/probe-xv6-stock.mjs

XV6_FIRMWARE=bochs XV6_STEPS=30000000 XV6_STOP_ON_EXPECT=1 \
  XV6_COMMAND=$'echo BW_XV6_FREE_BIOS_FS_OK > bwfile; cat bwfile; rm bwfile\r' \
  XV6_EXPECT_SERIAL=$'\nBW_XV6_FREE_BIOS_FS_OK\n$ ' \
  node scripts/probe-xv6-stock.mjs

XV6_FIRMWARE=bochs XV6_PROFILE=14m XV6_STEPS=30000000 XV6_STOP_ON_EXPECT=1 \
  XV6_COMMAND=$'echo BW_XV6_14M_FREE_OK\r' \
  XV6_EXPECT_SERIAL=$'\nBW_XV6_14M_FREE_OK\n$ ' \
  node scripts/probe-xv6-stock.mjs

XV6_FIRMWARE=bochs XV6_STEPS=40000000 XV6_STOP_ON_EXPECT=1 \
  XV6_COMMAND=$'forktest\r' XV6_EXPECT_SERIAL=$'fork test OK\n$ ' \
  node scripts/probe-xv6-stock.mjs

XV6_FIRMWARE=bochs XV6_STEPS=100000000 XV6_STOP_ON_EXPECT=1 \
  XV6_COMMAND=$'stressfs\r' XV6_EXPECT_SERIAL=$'read\n$ ' \
  node scripts/probe-xv6-stock.mjs

XV6_FIRMWARE=bochs XV6_STEPS=250000000 XV6_STOP_ON_EXPECT=1 \
  XV6_COMMAND=$'usertests\r' XV6_EXPECT_SERIAL=$'createdelete ok\n' \
  node scripts/probe-xv6-stock.mjs
```

The probe reports source-media hashes, serial output, input bytes, IRQs,
user-mode entries, and kernel symbol milestones. The 4 MiB boot and filesystem
sequence and the 15 MiB boot and shell command are accepted here. This does
not claim complete 386DX, x87, multi-CPU, timing, or broad xv6 regression
compatibility. Each run uses one xv6 CPU despite the stock SMP-capable kernel
and APIC setup.
