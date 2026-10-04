# Native 386 cold entry on the actual AT board

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

**Qualified 2026-10-01:** the isolated Bochs CPU3 bridge executes the free reset ROM while `ExperimentalI80386ATMachine` owns memory, ports and device clocks. Continuous execution and successful-work budgets 1/2/257 agree, including an independent fresh reproduction. Architectural reset parity remains **false** because the recorded reset profiles differ.

The bridge activates after hardware reset and before the first native CPU loop. Its first actual prefetch is raw physical `FFFFFFF0`, decoded by the board to `00FFFFF0`; the reset jump then executes at `000F0100`. No Bochs BIOS instructions, copied native RAM seed or JavaScript CPU instructions supply the result. The JavaScript CPU's `step()` is guarded against execution. The [MIT ROM source](../test/fixtures/i80386-free-cold-reset.S) needs no disk or licensed software.

## Measured checkpoint

| Arm | Resume calls | Raw native events | Terminal idle observations |
| --- | ---: | ---: | ---: |
| continuous | 9 | 969 | 2 |
| budget 1 | 50 | 1009 | 1 |
| budget 2 | 26 | 985 | 1 |
| budget 257 | 9 | 969 | 2 |

Every arm completes 49 instructions and records 49 successful quanta and 49 native ticks. Successful quanta advance six functional board clocks each; native ticks add no board clocks. One fresh board reset adds four clocks, giving **298 board clocks**. Port accesses catch up actual device debt; terminal settlement clears the remaining debt without executing an idle JavaScript CPU step.

All 958 ordered logical native events agree after removing command bookkeeping/ordinals and collapsing only adjacent identical, effect-free terminal idle observations. Full raw observations remain in the capture. Native decoded instruction lengths and immutable cached bytes match the JavaScript oracle's 143 architectural fetch bytes. This is decoded-instruction/cache evidence, not a native byte-fetch bus journal.

The guest performs five data-read bytes, fifteen attempted data-write bytes, and seven byte-wide `E9` writes producing `CRST001`. The board commits RAM writes and ignores the ROM/open-bus writes. Two verified 4096-byte ROM page fills are separate from these architectural byte counts. The native core uses four execute-page callbacks, four physical-read callbacks and eight physical-write callbacks; each arm completes 119 synchronous RPC requests. All five native RAM/direct-pointer/PIO/timer fallback counters are zero.

Every post-instruction board snapshot and final settlement matches the [actual JavaScript oracle](I80386-JS-COLD-RESET-ORACLE.md), including recorded PIT fraction, PIC, A20, RTC, DMA and system-control state. Full native register, segment-cache, system-cache and debug-register rows are retained. Eleven API contract probes, twelve native abort guards and sixteen malformed-transport abort probes passed. Both captures' 161 external raw artifact files were independently checked against their digests.

## Reset differences stay visible

The native CPU is not initialized from the JavaScript register snapshot. Native EDX starts at zero versus JavaScript `0300`; native CR0 is `7FFFFFF0` versus zero. GDTR/IDTR limits, DR6/DR7, cached CS attributes and LDTR/TR validity/presence/limits also differ. Undefined CR0 bits were identified before execution; defined ET and the other differences are not hidden by a comparison mask.

Before initializing working EDX/EAX, the guest stores native reset witness bytes `00 00 00 00 F0 FF FF 7F` at `0510..0517`. The JavaScript witness is `00 03 00 00 00 00 00 00`. The checker requires these named differences at the corresponding instructions and compares the remaining CPU state. Real-mode segment loads preserve Bochs' cached selector index, and cache validity flags change with accesses; the full raw rows remain part of native budget/reproduction parity. No architectural reset-parity claim follows from the later guest initialization.

## Immutable source and receipts

