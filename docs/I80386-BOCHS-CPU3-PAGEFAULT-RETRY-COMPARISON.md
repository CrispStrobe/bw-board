# Owned CPU3 page-fault retry comparison

The [source-bound JavaScript comparison](../scripts/compare-bochs-cpu3-owned-pagefault-retry.mjs)
matches the selected state and fault evidence in the separately captured
[native CPU3 receipt](receipts/2026-09-30-i80386-bochs-cpu3-owned-pagefault-retry.json).
The [comparison receipt](receipts/2026-09-30-i80386-bochs-cpu3-pagefault-retry-compare.json)
records `scoped-fault-match` and `scoped-fields-match`, with no selected
mismatches. It freezes comparator source
`b7ce0258a5503f36ae95981318efa99d4537b7f2`; the native fixture and
capture remain frozen at their original source revision
`6c41b146df71cf16438fb359b3bb72ed1674aaa0`. The comparison JSON's
SHA-256 is
`9152eede9457304d876b25f032e8fadeac62230d90e7cd2c45a37fc946a6b676`.
An independent run reproduced the JSON byte for byte.

For the exact recorded JSON hash, run from a clean checkout at comparator
source commit `b7ce0258a5503f36ae95981318efa99d4537b7f2`, which already
contains the committed native receipt:

```sh
node scripts/compare-bochs-cpu3-owned-pagefault-retry.mjs \
  > pagefault-retry-compare.json
sha256sum pagefault-retry-compare.json
```

The command checks exact committed bytes for its own source, the strict JavaScript
CPU, the imported state comparator, the native fault contract and receipt, and
all paths and hashes pinned by the native receipt. It assembles the same freely
authored fixture, checks its image SHA-256 and symbol addresses, then runs only
the JavaScript CPU. It does not rebuild or rerun Bochs. The JavaScript CPU uses
the explicit `strict386` profile, an `80387` reset for the defined CR0.ET
contract, and direct entry at the fixture's `setup` symbol. Architectural
fault delivery is enabled; the guest handler repairs its own page table,
reloads CR3, and returns through `IRETD`. The host neither patches the page
table nor injects a resume point.

The JavaScript run reached marker `BHPG004` after 1,881 steps. The first
faulting store and actual `_deliverFault` call occurred at step 1,840; a
read-only per-instance wrapper recorded vector 14, error code 2 and return
EIP `0x7ebe`, then called the original delivery method once. The handler
started at step 1,841, reloaded CR3 at step 1,863, executed `IRETD` at step
1,865 and retried the same store at step 1,866. The saved frame contained
error code 2, EIP `0x7ebe`, CS selector `0x0008` and EFLAGS `0x00010046`
with RF set. CR2 was `0x5000`; the handler's scratch word retained that
address. The failed store wrote no data bytes. These facts match the native
exception, frame, handler and retry proof, including the defined 80386 saved
EFLAGS bits under mask `0x00037fd7`. The full raw frame is retained in the
receipt; only the architectural low 16 bits of the saved CS dword are compared.

The final selected state comparison covers all eight GPRs, EIP, defined 80386
EFLAGS (`0x00037fd7`) and CR0 (`0x8000001f`) bits, CR2/CR3, GDTR/IDTR,
loaded segment selectors and architectural cache fields, and three physical
plain-RAM words: PDE0 at `0x9000` is `23a00000`, PTE5 at `0xa014` is
`63500000`, and data at `0x5000` is `44332211`. Null TR/LDTR selectors are
checked; their unloaded hidden caches are outside the comparison. Raw CR0
and debug-register seeds remain visible in the receipt without equating
reserved or undefined readback values.

The native exception, instruction, memory and port records are instrumentation
callbacks, not a physical-byte bus trace. Their ordinals are native-only;
they are not compared with JavaScript bus order. The three RAM words do not
qualify all memory. FPU/device state, instruction counts, timing, complete
physical bus cycles and full CPU behavior remain outside this bounded
comparison. It supplies no native backend or speed result.
