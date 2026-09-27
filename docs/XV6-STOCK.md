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

The reusable native dispatcher used by the CLI and GUI also runs the complete
4 MiB `forktest`. With the same vendored Bochs BIOS and xv6 disks, its result
matches the earlier probe-specific native path at all recorded guest fields,
including 24,338,279 steps, serial output, input delivery, interrupts, CPU
state, and final 4 MiB RAM SHA-256. Both admit exactly 11,298,966 native
instructions, including 2,145,309 REP STOSD iterations. The
[dispatcher comparison](receipts/2026-09-27-i80386-shared-native-dispatch.json)
records source and media hashes. `XV6_NATIVE_DISPATCH=1` with `XV6_LEAN=1`
selects this path; it remains opt-in.

Native coverage now includes the register-only `TEST AL,imm8` form. A complete
`forktest` rerun matched the prior native run in steps, serial output, input
delivery, interrupts, milestones, CPU state, and final RAM hash. Native
instruction count rose from 11,298,966 to 11,406,107, about 46.9% of the
24,338,279-step run. The [A8 coverage receipt](receipts/2026-09-27-i80386-native-test-al.json)
binds the rebuilt WASM and source hashes. This is coverage progress; a
repeatable end-to-end speed gain has not been established for the new form.

The native block runner now exits a decoded block cleanly when its terminal
`JZ` or `JNZ` targets code outside that block. A full `forktest` A/B against
ordinary execution matched every reported guest field and final RAM hash.
Native coverage rose to 15,451,458 of 24,338,279 steps (63.5%). The single
paired run used 18.68 user CPU seconds natively and 27.00 with ordinary
execution, about 1.45×. A second direct A/B against the prior native runner
used 20.52 versus 18.68 user CPU seconds, a 1.10× improvement from this
branch change on the same workload. Host timings are not a 10× or real-time claim.
The [branch-exit receipt](receipts/2026-09-27-i80386-native-branch-exit.json)
binds the rebuilt WASM and the full comparison.

The next bounded form, `OR reg,[validated RAM]`, admits a frequent xv6 pair
that had been interpreted together. Native retirement rose to 16,427,165
instructions (67.5%) with exact guest-state and RAM equality. A direct
old/new native pair used 17.84 versus 17.20 user CPU seconds, about a 3.6%
reduction. The [OR-window receipt](receipts/2026-09-27-i80386-native-or-window.json)
records the source, WASM, coverage, and timings.

The native runner also admits primed `REP MOVSD` iterations when both source
and destination lie in validated RAM pages. It exits before either page
crosses, allowing the functional CPU to handle the boundary. A complete xv6
`forktest` rerun matched the previous guest report and final RAM hash; 864
additional MOVSD iterations retired natively on this workload. The
[MOVSD receipt](receipts/2026-09-27-i80386-native-rep-movsd.json) binds the
source and rebuilt WASM. The larger Windows-specific comparison is recorded
only in the private media repository.

The bounded runner also admits primed `REP STOSB` when ES points to a
prevalidated writable RAM page. It stops before crossing that page or a chip
event, preserving the interpreter's restart state. The stock `forktest` run
matched ordinary execution and the prior native guest report, including its
24,338,279 steps and final RAM hash. It retired 182 additional byte stores
natively. The [STOSB receipt](receipts/2026-09-27-i80386-native-rep-stosb.json)
records the source hashes and counters. This small coverage increase does not
establish an end-to-end speed gain.

A later CPU profile of the same `forktest` found instruction snapshots to be
the largest single self-time cost (21.9 seconds in an 85.6-second sampled run).
The executor now retains prior segment-cache and task-state objects by reference
when making each instruction snapshot; it replaces those objects on updates.
A fresh unprofiled A/B took 68.20 seconds before and 48.28 seconds after
(1.41×) for the same 24,338,279 guest instructions, serial transcript,
interrupts, milestones, and final CPU state. The [snapshot performance receipt](receipts/2026-09-27-i80386-snapshot-fast-path.json)
records the measurement; host load can change wall time.

A second complete `forktest` profile found `_writeLinear` at 4.8 seconds of
self time. Its write preflight now reuses one access-options object and fills
the physical-address array with a loop, while still translating every byte
before any data write. Two unprofiled A/B pairs in alternating order averaged
44.71 versus 39.46 process user CPU seconds (1.13×), with identical guest
results. Concurrent jobs made wall times noisy, so the [linear-write receipt](receipts/2026-09-27-i80386-linear-write-allocation.json)
reports both kinds of time and bases the speed comparison on CPU time.

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
