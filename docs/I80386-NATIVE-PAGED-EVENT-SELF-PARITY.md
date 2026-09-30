# Native strict-386 paging and host-event self-parity

**Status (2026-09-30): source-bound four-arm native self-parity passed and independently reproduced.** Executable, validator, runner, and tests are frozen at `6f9c400c9c313c03fd526fb22589294f6302e9d7`.

This gate combines 4 KiB paging and a recoverable supervisor page fault with a host interrupt held pending under CLI. The guest repairs PTE5, reloads CR3, drops the error dword, returns with IRETD, and retries the failed write. Interrupt acknowledgement must wait until the STI successor completes. A second interrupt wakes HLT; a final interrupt remains masked under terminal CLI/HLT.

The new adapter has distinct paged-event ABI names and BWS5 records. It reuses the exact pinned Bochs transforms from the earlier host-event adapter and preserves both prior adapters and their evidence. FAULT_BEGIN precedes fault-frame writes. FAULT_DELIVERED follows the attempted-fault tick, references the BEGIN ordinal, and precedes handler execution and the returned fault slice. This records the frame before later interrupts overwrite its stack slots.

The free BPEV001 fixture is 2560 bytes, SHA256 1b4ea51b9e272f4c55930dac86aa3b813235c455ccef597fa9b51caaf5715aaa. The runtime owns plain 1 MiB RAM after BIOS activation. The fixture deliberately uses a separate 1024-iteration REP window and ordinary loops for page-table initialization.

Qualification compares continuous and budgets 1, 2, and 257 with identical selected seeds, identical ordered recorded host journals, final selected CPU state and RAM, and zero fallback counters. Nine C ABI argument/reentry probes and seven exact SIGABRT fallback probes passed. Mutation tests reject lost pending IRQ, early handler/ACK, altered fault frame/tick/ordinal, missing repair/retry, and stale or malformed proof identity.

This gate does not establish mapped ROM/MMIO/A20 behavior, real AT device arbitration, complete hidden/reset state, JavaScript board equivalence, WASM integration, Windows enhanced-mode compatibility, or a speed gain. The next concrete gate is typed host memory decoding and A20 transitions, followed by device scheduling and integration measurements.

Observed source-bound arms:

| Arm | Resume calls | Attempts | Completed | REP iterations | Partial REP returns |
| --- | ---: | ---: | ---: | ---: | ---: |
| Continuous | 16 | 2982 | 2980 | 1024 | 1 |
| Budget 1 | 4011 | 4004 | 2980 | 1024 | 1023 |
| Budget 2 | 2008 | 3493 | 2980 | 1024 | 512 |
| Budget 257 | 30 | 2985 | 2980 | 1024 | 4 |

All arms share 4004 ticks and 6388 ordered journal records: 4004 ticks, 2349 writes, 8 selected attempts, 2 PTE5 reads, 2 fault records, 6 IRQ-line actions, 2 acknowledgements, 2 deliveries, 5 idle observations, 7 port writes, and one consumed deadline. All have 82 physical-read callbacks and 12 executable-page callbacks. Attempts and partial REP counts differ because resumptions reenter the partially completed instruction.

The page fault begins at tick3893 and delivers at tick3894. Its four-dword frame is error2/EIP7ee8/CS8/EFLAGS10046. Guest repair writes PTE5=5003, then CR3 reload and IRETD precede the retry; the resulting page-walk A/D update is5063. The successful store is44332211 in byte order. First IRQ ACK is tick3927, saved EIP7f1c, after successor7f17. Second wake ACK/delivery at tick3958 saves EIP7f2b with zero intervening native ticks. Terminal masked idle ends at4004 without a third acknowledgement.

The journal records writes, ticks, selected instruction attempts, targeted PTE5 reads, faults, ports, IRQ actions/delivery, and idle cuts. General physical reads and executable-page callbacks are counted, rather than fully byte-journaled. This is not complete physical-bus equivalence.

Source and artifact pins:

- Pinned Bochs source: `0e45b736ef9792eb9b752b0a35db49eaf2faea47`.
- Combined runtime, runner, validator and test proof source: `6f9c400c9c313c03fd526fb22589294f6302e9d7`.
- Native binary SHA256: `7d5b0e46e4f8def57b158a9fd199624af8ada72a3ba9d97e7fcb3af70bf835f8`.
- Config SHA256: `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
- Qualified capture SHA256: `b19f3662deb9a4177ad67f6e69b39b7adfedaed5951ddd81c64267d2e537f91b`.
- Compact result SHA256: `c23cf4262469c5f69d16afb27a5cad82f4c0e7e06d4d3c93d6d86e20f581cae8`.

The [capture](receipts/2026-09-30-i80386-bochs-cpu3-native-paged-events-capture.json) retains ordered records, source/media/build pins, and raw-artifact hashes. The [compact result](receipts/2026-09-30-i80386-bochs-cpu3-native-paged-events-result.json) describes the proven scope. Raw files remain outside the source repository. The complete capture includes path-dependent host configuration hashes; independent captures need not have identical complete JSON bytes.

Reproduce from a clean checkout of the frozen combined source. Preserve earlier prepared trees and choose new output directories:

```sh
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-paged-events.mjs --check
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-paged-events.mjs --prepare /new/native-paged-events
cd /new/native-paged-events/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
nice make -j1
cd /checkout/of/frozen/source
node scripts/run-bochs-cpu3-native-paged-events-compare.mjs --preflight /new/native-paged-events
node scripts/run-bochs-cpu3-native-paged-events-compare.mjs --capture /new/native-paged-events /new/proof-directory
node --test test/i80386-native-paged-events.test.mjs
```

The locked-dependency broad 386 suite passed 753 tests with zero failures and five optional-data skips. The focused combined-gate suite passed all 15 tests without skips. The exploratory continuous arm and the earlier 99f1 four-arm capture are committed solely as labeled free mutation inputs; neither replaces this final source-bound receipt.

Root independently repeated all four arms and seven guards from the frozen source. The independent capture SHA256 is `295543a9a6f6d3bd7aa06fe6231d11c0bc7afe906f85f324e7df3895d45bce39`. Its compact result is byte-identical to the published result. Selected seeds, API/guard outcomes, all four arms, and the recorded journals are identical; their path-independent semantic SHA256 is `51a96d7dcd51659335dfd32fe8ab0b68b50fb35d78cbb8848bdd491f9e831b39`. Root verified all 35 retained artifact hashes and reparsed all four raw arms. A separate Python audit checked raw ordinal continuity, fault-frame/tick ordering, pending-line chronology, and exact cross-arm journal equality.
