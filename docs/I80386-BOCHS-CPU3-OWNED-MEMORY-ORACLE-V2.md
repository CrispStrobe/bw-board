# Owned Bochs CPU3 paging and memory-byte oracle v2

This is a separate, bounded native capture for a freely authored 80386 fixture. It does not change the [v1 VM-task oracle](I80386-BOCHS-CPU3-OWNED-ORACLE.md), the JavaScript CPU executor, or any licensed guest. The fixture enables ordinary 4 KiB paging, identity-maps the first MiB, writes and reads `0x11223344` at linear/physical `0x5000`, then emits `BHPG004` and stops at a CPU checkpoint. Its low RAM page directory (`0x9000`) and page table (`0xa000`) cause actual PDE/PTE read and A/D-write hooks. CPU level 3 excludes CR4 and PSE.

The [retained native receipt](receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-v2.json) freezes board source `19c4864922b1ff083068495312387ebc4e39d4a2`. Root independently reproduced the complete report byte for byte: 807 instruction hooks, 1,291 linear-access hooks, seven physical page-table hooks and seven port writes. The report SHA-256 is `0865be3b65043672d436b6716fc060795b0853cbac93d2f858f0bcf93f4e73f7`. Its `comparison: "not-run"` remains explicit; this native capture does not qualify cross-engine equality.

The preparer accepts only clean Bochs revision `0e45b736ef9792eb9b752b0a35db49eaf2faea47`. It checks upstream `bochs/cpu/cpu.h` SHA-256 `9b686170fbf233886af05be619192192a6864a0cd003402067de027708f496cf` and `bochs/instrument/stubs/instrument.h` SHA-256 `81cfbc14167dd8ac6465d9f2aacde8fc5cf353778d0911ade9a410993306cdf0`. The [exact-byte bridge](../scripts/bochs-cpu3-owned-oracle-v2/patch.mjs) changes only those headers, forwarding their existing `dataptr` and physical `why` arguments to a separate [v2 stub body](../scripts/bochs-cpu3-owned-oracle-v2/instrument.cc). Patched header hashes are `58eb5d8fb1341767d1ce5450be9ae5a159c0459a2782e21021eeeec38fcc94c2` and `0d59c42543f9bb9b6ba1484e64c01b1d11893f49d8762d1772add33323b29a07`, respectively. The runner checks exact patched bytes, source inventory, build configuration, executable hash, free ROM hashes, and fixture image hashes.

```sh
BOCHS_386_ROOT=/path/to/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-owned-oracle-v2.mjs --check
BOCHS_386_ROOT=/path/to/clean/pinned/Bochs node scripts/prepare-bochs-cpu3-owned-oracle-v2.mjs --prepare /tmp/bw-bochs-cpu3-owned-v2
cd /tmp/bw-bochs-cpu3-owned-v2/bochs
./configure --enable-cpu-level=3 --with-nogui --disable-plugins --disable-debugger --disable-repeat-speedups --disable-handlers-chaining --enable-instrumentation=instrument/stubs
make -j1
cd /path/to/board
BOCHS_386_INSTRUMENTED_ROOT=/tmp/bw-bochs-cpu3-owned-v2 node scripts/run-bochs-cpu3-owned-oracle-v2.mjs > owned-memory-capture.json
```

Hook byte strings come directly from the borrowed Bochs callback `dataptr`; the probe performs no extra guest read to derive a bus value. The runner and probe reject hosts other than little-endian because the pinned call sites pass both host scalar storage and guest-layout byte buffers. The linear hooks report reads after the read and writes before the write. For the audited legacy paging call sites, physical PDE/PTE reads occur after the read and A/D writes after the write; `why` retains the PDE/PTE reason. `BX_RW` is labelled read-for-RMW, not a final write. Any other physical write reason is labelled unknown phase. The parser requires the direct PDE `03a00000` → `23a00000`, PTE5 `03500000` → `63500000`, and data `44332211` write/read values in order.

The checkpoint also snapshots three fixed, plain-owned low RAM words: PDE0, PTE5, and data5. Those are **RAM snapshots**, separate from hook events. This paging fixture has no TSS task switch, so it makes no TSS-byte claim; the v1 VM-task checkpoint remains distinct. Bochs CPU instrumentation does not enumerate every physical bus cycle, instruction fetch, MMIO, DMA, timing, or another engine's behavior. The capture establishes only the stated callback-byte and checkpoint evidence, not complete physical-cycle equivalence or a speed result.
