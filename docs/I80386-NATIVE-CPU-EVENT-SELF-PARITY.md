# Native CPU3 host event self-parity

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

**Status (2026-09-30): bounded native host-event gate passed and independently reproduced.** The exact [capture](receipts/2026-09-30-i80386-bochs-cpu3-native-events-capture.json) and [compact result](receipts/2026-09-30-i80386-bochs-cpu3-native-events-result.json) were produced from committed board source `d144cb5bdd25a08da9b97133b71bb12e11a8e3fb` and pinned Bochs source `0e45b736ef9792eb9b752b0a35db49eaf2faea47`. A separate experimental adapter extends the [native slice gate](I80386-NATIVE-CPU-SLICE-SELF-PARITY.md) with an absolute event deadline, host maskable-IRQ line/acknowledgement, and HLT idle/wakeup. The prior adapter, native build, and receipts remain unchanged. This is a native functional experiment, not an installed CLI, GUI, or WebAssembly backend or a speed measurement.

The [new C ABI](../scripts/bochs-cpu3-native-events/abi.h) exports distinct `bw_cpu3_events_resume` and `bw_cpu3_events_set_irq_line` names. Resume caps execution at the smaller of its instruction budget and the next absolute native-tick deadline. A deadline during REP cuts before another iteration performs memory writes. A due-now deadline returns without CPU work; the caller must consume or advance it before reentry. Stale deadlines, invalid callback arguments, and callback reentry are rejected. IRQ line changes are accepted only between slices. Native instruction ticks remain separate from host device time; a future board adapter must advance device time while HLT is idle.

The host takes ownership at `0000:00007e00` after the free BIOS loads the [freely authored fixture](../test/fixtures/i80386-bochs-cpu3-native-events.S). Each fresh process records the same 20 selected visible integer/control/table/segment fields, complete copied 1 MiB RAM seed, and bootstrap IRQ handoff. The adapter records and clears any inherited bootstrap PIC line, then invalidates TLB, prefetch, and instruction cache. This is a post-BIOS handoff, not a cold reset or complete hidden-state import. Physical reads/writes, execute-page access, PIO, ticks, and IRQ acknowledgement use host callbacks. Bochs retains its original IF and STI/MOV SS inhibition checks, interrupt-gate validation, frame creation, and IRETD behavior. A successful external IRQ returns at handler entry before its first instruction, without adding a synthetic instruction tick. The HLT adapter checks original wake eligibility before returning idle, rather than bypassing interrupt delivery.

| Arm | Resume calls | Native ticks | Completed instructions | Instruction attempts | Partial REP cuts |
| --- | ---: | ---: | ---: | ---: | ---: |
| Continuous | 15 | 1,126 | 103 | 104 | 1 |
| Budget 1 | 1,133 | 1,126 | 103 | 1,126 | 1,023 |
| Budget 2 | 569 | 1,126 | 103 | 615 | 512 |
| Budget 257 | 18 | 1,126 | 103 | 107 | 4 |

All four arms match the final selected CPU/RAM checkpoints and all **2,195 ordered tick/event records**: 1,126 tick callbacks, 1,046 physical writes including bytes, seven PIO marker bytes, six IRQ-line actions, two acknowledgements, two deliveries, five idle observations, and one deadline-consumption action. Each arm also records 33 physical reads and four execute-page callbacks. Each call stays within its effective budget. Attempt and partial-REP counts differ because sliced REP re-enters at the restored EIP; even continuous execution has one partial REP cut at the host deadline. The fixture completes 1,024 REP STOSL iterations and emits `BHEV001` with zero faults.

At native tick **256**, the event deadline stops the REP at EIP `0x7e2d` after 239 iterations with the host line still low. The caller consumes the deadline and asserts the first IRQ under CLI. After STI, the successor at `0x7e7c` commits its shadow marker; acknowledgement occurs at tick **1,061**, saved EIP `0x7e81`. The original protected-mode 32-bit gate pushes EFLAGS, CS, and EIP at `0x6ffc`, `0x6ff8`, and `0x6ff4`, then returns at handler `0008:00007ebd`. The raw frame is retained; its defined EFLAGS mask is `0x246`, and saved CS is `0x0008`. There is no tick between acknowledgement and completed delivery. A long IRQ-delivered slice can charge preceding guest instructions; the delivery itself adds none.

The first IF-enabled HLT reaches EIP `0x7e90` at tick **1,086**. After two no-line idle observations, including an explicit zero-tick reentry, the host asserts the second IRQ. Original wake eligibility accepts it and returns at handler entry at the same tick, with saved EIP `0x7e90`. The guest returns with IRETD and emits its marker. It then clears IF and halts at EIP `0x7eb5`, tick **1,126**. Two no-line idle observations and a third observation with the maskable line asserted all leave this terminal CPU halted, with no extra tick or third acknowledgement. The host clears the line and exits the bounded proof harness. The five idle observations are fixed across budgets.

