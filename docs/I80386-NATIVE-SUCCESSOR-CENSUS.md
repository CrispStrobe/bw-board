# Completed native successor census

This opt-in observer measures the opportunity gate in
[the protected32 trace design](I80386-NATIVE-TRACE-NEXT.md). It runs only
after a native block has retired at least one instruction in
[the dispatcher](../src/experimental/i80386-native-dispatch.js). The
[accumulator](../src/experimental/i80386-native-successor-census.js)
receives the actual before/after CS:EIP, retired count, WASM exit reason,
pre-call budgets, and cached successor status. It does not decode ahead,
walk page tables, read the guest bus, execute an extra instruction, or add
fields to the guest report. The only successor validation uses the existing
side-effect-free code/window helper: direct kind-1 RAM byte comparison and
cached translation/permission checks, with no guest-visible read or A/D
change. The observer writes its aggregate JSON to a separate file.

Run a complete lean xv6 forktest with the ordinary opt-in native dispatcher:

```sh
XV6_LEAN=1 XV6_RAM_HASH=1 XV6_NATIVE_DISPATCH=1 XV6_FIRMWARE=bochs \
XV6_STEPS=40000000 XV6_STOP_ON_EXPECT=1 XV6_COMMAND=$'forktest\r' \
XV6_EXPECT_SERIAL=$'fork test OK\n$ ' \
XV6_NATIVE_SUCCESSOR_CENSUS=/tmp/native-successor-census.json \
node scripts/probe-xv6-stock.mjs > /tmp/xv6-successor-observed.json
```

Repeat without `XV6_NATIVE_SUCCESSOR_CENSUS` and compare complete stdout
reports byte-for-byte. The receipt pins source, fixture, report, and census
hashes. Do not use the observer run as a timing A/B; extra validation occurs
only when the observer is enabled. This direct validity scan is an
observer-only upper-bound check, not a proposed production cost model.

Every completed native call enters exactly one bucket in each partition:
WASM exit reason; caller/chip/LAPIC event limit (ties or inconsistent counts
are unknown); immediately due post-call chip/LAPIC event; actual next-PC
relation; cached successor status; within-block link state; and first-tranche
opportunity. A cached successor is counted
only at the *actual* returned CS:EIP, after checking cache identity and the
existing block/window/byte validity. `cached-valid-register-only` means
its code window and bytes are valid, its data-window set is empty, and its IR has no memory,
REP, I/O, or control-state operation. A cold, negative, identity-stale, or
code/window-unsafe successor is excluded. The exact reason for a failed
code/window check is not inferred. A tied chip/LAPIC/caller deadline is
`tie-unknown`.

`linkedInside` describes existing IR links **within the call**. No such
internal edge adds a successor call to the numerator. `taken-proven` means
the block has a linked edge and retired more instructions than its IR length
without REP; `present-taken-unknown` means a linked edge exists but the
available counters cannot prove whether it was taken. The observer does not
turn either label into additional elidable calls. `optimisticElidableCalls`
requires a completed `done` exit, a register-only source, a different
actual successor PC, a cached valid register-only successor, and no chip or
LAPIC event immediately due after the call. This is a
disjoint per-call **upper bound**: it does not prove that all trace code
pages could have been validated at the prior entry, that a branch path is
profitable, or that combining calls is fault/event safe. A production trace
must also recheck pending IRQ/NMI and any other admission guard at each
event boundary.

The [owned tests](../test/i80386-native-successor-census.test.mjs) check
partition sums, an existing linked loop, exact chip/LAPIC budget categories,
actual cached successor EIP, and revocation after a code edit. Full-run
counts and their interpretation belong in a source-pinned receipt, not in
this method document.
