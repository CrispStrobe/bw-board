# Experimental 16-bit data-window admission

`prevalidateI80386Code16DataWindow(machine, codeWindow, segment, offset,
width, access)` proves one scalar memory operand for a future 16-bit code
runner. `codeWindow` must be a currently valid proof from
`prevalidateI80386Code16Window`. `segment` is the CPU segment index (ES=0,
CS=1, SS=2, DS=3, FS=4, GS=5); `offset` is a 16-bit unsigned offset;
`width` is 1, 2, or 4 bytes; `access` is `read` or `write`. The offset cap
intentionally excludes address-size override cases. The helper returns
`null` if any condition cannot be proved. It does not read the bus, walk page
tables, set accessed/dirty bits, raise faults, execute instructions, or make a
speed claim.

Admission follows the interpreter's segment base, limit, expand-down,
presence, and protected-mode access checks. A 32-bit linear wrap is refused.
Each linear page needs a current translation-cache entry when paging is on.
CPL3 and VM86 require a user page; a user write also needs a writable page.
Writes need the cached dirty bit already set, since an ordinary first write
would update a paging entry. Supervisor writes to a read-only page remain
eligible if the existing translation is dirty, matching the interpreter's
current privilege rule. A crossing scalar requires both translations before
admission, preserving the interpreter's translate-all-before-store behavior.

The proof contains frozen decoded physical byte addresses. Reads permit full
RAM and ROM pages; writes permit only full RAM pages. The board's A20 gate is
applied after translation. A20-gated writes are refused because the board
invalidates its translation cache on every such write. The reset high alias,
VGA and MP/APIC ranges, slow pages, open bus, known page-table pages, and
writes overlapping captured code bytes are refused. The page-table exclusion
covers both translated and A20-decoded physical pages. No commercial media is
used or added.

`isI80386Code16DataWindowValid(window)` rechecks the code proof, segment
cache and selector, paging identity, A20 state, page kinds, page-table set,
and every decoded physical address. Data bytes are deliberately not captured:
a direct read must see current memory, and an ordinary safe data write need
not invalidate its own mapping proof. A future runner must revalidate
immediately before each access, check its own starting EIP, preserve
all-translations-before-any-store semantics for a crossing write, and stop or
revalidate after changes to any assumption. The helper does not perform the
direct read or write and is not wired into guest execution.