Nine API probes cover line/resume before activation, zero budget, null/incomplete callbacks, invalid line state, due-now return, stale deadline, and callback reentry. Seven separate negative processes terminate with exact `SIGABRT` guards for out-of-range physical read, unexpected PIO, direct Bochs RAM read/write, direct pointer, Bochs PIO, and Bochs timer access. All normal fallback counters are zero. HLT's Bochs GUI idle hook is disabled by `BX_USE_IDLE_HACK=0`. The [validator](../scripts/bochs-cpu3-native-events-compare.mjs), [runner/parser](../scripts/run-bochs-cpu3-native-events-compare.mjs), and [mutation tests](../test/i80386-native-events.test.mjs) reject corrupted budgets, deadlines, IRQ frames/write order, tick scheduling, masked wakeup, seed/source identities, missing guards/arms, and cross-arm differences. Eleven new tests and eleven earlier slice tests passed without skips. The compressed earlier free capture is explicitly regression input; its test helper adapts metadata for the current inventory without modifying the historical capture.

The binary SHA-256 is `0c3a542a066aad9120fe1c2ed73320b4c8ece55ba504d798fe606f6e41d5c167`; config SHA-256 is `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`. The assembled fixture SHA-256 is `afc595c407f4c7cfd1651cc2b28b51e83ffcd7d9aa4383deb553ae6f3fa42c2c`. The complete RAM seed digest is `e5f3fd55b010c3ece5ec305b0c7dc18e5d27da8f8d3eefba677c9cf677bfe3c2`; selected CPU seed digest is `61cb9e1fce52fda00241b80d70e6cf88f69c83559bc6521f7e4f39bae43904d7`.

The published capture SHA-256 is `57a47d37f40df6f4d2626c02195992851bde85192a8afd46018fd549567d5d59`; compact result SHA-256 is `dd0e605576c3b2e69e34083bb0d3bc52d309e4b75b4f1c041335889de28f7033`. The path-independent semantic digest of `JSON.stringify({activation,armSeeds,apiProbes,arms,probes})` is `3a0dddf1621dd84dad49f4f3f59c4486f518dda74d927df744c3726541fb5bd1`. Root's independent capture reproduced that semantic digest and the compact result byte for byte, verified all 35 retained artifact hashes, and reparsed all four raw arm logs. Its whole capture SHA-256 is `8067c494e2a0cebfe2cf0b5084c45adfe8d830308cea53e199b04f037c1abe80`; whole captures differ because the Bochs configuration and log hashes embed output-directory paths.

From a clean checkout of the **source freeze**, prepare a new tree from a clean local checkout of the pinned Bochs revision, then build serially and capture:

```sh
BOCHS_386_ROOT=/path/to/clean/pinned-bochs \
  node scripts/prepare-bochs-cpu3-native-events.mjs --prepare /path/to/new-native-tree
cd /path/to/new-native-tree/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins \
  --disable-debugger --disable-repeat-speedups \
  --disable-handlers-chaining --enable-instrumentation=instrument/stubs
nice make -j1
cd /path/to/board-source-freeze
node scripts/run-bochs-cpu3-native-events-compare.mjs \
  --preflight /path/to/new-native-tree
node scripts/run-bochs-cpu3-native-events-compare.mjs \
  --capture /path/to/new-native-tree /path/to/new-output-directory
```

The runner fixes `clock: sync=none, time0=946684800`, validates committed source, all patched/copied files, binary/config, assembled symbols and image, free ROMs and host configuration, then rechecks inputs after the serial run. Raw logs/media stay outside the checkout; only free-owned evidence is published. The later documentation/receipt commit is not the source freeze.

This gate uses one plain 1 MiB RAM domain and no paging or MMIO. The earlier page-fault fixture remains a separate qualified gate; paging plus device interrupts still needs a combined guest test. A20, DMA, device IRQ arbitration, complete hidden CPU/FPU/debug state, production reset/shutdown, JavaScript AT cycle/fault-charge parity, full guest workloads, and WebAssembly integration remain unfinished. Strict CPU3 cannot execute the unmodified stock xv6 CR4/PSE bootstrap. Next work is to qualify combined paging/IRQ behavior and a host memory/device boundary before attaching this core to the board and measuring guest performance. This result does not establish broader guest enhanced-mode compatibility, RTx, or a 10× speed improvement.

The [next-gate implementation audit](I80386-NATIVE-NEXT-GATES.md) records the concrete combined paging/IRQ and decoded memory/A20 fixtures, ownership split, and board-time constraints. These are planned gates, not additional execution results.
