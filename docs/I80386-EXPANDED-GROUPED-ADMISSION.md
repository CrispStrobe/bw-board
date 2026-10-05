# Expanded cross-mode grouped shadow admission: predeclared diagnostic

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

The
combined [owned state-ordering fixture](I80386-COMBINED-ORDERED-STATE-CONTRACT.md)
and [selected register-stack fixture](I80386-REGISTER-STACK-ORDERED-CONTRACT.md)
do not establish an executor or CPU-cost gate.

Neither flag changes guest
execution: every step still uses the ordinary CPU and AT board. Native blocks,
code16 execution, other observers and shared-RAM execution are incompatible
with this measurement. The observer records only instruction bytes and bus
accesses already performed by a completed ordinary step; it does not fetch
ahead or read guest memory for classification.

The grammar retains the earlier grouped data/flag/EA forms and adds narrowly
typed `8E` **ES only**, direct `E8` near CALL, `C3` near RET, and memory
`FF /2` near CALL. Prefixes and register-indirect `FF /2` remain refused.
The classifier checks instruction length, actual successor, and ordered
physical bus bytes: `E8` writes the return offset to the stack; `C3` reads
it; memory `FF /2` reads its target before writing the return offset.
`8E` memory source reads precede any protected-mode descriptor reads and
optional Accessed-byte write. The [ES load contract](I80386-8E-SEGMENT-LOAD-CONTRACT.md)
and [CALL/RET contract](I80386-CALL-RETURN-ORDERED-CONTRACT.md) pin these
individual ordinary-CPU effects. They do not prove a combined executable
trace or external equivalence for every form.

All earlier code-page, plain-RAM data, single-data-page, translation,
page-table/code-write, A20/segment-cache identity, device I/O, chip-event,
interrupt, fault, host/DMA write and maximum-64-instruction cuts remain.
An `8E` ES reload can join a run only when its complete observed traffic
passes and the cached identity and visible ES selector remain unchanged.
A changed cache is a global `identity-change` refusal. The report separately
counts a typed form rejected by a global cut; that count is **not** admitted
coverage. A changed visible selector also cuts even if the cache identity
would otherwise compare equal. No stack forms beyond the three named near
control forms are admitted. Any source and stack traffic spanning data pages
is refused.

For xv6, run a
separate ordinary lean stock 4 MiB `forktest` baseline/observed pair with
`XV6_RAM_HASH=1` and the same firmware, images, command, expected serial
marker and step ceiling. Do not combine broader guest and xv6 ordinals. The
source-bound reducer is invoked as
`node scripts/summarize-i80386-expanded-grouped-result.mjs windows observed.json baseline.json`
or with `xv6` in place of `windows`. It verifies committed source bytes,
whole reported guest/input equality after removing only
`crossModeTraceObserver` and the corresponding
`expandedGroupedAdmission` flag, and exact final RAM, attached disk,
full instruction snapshot, CPU-cycle and board-cycle parity. Private raw
reports retain media identifiers and guest text; publish only the compact
reduction.

Report all four modes, run-length
histograms, refusals and typed-but-global-cut counts. The separate xv6
census reports the same partitions but has no predeclared pass threshold;
it cannot compensate for a failed broader guest gate. Observer CPU time is
instrumentation cost, not a speed result. Passing the optimistic syntax and
bus-shape screen would still require combined fault/event/mapping proofs,
an overlap-safe CPU-cost gate, and later paired uninstrumented execution
before any executor or speed claim.
