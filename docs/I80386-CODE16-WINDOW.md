# Experimental 16-bit code-window admission

`prevalidateI80386Code16Window(machine, offset, length)` is an admission-only
helper for a future 16-bit native runner. It does not execute instructions and
is not wired into guest execution. This change makes no speed claim.

The helper captures exactly `length` code bytes (1 through 4096) from one
linear page. It requires a present 16-bit code-segment cache, an in-limit
offset span, and a full RAM or ROM board page. Real mode and VM86 use the same
CS-base/limit check as protected 16-bit mode. With paging enabled, the helper
uses only an existing translation-cache entry matching the current generation,
CR3, and CR4; CPL3 and VM86 require a user page. An uncached page is refused
without a page-table walk, fault, or accessed/dirty-bit write. The board's A20
bit-clear gate is applied to the physical page before mapping. The reset high
alias, VGA aperture, MP/APIC overrides, slow pages, and open-bus pages are
refused.

`isI80386Code16WindowValid(window)` checks mode, CS, paging identity, A20,
board map, and every captured byte before use. The byte comparison covers
guest writes, DMA/raw host writes, and ROM reloads without a code-page version.
The proof concerns only the captured span; it does not assert that the CPU's
current EIP equals `window.offset`. A future runner must check starting EIP and
CS, revalidate immediately before each run, and stop/revalidate after any
in-run write that could overlap the captured bytes. It must also preserve the
ordinary fetch's instruction-length and fault boundaries.
