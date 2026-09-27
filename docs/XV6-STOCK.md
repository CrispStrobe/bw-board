# Stock xv6 x86 on the experimental 386 AT

The stock SMP MIT xv6-public kernel at `eeb7b415dbcb12cc362d0783e41c3d1f44066b17`
boots on the experimental 386 AT profile with a 4 MiB physical-memory limit.
The pinned builder changes only `PHYSTOP` from 224 MiB to 4 MiB, compiles for
`-march=i386`, and produces both the boot disk and xv6 filesystem disk. A
larger-memory profile exists, but this receipt does not establish its boot.

The guest reaches `init: starting sh`, accepts input through COM1, executes an
external `echo` program, prints its result, and returns to the `$` prompt.
It also completes `echo BW_XV6_FS_OK > bwfile; cat bwfile; rm bwfile`, reads
the marker back from the filesystem, and returns to `$`.
The run observes user-mode execution, `exec`, system calls, the slave-disk IDE
interrupt on IOAPIC input 14, and COM1 receive interrupts on input 4. The
evidence is in [the stock xv6 boot receipt](receipts/2026-09-27-xv6-stock-shell.json).

To reproduce locally, check out the pinned xv6 source and provide a lawful AT
BIOS ROM. The ROM is external and is not part of this repository:

```sh
git clone https://github.com/mit-pdos/xv6-public.git /tmp/xv6-public
git -C /tmp/xv6-public checkout eeb7b415dbcb12cc362d0783e41c3d1f44066b17
node scripts/build-xv6-stock-4m.mjs
XV6_ROM=/path/to/ATBIOS.rom XV6_STEPS=80000000 \
  XV6_COMMAND=$'echo BW_XV6_OK\r' \
  XV6_EXPECT_SERIAL=$'\nBW_XV6_OK\n$ ' node scripts/probe-xv6-stock.mjs
```

The probe reports source-media hashes, serial output, input bytes, IRQs,
user-mode entries, and kernel symbol milestones. Boot and one shell command
plus this filesystem write/read/delete sequence are accepted here; this does
not claim complete 386DX, x87, multi-CPU, timing,
or broad xv6 regression compatibility. The image uses one xv6 CPU despite the
stock SMP-capable kernel and APIC setup.
