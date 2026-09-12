# Native dirty-driver frontier

2026-09-12. Gated incremental kernel only. This is not a CPU, complete native
board, speedup qualification, or 4.77 MHz result.

The independent screen-session lane supplied counter instrumentation `e6ca521`,
queued producers `25ed8b4`, historical A/B receipt `3748d15`, and review fixes
`d69e5dc`. Root integrated these as `1337e27`, `cd46a67`, `f13bc94`, and
`381975f`, preserving phase ABI v2's split preview/finish/abort lifecycle.

## What changed

The incremental resolver no longer discovers changed drivers by scanning the
whole driver array each delta. Every runtime producer calls
`write_owned_driver(context, id, fourStateCode)`: host image updates, compiled
schedule updates, controller commands, latch outputs, memory outputs, and
evaluator commits. Changed driver IDs are queued once and mapped to dirty nets.
Ordered duplicate writes still use their final value. Admission may initialize
the image directly; post-admission runtime writers may not bypass the seam.

Initial full-net admission, live/pending state after failed convergence, and
complete publication remain intact. Conflict-only changes still publish even
when the resolved value does not require evaluator work. This does not remove
the JS bulk-image scan, evaluator dependency scans, full staging, or full
publication copies. Future bus/CPU producers must use the same writer.

## Review corrections and compatibility

Independent review caught two blockers before root integration:

- The mandatory writer changes the incremental ABI. Keeping version 1 would
  let old wrappers write the arena without queueing updates. Version **2** now
  forces reconstruction with a compatible artifact; new wrappers also require
  the writer export explicitly. Stale modules must fail, never silently run.
- The JS wrapper and C writer both counted one host transition. The duplicate
  JS addition was removed; a regression checks a single host transition once.

Phase ABI v2 is a separate contract. Its preview captures READY; the bus/master
samples before finish releases strobes. Controller writes inside both begin
and finish use the queued writer. Previewed periods still block schedules before
any driver mutation. There is no hot swap or mid-period fallback.

## Evidence and limits

[HARRIS-NATIVE-DRIVER-FRONTIER-AB.json](HARRIS-NATIVE-DRIVER-FRONTIER-AB.json)
pins the pre-review-fix source/artifacts and three shared-host timing rounds.
All compared net, phase and complete-memory hashes matched. For its 8,194-period
component schedule, counted driver comparisons fell from 6,248,400 to 1,980,824;
dirty-net resolutions, net visits, dependency probes and publication work stayed
the same. Median timing was 84.92 ms before versus 90.75 ms after, with overlapping
and reversing rounds: **no measured speedup is established**.

The ten work counters are kernel-oriented observations, not an accounting of
all host work. In particular driver comparisons exclude JS image scanning.
Native counters are unsigned 32-bit and wrap modulo 2^32; reset at bounded
measurement boundaries and do not infer an unbounded monotonic delta. They do
not influence execution admission or selection.

The lane reported seven rebuilt mutation kills for producer bypass, invalid
four-state input and duplicate-write ordering. At initial root review these
were reported in a temporary handoff, not a committed machine-readable mutation
receipt; do not upgrade that report to independently reproduced evidence.
Combined root qualification and the next bus bridge remain separate gates.

## Subsequent root mutation verification

The verifier is now committed as
`scripts/verify-harris-native-dirty-frontier-mutations.mjs`. Root extended it to
cover the new bus's external-input and output producers, then reran all **nine**
mutations in an exclusive disposable worktree. All nine rebuilt artifacts
triggered their named differential failures; the worktree was clean afterward.
See [HARRIS-NATIVE-DRIVER-MUTATIONS.json](HARRIS-NATIVE-DRIVER-MUTATIONS.json)
for the exact revision/tree and results. This closes the earlier missing
reproduction evidence, not the performance or whole-CPU qualification gap.

Do not run the verifier beside another worker or benchmark in a shared tree:
it briefly mutates C sources while building each artifact, restoring them before
the named test. Use an isolated checkout even though restoration is guarded.

## Reverse-index continuation

The later `91a20c5` checkpoint removes the remaining forward dependency probes
from the incremental path. The wrapper builds a caller-owned net-to-operation
CSR inverse, and admission proves it exactly matches the forward dependency
image before changing occupancy, live state or queue state. ABI v3 refuses the
old context layout. Affected rows are marked from changed nets and then consumed
in original row order, so duplicate-output last-write behavior is unchanged.

The 8,194-period receipt records 667,808 to zero forward probes and 4,126 reverse
membership visits. All ten prior counters and all correctness hashes remain
exact; timing is diagnostic. The new work-counter ABI v2 adds the separate
`reverseIndexVisits` field rather than changing the meaning of the historical
`dependencyProbes` field. See
[HARRIS-NATIVE-REVERSE-INDEX-AB.json](HARRIS-NATIVE-REVERSE-INDEX-AB.json) and
[HARRIS-NATIVE-REVERSE-INDEX-MUTATIONS.json](HARRIS-NATIVE-REVERSE-INDEX-MUTATIONS.json).

The subsequent `e5a3545` checkpoint replaces the remaining full operation-row
scan with ascending words and bits in a caller-owned packed mark set. ABI v4
changes the mark allocation contract; work-counter ABI v3 separately counts
bitset words. On the same schedule, 26,630 scanned rows become 2,050 evaluated
rows plus 1,025 word visits. Reverse visits remain 4,126, all other counters and
all correctness hashes remain exact, and timing remains diagnostic. See
[HARRIS-NATIVE-OPERATION-BITSET-AB.json](HARRIS-NATIVE-OPERATION-BITSET-AB.json)
and [HARRIS-NATIVE-OPERATION-BITSET-MUTATIONS.json](HARRIS-NATIVE-OPERATION-BITSET-MUTATIONS.json).
The final admission proof refuses arena-impossible operation/dependency counts
before table dereference, directly asserts reverse-hit deduplication, and clears
a three-word bitset on re-admission. Ten bitset mutations and the seven inherited
reverse-index mutations pass on ABI v4; the latter have a distinct committed
receipt at [HARRIS-NATIVE-REVERSE-INDEX-MUTATIONS-ABI4.json](HARRIS-NATIVE-REVERSE-INDEX-MUTATIONS-ABI4.json).
