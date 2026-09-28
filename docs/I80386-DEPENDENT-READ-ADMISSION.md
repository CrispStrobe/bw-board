# 386 dependent read admission

`prevalidateI80386DependentRead(machine, firstOffset, firstWidth,
deriveSecondOffset, secondWidth)` is a side-effect-free, read-only admission
helper. It uses existing cached translations and installed kind-1 RAM for a
flat protected32 CS/DS pair. It reads the first scalar directly from proven
RAM, passes that value to a trusted pure address-derivation callback, and
proves the derived second scalar's cached read window. Widths are 1, 2, or 4
bytes. Either scalar crossing a page or wrapping the 32-bit offset refuses.
No guest translation, bus read, bus write, or instruction execution occurs.

The helper refuses uncached, MMIO, non-RAM, privilege-incompatible, code/data
aliased, and source/derived page-aliased cases. Cached reads *from* page-table
RAM are allowed; this helper returns only read windows and a `readOnly` marker.
The separate native write-window proof refuses page-table targets. It
captures CS/DS selectors and descriptor scalars, the current code page,
CR/paging translation and A20 identity, RAM mapping, and the first scalar
value. Validation rereads the
first bytes because host, DMA, or an earlier guest store can change plain RAM
without changing translation generation.

This is not an executable block contract. A future executor must validate at
the actual dependent-read instruction slot after any preceding native steps,
with no intervening write alias, and fall back before that instruction's
architectural change if either window or predicted value is stale. It must
also separately prove code bytes, fault/restart ordering, page-table-write
coherence, and event/interrupt/debug boundaries. The callback's purity is a
caller obligation; it receives only the captured scalar, but JavaScript
closures cannot be made side-effect-free by this helper. No speed claim is
attached to admission alone.
