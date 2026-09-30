# Owned CPU3 recoverable page-fault capture

The [native receipt](receipts/2026-09-30-i80386-bochs-cpu3-owned-pagefault-retry.json)
freezes a freely authored 80386 fixture at board source
`6c41b146df71cf16438fb359b3bb72ed1674aaa0`. It uses the same pinned
Bochs CPU-level-3 executable, memory-byte probe, and callback parser as the
[paging v2 capture](I80386-BOCHS-CPU3-OWNED-MEMORY-ORACLE-V2.md), with a
separate [fixture](../test/fixtures/i80386-bochs-cpu3-pagefault-retry.S),
[runner](../scripts/run-bochs-cpu3-owned-oracle-v2-pagefault-retry.mjs), and
[fault contract](../scripts/bochs-cpu3-owned-oracle-v2-pagefault-retry/contract.mjs).
The runner pins those source bytes, the original v2 receipt, binary, probe,
configuration, ROMs, and image. The report retains `comparison: "not-run"`.

The fixture installs a 32-bit interrupt gate for vector 14, sets IDTR limit
`0x03ff`, then attempts a supervisor write to linear `0x5000` through a
not-present PTE. The receipt records exactly one `#PF` with error code `2`
and CR2 `0x5000`. Four ordered linear prewrite callbacks at `0x6ffc` through
`0x6ff0` carry the saved EFLAGS `0x00010046`, CS low 16 bits `0x0008`, the
faulting-store EIP `0x7ebe`, and error code `2`; their instruction attribution
matches the first store attempt. The guest handler checks the frame and CR2,
stores and reads CR2 in mapped scratch RAM, maps PTE5, reloads CR3, drops the
error word, and executes `IRETD`. A second hook at EIP `0x7ebe` precedes the
repaired PTE read and successful `0x11223344` store. The first attempt has no
linear data-store callback. The final plain-RAM snapshots contain PDE0
`23a00000`, PTE5 `63500000`, and data5 `44332211`.

From a clean checkout at the frozen source commit, with the existing pinned
instrumented Bochs build prepared as described in the v2 capture, reproduce
the receipt with:

```sh
BOCHS_386_INSTRUMENTED_ROOT=/path/to/pinned/bochs-cpu3-v2 \
  node scripts/run-bochs-cpu3-owned-oracle-v2-pagefault-retry.mjs \
  > pagefault-retry-native.json
sha256sum pagefault-retry-native.json
```

The exact JSON SHA-256 is
`6c663a02b1c9b5058b862442dc6ee093c969022e6ec04233698af8a077ee77d8`.
An independent run reproduced the entire JSON byte for byte; the focused
native test suite passed 12/12. The exception and `interrupt` records are
Bochs instrumentation callbacks for internal delivery, not evidence of a
physical IRQ. Linear write callbacks are prewrite observations. The three
fixed low-RAM words are checkpoint snapshots, separate from callback events.
The hooks do not establish complete physical bus order, instruction fetch,
MMIO, DMA, machine-cycle equivalence, or behavior of another CPU engine.
