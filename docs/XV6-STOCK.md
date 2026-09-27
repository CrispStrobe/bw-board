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
```

The probe reports source-media hashes, serial output, input bytes, IRQs,
user-mode entries, and kernel symbol milestones. The 4 MiB boot and filesystem
sequence and the 15 MiB boot and shell command are accepted here. This does
not claim complete 386DX, x87, multi-CPU, timing, or broad xv6 regression
compatibility. Each run uses one xv6 CPU despite the stock SMP-capable kernel
and APIC setup.