- Qualification source: `c49d573144691071d60336e49dcc1d9b1e5e221f`, with all 58 measured source inputs authenticated against their committed historical blobs.
- Bochs source: `0e45b736ef9792eb9b752b0a35db49eaf2faea47`; CPU3, SMP/debugger/REP shortcuts/chaining/idle hack disabled. The hardware-reset source is unchanged. All twelve pinned source blobs and eleven modified files are independently regenerated and checked.
- Binary SHA-256: `fd8decd0621f2c93755559940182bef6d41a1d4d5f1f8ed7b0d79a47875b11cc`.
- Config SHA-256: `d4945445c2412c0b4e8c5cac80cee28d443bb438c36c9ea6b1bb5196147f1e8c`.
- Runtime SHA-256: `a7b44a0829fefe5adf3065cd909dd754928ac3c18aaf9519909d6553a3d1c233`.
- [Formal capture](receipts/2026-10-01-i80386-native-cold-reset-capture.json.gz), decompressed SHA-256: `ffe756082dac7bd83e8fd3d18f94ff3ae927edb7066c4e6162b779ec598ccc59`.
- Compressed capture SHA-256: `3b3374df18d43e0be7d6a0af98ffe492208d0c6283e094f8af3c1553cfdb3892` (334,756 bytes; original JSON 17,123,591 bytes).
- Independent root capture SHA-256: `781c62b955cc3bcda1741d0660a9d894ef1d5e2719cdd17bd51c895b1b94e422`. The capture configuration differs only in its log directory. Complete native/board/RPC/rejection semantics match; the [audit](receipts/2026-10-01-i80386-native-cold-reset-audit.json) records semantic SHA-256 `d24790bb378618ad77db153d28bb50f92137503c9319eda8290f60bbc1c75238`.

The [compact result](receipts/2026-10-01-i80386-native-cold-reset-result.json) records the bounded acceptance. The capture embeds raw stdout/stderr/RPC bytes and authenticates their digests and parsed mirrors. Bochs logs and the original prepare manifest remain external retained files identified by hashes; the offline checker cannot authenticate absent external bytes. The independent actual-file audit checked them in both fresh runs.

The [initial actual capture fixture](../test/fixtures/i80386-native-cold-reset-capture.json.gz) retains source `dbc638038482c47c0b1924b43e24ea49adddc447` and decompressed SHA-256 `5577869f34e00ecac0742d930321b94f0c0e33e9db3bc3a353b416c65a416683`. It is the historical input for the baseline plus 39 mutation tests, not a replacement for final qualification. The first isolated build failed on a missing page-walk state declaration; that failed tree/log were retained, and the corrected r2 build was freshly prepared. Earlier v6 adapters, builds and receipts are unchanged.

## Running and maintaining the gate

```sh
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-cold-reset.mjs --check
BOCHS_386_ROOT=/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-native-cold-reset.mjs --prepare /new/cold-reset-tree
# Configure with the exact flags emitted by the preparer, then nice make -j1.
node scripts/run-bochs-cpu3-native-cold-reset-compare.mjs --build /prepared/cold-reset-tree --manifest /retained/prepare.json --out /new/capture-directory
node --test --test-concurrency=1 test/i80386-native-cold-reset-host.test.mjs test/i80386-native-cold-reset-report.test.mjs
```

The runner requires a clean committed source tree and the audited binary/config/runtime pins. A different compiler or build path needs a separately audited candidate and fresh captures. Changed measured code, fixture or tests require fresh qualification; historical receipts keep their original revisions and hashes. Documentation-only followups do not relabel the measured source. Mandatory fixture tests run in ordinary CI without a Bochs build; 79 focused local tests passed with zero skips.

## Next executable work

This first bridge admits only stable ROM execution, fixed A20 ON, generation zero, bounded physical spans and the fixture's byte-wide E9 port. RAM execution, MMIO/VGA, IRQ/fault/REP handling, mapping transitions and external mutation during RUN remain outside it. It is a proof adapter, not a shipped CLI/GUI/WASM CPU backend.

The separate [RAM/SMC/A20 checkpoint](I80386-NATIVE-RAM-COHERENCE-ACTUAL-BOARD.md) now qualifies executable RAM, self-modifying code, alias write stamps and committed mapping invalidation. Next run the existing REP/two-page-fault/PIT fixture through the actual board before broader BIOS boot and a production backend seam. Direct in-process/WASM callbacks and safe device-debt batching follow correctness qualification and matching-workload measurements.

The qualification host is a four-vCPU Intel Xeon Skylake/IBRS VPS, Node 20.20.2 and g++ 13.3.0. No speed or RTx measurement was made. broader guest enhanced mode, full AT boot and the 10× target remain unfinished; these ROM captures do not extend broader guest/broader game acceptance. Strict CPU3 has no CR4/PSE; stock xv6 remains on the separately labeled compatibility route, while strict 386 xv6 needs the 4 KiB/UP/PIC port.
