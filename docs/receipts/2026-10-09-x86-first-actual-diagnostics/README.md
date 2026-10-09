# First actual mixed-frame and allocation diagnostics

Both reviewed sources passed every enabled ordinary check before their labels
were applied once. Both actual runs failed. Original packet/source admission
and separate original-packet audits passed; that does not qualify the guest or
profiler. [Machine-readable summary](summary.json) preserves exact identities.

## Mixed-mode frame entry, then task-switch attempt

[PR466](https://github.com/CrispStrobe/bw-board/pull/466), source
`1ecb987b86217c7c549fffc1d3b7ff498898b9dd`, passed 12 enabled checks; two
optional `vectors-full` checks skipped. Actual [run37888190298](https://github.com/CrispStrobe/bw-board/actions/runs/37888190298)
retained [artifact11597560239](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11597560239/zip).
The original report-only packet contains 112 members, 196 authenticated source
roles and 62 JavaScript graph nodes. Root and a separate Sol reader audited
its original bytes, immutable Git roles and finite failure facts.

The exact owned wrapper comparison passed without changing its reported state.
The CPU committed an INT31/AX0501 entry for the 4,096-byte request: gate14,
32-bit frame, code16 handler, stack32, CPL3 to CPL3, 12-byte same-stack frame.
Handler ESP 627888 equals caller ESP 627900 minus 12. At active step20 the
observer invalidated with `task-switch-during-owned-frame`. Return remains null;
there is no completed IRETD/frame pair or finite client/shell success here.
The source guard runs before task descriptor validation: this proves entry
into the attempted task-switch path, not a committed task switch or its cause.

Next: record bounded primitive attempt facts at that guard without descriptor
reads, guest changes, relaxed ownership or return credit. Preserve the failure
and qualify the separate follow-up head before another actual diagnostic.

## Allocation support fixture refused before any guest

[PR467](https://github.com/CrispStrobe/bw-board/pull/467), source
`3269cf1f2e0c009d8e0a331aa93bee498863bc2a`, passed 10 enabled checks; two
optional checks skipped. Actual [run37888206087](https://github.com/CrispStrobe/bw-board/actions/runs/37888206087)
retained [artifact11596534193](https://api.github.com/repos/CrispStrobe/bw-board/actions/artifacts/11596534193/zip).
All five original report-only members and 18 source roles matched their
inventories. Root and a separate Sol reader audited the raw profile and facts.

The first minor-GC baseline refused because only 3,328 of 4,096 allocated target
arrays were collected. Its retained timeline contains 46 minor, three major
and three other GC events; major GC also prevents the intended minor-only
control from qualifying. No enabled-flag control, support receipt, xv6 image
build or guest child completed. This establishes neither unsupported Inspector
flags nor an allocation hotspot or CPU cost share.

Next: a separate reviewed support-fixture correction with a small fixed target
cohort and bounded pressure schedule, while preserving all-target collection,
minor/major separation, baseline/flag comparisons and original failure evidence.
Keep the held emulator and guest probe unchanged. Any fixture-only anti-inlining
setting needs explicit runtime validation; never count surviving helper objects
as evidence that collected target allocations were sampled.

No new RTx, speedup, Windows, complete AT or general application claim follows
from these diagnostics. Neither source was merged or adopted.

Separate reviewed follow-up sources are [PR468](https://github.com/CrispStrobe/bw-board/pull/468)
(task-attempt facts) and [PR469](https://github.com/CrispStrobe/bw-board/pull/469)
(support-fixture correction). Source reviews and CPU-free controls passed;
hosted qualification remains pending. They do not replace these frozen failures.
