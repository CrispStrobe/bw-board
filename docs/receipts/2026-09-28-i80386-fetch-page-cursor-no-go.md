# Ordinary 80386 fetch-page cursor: discarded prototype

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The pre-coding screen in `2026-09-28-i80386-ordinary-fetch-screen.md`
passed, but this narrow implementation failed its measured retention gate.
No executable cursor or CLI switch remains in the final board tree.

The exact opt-in candidate was board commit
`d528a35d165ffa809b2a57558c6f70de60e3c2ed`; two independent,
test-only commits brought the A/B revision to
`a5d723c6b97c9e45ef845383b95aac4e367499ef`.
The complete discarded diff from the screen commit
`13ecb7c284e47c8a63005814f4f22670c878c6ac` to that A/B revision is
`2026-09-28-i80386-fetch-page-cursor-discarded.patch` (SHA-256
`a6a15baa29d79532f345331d4f345d3493bfb116a3b0ff55c386f19eb9a20c8a`).
`git apply --check` on the screen commit succeeds. The executable change
was an explicit ordinary-only `--fetch-page-cursor` opt-in, caching a physical
page base for RAM at or above 1 MiB. It still called the ordinary board
`fetch()` on every byte. A hit required unchanged CS-cache object and fields,
privilege, CR0/CR3/CR4, A20 state, translation generation and the *same live*
512-slot JS TLB entry. `_fetchN`'s direct same-page path stayed ordinary.
Bare direct PTE mutation without translation invalidation is outside the
existing ordinary TLB coherence contract; colliding-slot eviction and
tracked/explicitly invalidated remaps were tested for parity.

All 48 focused tests passed, including 8 independently written differential
tests for CS in-place mutation, code writes, PTE remap/eviction, A20,
CR3/CR4/PSE, CPL faults, partial EIP/CR2/A-D behavior, and ROM/VGA fetches.
At candidate revision `d528a35d`, a full 60M-step diagnostic baseline and
candidate had identical complete guest JSON after removing only
`inputs.fetchPageCursor` and `fetchPageCursorStats`; both stopped at budget
with null refusal. The candidate counted 34,256,673 cache hits and
91,258,465 `_fetch8` misses, including 90,456,583 excluded non-RAM or
below-1-MiB fetches. Another 22,195,880 bytes used `_fetchN` directly.
Thus hits were only **23.19% of 147,711,018 completed fetch bytes**. The
earlier 98.49% page/context opportunity was an upper bound for *all* bytes,
not coverage of this implementation. Diagnostic timing is excluded from the
speed result.

Host load before the pair was 6.19/6.36/6.54. Both reports have identical
source inventories, input hashes, 60M budget and null refusal; complete guest
JSON matches after removing only the opt-in input and diagnostic-stat fields. The baseline took **74.66 user CPU seconds** (1.21 system, 67.44 wall); the
candidate took **80.79 user CPU seconds** (1.68 system, 73.94 wall), **8.21%
more user CPU**. The predeclared retention gate required at least 10% mean
improvement and every pair favorable. This unfavorable first pair closes the
gate; no further A/B legs or xv6 candidate run were warranted. The heavy VPS
slot was released.

Private raw guest reports, timing, candidate counters and exact pinned media
hashes are under `windows/2026-09-28/ordinary-fetch-cursor-prototype-60m/`
in the private repository. This result advises against simply adding more
per-byte page/context validation to ordinary fetch. A future design would
need a different cost model and a new predeclared gate; this patch is retained
only to make the negative result reproducible.
