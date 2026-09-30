# Owned native CPU3 slice self-parity

**Status (2026-09-30): bounded native functional gate passed.** The exact
[capture](receipts/2026-09-30-i80386-bochs-cpu3-native-slice-capture.json) and
[compact result](receipts/2026-09-30-i80386-bochs-cpu3-native-slice-result.json)
come from committed board source `8b9fc8fb064b7397a8dcda083ca3175ef68d428b`
and pinned Bochs source `0e45b736ef9792eb9b752b0a35db49eaf2faea47`.
This follows the [execution/yield seam audit](I80386-NATIVE-CPU-ABI-YIELD-AUDIT.md)
using the unchanged [free page-fault fixture](../test/fixtures/i80386-bochs-cpu3-pagefault-retry.S).
It is a native Bochs CPU3 continuous-versus-sliced comparison, not a
WebAssembly or JavaScript board result.

The host takes control at `CS:EIP=0000:00007e00` after the free BIOS loads
the image. All four fresh processes record the same 20 selected visible
integer/control/table/segment seed fields and the same complete 1 MiB copied
host RAM image before activation. The adapter invalidates TLB, prefetch, and
instruction cache, then routes the tested interval's physical reads/writes,
execute-page access, port I/O, and native ticks through host callbacks. A
direct Bochs RAM, pointer, PIO, or timer fallback aborts. The source-bound
[runner](../scripts/run-bochs-cpu3-native-slice-compare.mjs) checks exact
committed source bytes, the patched upstream tree and copied runtime files,
binary, config, old fixture receipt, assembled image, floppy, free ROMs,
host configuration, and input stability after the serial run.

| Arm | Resume calls | Native ticks | Attempted fetches | Completed instructions | Partial REP cuts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Continuous | 8 | 1,881 | 858 | 857 | 0 |
| Budget 1 | 1,881 | 1,881 | 1,881 | 857 | 1,023 |
| Budget 2 | 942 | 1,881 | 1,370 | 857 | 512 |
| Budget 257 | 15 | 1,881 | 861 | 857 | 3 |

Every bounded call charged at most its requested native ticks. The four arms
agree on the final selected CPU fields, fault frame, four selected RAM words,
all 1,302 ordered host physical writes including bytes, tick and ordinal,
seven committed `0xe9` marker bytes, and the fault/port boundaries. Each arm
has 1,024 `REP STOSL` iterations, exactly one supervisor not-present-write
`#PF` with error code 2 and CR2 `0x5000`, a fault-delivered cut at handler
entry before its first instruction, guest page-table repair and `IRETD` retry,
and 1,881 native tick callbacks. The selected final RAM words are PDE0
`23a00000`, PTE5 `63500000`, data5 `44332211`, and the CR2 scratch word
`00500000` (little-endian bytes). Different attempt and partial-REP counts
are expected because a sliced REP re-enters at its restored EIP; they are not
whole-instruction retirement counts.

In the retained budget-one arm, the faulting store at EIP `0x7ebe` advances
the native tick from 1,839 to 1,840 and yields at handler entry. The handler
repairs PTE5 to `0x00005003` at tick 1,860, reloads CR3 at EIP `0x7f46`
across ticks 1,862–1,863, and executes `IRETD` at EIP `0x7f4c` across
1,864–1,865. The same store at EIP `0x7ebe` retries across 1,865–1,866;
its `44332211` data write occurs at tick 1,865. There is no failed data5
write at the fault tick. PTE5 was also initialized to `0x00005003` during
ordinary setup at tick 1,062, so that earlier write is not handler repair.

Four invalid C ABI calls were rejected in each normal process: resume before
activation, zero budget, null callback table, and missing required callback.
Seven separate negative processes terminated with `SIGABRT` at their exact
active guard: out-of-range physical read, unexpected port, Bochs RAM read,
Bochs RAM write, direct Bochs pointer, Bochs PIO, and Bochs timer. All five
normal-run fallback counts were zero. The owned fixture reaches the `BHPG004`
marker and the harness exits cleanly after explicit deactivation; it does not
exercise a production machine shutdown lifecycle or HLT.

The binary SHA-256 was
`4a6bc61edb6ccc93060fde4777a5e9c41ad10e3e8c70ae6d3d9e031c9470f59f`;
the Bochs `config.h` SHA-256 was
`d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
The assembled image SHA-256 was
`17b6df61ebf2a28144a411ed1ec1bbffc2cc2140561ea76cf9c571d2c87f5256`.
The four-arm activation RAM digest was
`85cf87aa78ffec6bb981124a442820c6533c447616df341f0739516bd6cc9151`;
the selected-state seed digest was
`61cb9e1fce52fda00241b80d70e6cf88f69c83559bc6521f7e4f39bae43904d7`.
The path-independent semantic evidence digest of the JSON object
`{activation,armSeeds,apiProbes,arms,probes}` was
`ed9d5e471bd15df4084eaf5bd626c5e4cde3f73bcbd523f8b6de2fd53712d286`.
An independent capture reproduced that digest and the compact result byte
for byte. The committed capture SHA-256 is
`34f87620eb4f12aba403f11ee83ef6cbc360e511e91b2c3fc06c9c1db8d7d7c2`;
the compact result SHA-256 is
`d6c3ea19e1ff25d3de18784c908b3ed22c767275ae4c4f95321f634623e69a96`.
Complete capture bytes can differ across output directories because the
Bochs configuration embeds their absolute floppy/log paths.

From a clean checkout of the **source freeze**, prepare a new tree from a
clean local checkout of the pinned Bochs revision, build serially, then run:

```sh
BOCHS_386_ROOT=/path/to/clean/pinned-bochs \
  node scripts/prepare-bochs-cpu3-native-slice.mjs --prepare /path/to/new-native-tree
cd /path/to/new-native-tree/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins \
  --disable-debugger --disable-repeat-speedups \
  --disable-handlers-chaining --enable-instrumentation=instrument/stubs
nice make -j1
cd /path/to/board-source-freeze
node scripts/run-bochs-cpu3-native-slice-compare.mjs \
  --preflight /path/to/new-native-tree
node scripts/run-bochs-cpu3-native-slice-compare.mjs \
  --capture /path/to/new-native-tree /path/to/new-output-directory
```

The runner fixes the Bochs clock to `time0=946684800`, starts each arm and
negative probe in a fresh process, and retains their stdout, stderr, and host
logs outside the checkout. Its [validator](../scripts/bochs-cpu3-native-slice-compare.mjs)
and [mutation tests](../test/i80386-native-slice.test.mjs) reject malformed
source, seed, budget, fault cut/frame, port, write-order, callback, and guard
evidence. The fixed source commit is needed to reproduce the report's exact
board revision; this later documentation commit is not that source freeze.

This gate proves only selected native self-parity for one owned strict-386
fixture. The seed records omit hidden segment state, FPU/debug state, and
cold reset; host RAM is one plain 1 MiB domain, not MMIO. No external IRQ or
device event was injected, and A20, DMA, chip debt, HLT, full fetch/bus order,
and JavaScript AT fault-charge or machine-cycle parity remain unqualified.
It neither builds WebAssembly nor measures speed. Strict CPU3 still cannot
boot the unmodified stock xv6 CR4/PSE bootstrap.
