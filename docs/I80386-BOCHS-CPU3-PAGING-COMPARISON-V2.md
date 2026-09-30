# Owned CPU3 paging comparison: one defined reset mismatch

The [source-bound comparison](../scripts/compare-bochs-cpu3-owned-paging-v2.mjs)
of the freely owned 4 KiB paging fixture reports **`scoped-field-mismatch`**.
At the boundary immediately after the final `BHPG004` port OUT, pinned Bochs
CPU3 has IDTR limit `0xffff`; the strict JavaScript 80386 has `0x03ff`.
This is the only selected mismatch in the
[recorded result](receipts/2026-09-30-i80386-bochs-cpu3-paging-compare-v2.json).
The result is not a full CPU, paging-bus, or performance qualification.

The JavaScript side uses `cpuProfile: "strict386"`, an explicit `80387`
hardware reset to align the defined CR0.ET input, and direct entry at the
owned post-disk-load `0000:7e00` setup label. The comparator requires exact
committed bytes for itself, the CPU, the native v2 receipt, and the executable source
hashes named by that receipt. The one named narrative document may change:
its historical hash remains checked, its current bytes must be committed,
and both hashes are reported as narrative provenance. It assembles the same fixture image, checks its
SHA-256 against the native image, and runs only the JavaScript CPU. It does
not rebuild or rerun Bochs. Run `node
scripts/compare-bochs-cpu3-owned-paging-v2.mjs` from a clean checkout; its
exit status is 1 while the defined IDTR difference remains.

At comparator source `9737a1cfe5da7f607d62d6f7fb36dc6287cd89e5`, the
owned marker appeared after 1,847 JavaScript steps. All eight GPRs, EIP,
defined 80386 EFLAGS (`0x00037fd7`) and CR0 (`0x8000001f`) bits, CR2, CR3,
GDTR, segment selector/base/limit/presence/size and code/data class, and
three fixed *physical plain-RAM words* matched. The RAM bytes are PDE0 at
`0x9000`: `23a00000`, PTE5 at `0xa014`: `63500000`, and data at `0x5000`:
`44332211`. The IDTR bases both equal zero; limits differ as stated.
Unloaded TR/LDTR selectors are checked as null, while their hidden cache
fields are excluded. Raw CR0, debug-register seeds, and native cache flags
remain visible in the receipt without being silently equated.

The [Intel 80386 Programmer's Reference Manual, §10.1](https://pdos.csail.mit.edu/6.828/2018/readings/i386/s10_01.htm)
specifies reset IDTR base zero and limit `0x03ff`. The pinned Bochs CPU3
source [`cpu/init.cc` lines 802–803](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/init.cc#L802-L803)
instead seeds a zero base and `0xffff` limit. The v2 fixture has no `LIDT`,
so the difference persists to the selected checkpoint. The JavaScript reset
value follows the manual; this comparison does not override it or remove the
field. A separately versioned fixture with an explicit `LIDT` could establish
an aligned initial guest contract without changing historical v2 evidence.

The native v2 [capture](I80386-BOCHS-CPU3-OWNED-MEMORY-ORACLE-V2.md)
records Bochs instrumentation callbacks. They are not a complete physical
byte-bus trace and are **not** compared to JavaScript bus event order. The
three RAM snapshots establish only those final words, not a full page hash.
The two engines' instruction counts, FPU/device state, and timing remain
outside this comparison.
