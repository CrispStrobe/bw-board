# Owned CPU3 paging comparison with explicit IDTR alignment

The separately versioned owned paging fixture executes `LIDT` with base 0
and limit `0x03ff` before enabling ordinary 4 KiB paging. Its
[source-bound JavaScript comparison](../scripts/compare-bochs-cpu3-owned-paging-idtr-03ff.mjs)
reports **`scoped-fields-match`** against the
[native CPU3 checkpoint](receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-idtr-03ff.json).
The [unaligned historical v2 comparison](I80386-BOCHS-CPU3-PAGING-COMPARISON-V2.md)
still reports its defined IDTR limit mismatch (`0xffff` versus `0x03ff`).
Neither result is a full CPU, physical-bus, or speed qualification.

The comparator requires exact committed bytes for its own source, the strict
JavaScript CPU, the imported paging field comparator, the aligned native
receipt, and every source hash named in that receipt. It assembles the same
owned fixture and checks the image SHA-256. The JavaScript side uses
`cpuProfile: "strict386"`, an explicit `80387` reset to align defined CR0.ET,
and direct entry at the fixture's post-disk-load `setup` symbol, derived from
the assembled object (`0000:7e00`). It stops immediately after the final
`BHPG004` port OUT. Run `node
scripts/compare-bochs-cpu3-owned-paging-idtr-03ff.mjs` from a clean
checkout. This command runs only the JavaScript CPU; it does not rebuild or
rerun Bochs.

At comparator source `435f1cdd12ea74e64a5e050d5b120ab5c8076ae6`, the
[recorded comparison](receipts/2026-09-30-i80386-bochs-cpu3-owned-paging-idtr-03ff-compare.json)
reached the marker after 1,848 JavaScript steps and has zero selected
mismatches. The selected fields are all eight GPRs, EIP, defined 80386
EFLAGS (`0x00037fd7`) and CR0 (`0x8000001f`) bits, CR2/CR3, GDTR/IDTR,
loaded segment selectors and architectural cache fields, and three fixed
physical plain-RAM words: PDE0 at `0x9000` is `23a00000`, PTE5 at
`0xa014` is `63500000`, and data at `0x5000` is `44332211`. Null TR/LDTR
selectors are checked; their unloaded hidden cache fields are outside the
comparison.

The receipt reports raw CR0 (`0xfffffff1` native versus `0x80000011`
JavaScript) and debug-register seeds separately. Reserved CR0 bits and
undefined debug reset values are not declared equal. The native capture's
instrumentation callbacks are native evidence only: they are not compared
with JavaScript byte-bus event order, and the three RAM words are not a
full page hash. FPU/device state, instruction counts, timing, and full
physical bus cycles also remain outside the scope.

The [Intel 80386 Programmer's Reference Manual, §10.1](https://pdos.csail.mit.edu/6.828/2018/readings/i386/s10_01.htm)
specifies IDTR limit `0x03ff` after reset, while the pinned Bochs CPU3
[`cpu/init.cc` reset](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/init.cc#L802-L803)
uses `0xffff`. The explicit guest `LIDT` aligns this one defined input
without changing either CPU's reset behavior or rewriting the older
native receipt.
