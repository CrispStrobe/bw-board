# Experimental strict 80386 feature profile

`new I80386(bus, {cpuProfile: "strict386"})` opts into an original-80386
**feature boundary** for the experimental CPU. The ordinary constructor and
AT board continue to use `"compatibility"`; that default accepts CR4.PSE to
run the unmodified stock xv6 bootstrap. Strict mode is separate construction,
with no speed claim or assertion that every 386 instruction, debug facility,
peripheral or physical 386DX timing is qualified.

Strict mode raises `#UD` for `MOV` to or from CR4 and the later `BSWAP`
instruction, and refuses an externally supplied nonzero CR4 before
translation. The latter guards direct host state mutation as well as guest
instructions. Pinned Bochs CPU level 3 gates `MOV CR4` and PSE behind later
CPU levels in [`crregs.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/crregs.cc)
and [`paging.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/paging.cc).
The [Intel 80386 Programmer's Reference Manual, §4.1.3](https://www.read.seas.harvard.edu/~kohler/class/aosref/i386.pdf)
lists CR0, CR2 and CR3 as its control registers; `BSWAP` is outside its
instruction set, and the [Intel instruction reference](https://cdrdv2-public.intel.com/812383/253666-sdm-vol-2a.pdf)
explicitly says it is unsupported before the Intel486 family. Thus strict
mode cannot be used to claim the
[stock xv6](XV6-STOCK.md) result as a physical 386DX run; that kernel's
bootstrap requires CR4.PSE and 4 MiB pages.

Strict mode keeps the existing Intel-defined CR0 behavior. Reset ET comes
from the explicit `none`, `80287` or `80387` coprocessor choice; `MOV CR0`
can subsequently change ET. The manual's reset figure in §10.1 says ET
reflects the ERROR# input (ET=1 for an 80387, ET=0 for none or 80287), while
§11.1 explains that software may change it. Its §4.1.3 register diagram
defines PE, MP, EM, TS, ET and PG and marks bits 5–30 reserved. The current
core exposes deterministic zeroes for those reserved bits. Pinned Bochs CPU3
instead forces `0x7ffffff0` in [`init.cc`](https://github.com/bochs-emu/Bochs/blob/0e45b736ef9792eb9b752b0a35db49eaf2faea47/bochs/cpu/init.cc)
and on `MOV CR0` writes in `crregs.cc`, including ET=1. That is a named
Bochs-reference readback policy, not evidence that Intel requires ET=1 in a
machine without an 80387. In particular, Bochs's forced bit 16 must not
activate later 486-style supervisor write-protect behavior: strict mode's
page checks still permit supervisor writes to present read-only pages.

The manual's §10.1 does not specify reset contents for the debug registers.
The JavaScript core retains its deterministic zero seeds, while pinned Bochs
sets DR6=`0xffff1ff0` and DR7=`0x00000400`. Strict mode does not present
these raw values as physical-386 reset requirements. `DR4/DR5` are reserved
in the manual; strict mode refuses their access rather than qualifying a
particular response. It also refuses enabling hardware breakpoints or setting
DR7 bit 13 because the corresponding debug/ICE controls are not modeled;
this is not a claim to implement a later-model GD fault contract. Ordinary DR0–DR3
transfers remain available. This is an explicit limit on debug qualification.

The [owned integer/system comparator](../scripts/compare-bochs-cpu3-owned-integer-state.mjs)
uses the committed [native Bochs CPU3 checkpoint](receipts/2026-09-30-i80386-bochs-cpu3-owned-native-checkpoint.json)
and assembles the same owned fixture. It requires exact committed bytes for
the fixture, CPU, native receipt and comparator, checks the native Bochs source
pin and assembled image hash, and runs only the JavaScript fixture. Its
JavaScript side chooses an explicit `80387` reset to align the defined ET
input with the Bochs reference, then starts at the owned post-load entry.
Run it from a clean checkout with `node
scripts/compare-bochs-cpu3-owned-integer-state.mjs`.

The comparator checks GPRs, EIP/EFLAGS, CR2/CR3, the **defined 80386** CR0
bits, descriptor-table bases/limits, TR/LDTR projection and VM86 segment
selector/base/limit/presence/size. It reports raw CR0 and DR values and the
different internal VM86 CS cache type without silently treating those
encodings as equal. It does not compare TSS RAM, FPU or device state, Bochs
hook order against board byte transactions, or instruction timing. A scoped
field match is therefore only that, not an overall CPU or bus qualification.

At committed source `485b72af12a115d9a6d6c9da33ab04c47c3456d5`, the
[comparison receipt](receipts/2026-09-30-i80386-bochs-cpu3-owned-integer-compare.json)
records `BHVK003` after 37 JavaScript steps and a match on every selected
integer/system field. It still reports raw CR0 `0x19` versus native
`0x7ffffff9`, DR6/DR7 reset differences and the internal VM86 CS cache type
difference. No native guest was rerun for this comparison.

The focused tests cover default retention, CR4/PSE and BSWAP refusal, ET
writability, the bit-16 supervisor-write hazard, unmodeled debug controls,
and adversarial defined-state comparator mutations. The existing owned
assembly fixture and native v1 probe remain unchanged.

The separate [owned paging-v2 comparison](I80386-BOCHS-CPU3-PAGING-COMPARISON-V2.md)
checks strict-mode 4 KiB paging and three final plain-RAM words against a
native CPU3 capture. Its selected state has one defined IDTR reset-limit
difference; the recorded result preserves that mismatch.
