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
