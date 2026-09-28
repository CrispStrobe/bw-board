# Ordinary 80386 fetch-page cursor pre-coding screen

This is an opportunity screen, not a speed result. It uses ordinary one-step
execution of Windows 3.11 for exactly 60,000,000 guest steps. Board base is
`aafffc245c4c2cc286bb8a226ca5a8efa0962bc2`; no native blocks or code16
WASM were enabled. The media-free observer and reducer are
`scripts/observe-i80386-fetch-cursor.mjs`,
`scripts/lib/i80386-fetch-cursor-eligibility.mjs`, and
`scripts/summarize-i80386-ordinary-fetch-profile.mjs`. Their SHA-256 values
at measurement were respectively `77c2d478e2037be9a3d250a81d07677b9a62495d860c11aff7f2b7aeef77202f`,
`09118eb72ad18a2f358a1c12820a18ab0a125e155d1980a43c8322f34c92bb28`,
and `749efad06df10e6ba0517412360f8eb52c297f931ea53d78c90377ab652773b9`.
The private predeclaration is `windows/2026-09-28/windows311-ordinary-fetch-screen-plan.md`
at private commit `be24422787d00b8a25a461ef80eec188d78972be`.

Pinned input SHA-256 values: AT BIOS
`6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac`,
VGA BIOS `76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1`,
Windows HDD `a6d869d0e1352143a60b917d1e3ba7720fe48c7931a088ed82f4302a6b76e9d9`,
DOSBox CHS config `7d976cdb4aa8f74dc072a575d1e4bf1ec76ec3858a7ca9018d11e1edfda750d8`.
Node was v20.20.2 on a 4-vCPU KVM Skylake VPS. Host load at start was
5.68/6.62/7.31. The V8 profile used `--cpu-prof-interval=5000`; its raw
profile SHA-256 is `a70bc7ce7feff8edcdc53f53332549d8b5ee554528a81ce483209df8e265d179`.

The reducer assigns each of 13,718 V8 **self samples** to exactly one bin.
`_fetch8` or `_fetchN` ancestry in `src/experimental/i80386.js` takes priority;
data/EA ancestry takes the next bin. Samples with no visible fetch frame are
not credited to fetch, even if V8 inlined relevant work. Counts are:

| Disjoint bin | Samples |
| --- | ---: |
| Code-fetch origin | 1,945 |
| Data/EA origin | 2,133 |
| Other core | 7,695 |
| Other AT board | 473 |
| Other console runner | 657 |
| All other | 815 |

Code-fetch origin is **14.1785% of all process samples**, above the predeclared
10% gate. This is an attribution envelope, not removable CPU time. Inlining
can leave some fetch work in another bin, and a physical-page cursor will still
pay per-byte board fetch and fault checks.

The preload attaches to the first `Machine.step()` and restores the method
immediately. It wraps CPU fetch methods without guest-visible reads; `_fetchN`
bytewise calls count through `_fetch8`, whereas its coalesced successful bytes
count through the `_instructionBytes` delta. Faulting calls revoke the cursor.
Identity includes linear page, CS-cache object, CPL, CR0, CR3, CR4,
translation generation/cache setting, and both configured and effective A20.
An A20 toggle fixture confirms revocation, and focused tests verify same-page,
cross-page, CS/CR3/generation, and partial-fault counts with no extra bytewise
fetch callbacks. `node --test test/i80386-ordinary-fetch-profile.test.mjs
test/i80386-fetch-cursor-eligibility.test.mjs` passed 7/7.

The 60M observer counted 147,711,018 completed instruction-fetch bytes;
145,484,414 matched the preceding page/context identity (**98.4926%**), above
the predeclared 80% gate. Ineligible transitions were linear page 1,914,291;
CS reload 304,794; translation generation 7,514; CR0 3; CR3 1; initial
cold byte 1. There were no failed fetch calls in this run. The observer JSON
SHA-256 is `e77d3e2e1d569beb02da16d0a8975fb10adf17928fcf9b83c93f1c72ddfe1fd0`.
This is an **optimistic opportunity bound**, not a proof that every byte can
reuse a physical mapping. Normal CPU writes and AT DMA/host `_write` paths
notify the translation tracker; direct `machine.mem.set` ROM/state restoration
and arbitrary direct raw-memory mutation bypass that watcher. A runtime cursor
must explicitly guard those paths or refuse reuse when it cannot prove safety.

The complete profiled, adjacent unprofiled, and observed guest JSON files are
byte-identical, each SHA-256
`ead44c9599c0cdd1e3ae0d3cba683cb1c977d54cd4fd4ff443625b6a06baecbd`.
All stopped at the 60M budget with null refusal. User CPU seconds were 77.59
(V8 profile), 75.74 (control), and 91.86 (instrumented observer); their
instrumentation differences are not speed comparisons. Private raw profile,
reports, timing and pinned media provenance are under
`windows/2026-09-28/ordinary-fetch-screen-60m/` in the private repository.

The next experiment may cache only a physical page base, never instruction
bytes, behind an explicit opt-in. It must preserve each board fetch, segment
and instruction-length checks, page-walk A/D and fault behavior, permission
changes, A20, page-table/DMA/host writes, and chip/IRQ boundaries. The
predeclared retention test is full Windows 60M plus lean xv6 guest/RAM parity
and three serial AB/BA/AB Windows user-CPU pairs with at least 10% mean gain
and every pair favorable. Passing this screen does not imply that gate will pass.
