# Native unchanged-writer suppression

Measured 2026-09-19 on the memory-only admitted incremental Harris path. This
change suppresses canonical writer submissions only when the authoritative raw
four-state driver slot already contains the proposed `0`, `1`, `X`, or `Z`.
External bus inputs and the address latch still compute and validate every
candidate in original order. Changed values still enter
`write_owned_driver_tagged`, which preserves the dirty queue, producer identity,
and last-write behavior.

The comparison occurs only after each circuit mapping has passed its complete
validation. In incremental mode admission has already proved a bijection from
all admitted drivers to nets, so an unchanged admitted driver cannot need the
canonical writer's membership fault. Repeated submitted mappings are processed
in order and each changed write updates the raw slot immediately; a later value
therefore still wins. Resolved-net equality is never used to skip work.

The exact-source interleaved A/B receipt is
[2026-09-19-harris-native-writer-suppression.json](receipts/2026-09-19-harris-native-writer-suppression.json).
Across every warmup and measured pair, final CPU, bus, phase, lifecycle, net and
memory state matched, as did completion-trace hashes, fault traces, progress,
value-changing writes, and every unaffected counter. For 57,392 physical
periods and 6,148 retired instructions per arm, the candidate removed 573,920
unchanged external submissions and 1,430,683 unchanged latch submissions. It
retained all 61,509 latch changes and all changes from every other producer.

The 12 measured unpaced same-host pairs had a median candidate/base wall
throughput ratio of 1.018, with a noisy 0.838–1.493 range. This is inconclusive
timing evidence, so no stable speedup is claimed. The accepted result is the
2,004,603 exact writer comparisons removed while observable execution remains
identical on this workload. This is memory-only native execution, not DOS,
browser, peripheral, protected-mode, or real-time evidence.

Focused actual-net bus, phase, edited-wire, X/Z, validation, and fault-order
oracles remain green. Mutation proof restores either unconditional writer loop
and requires the producer-counter test to turn red; all 25 producer-counter
mutations were rejected.
