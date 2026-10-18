# Separately admitted post-PF connected observer

This new profile derives the historical PF-connected driver from CPU prerequisite
`3bd7b09cc01f02bd99f2c3b4d72b982d1f511f77`. It is source only and unexecuted.
The CPU, historical drivers, free inputs and compile/acquisition helpers remain
unchanged. It does not replace or rerun the preserved PR492 original.

The derivative owns both task-mode and PF tokens. It requests the own-data
`postPfHandoff:true` flag before the fault, then calls the CPU handoff after the
terminal returned PF and before either historical observation drains or terminal
progress runs. A returned report cannot supply token authority. Successful mint
permits the historical observations to drain without contributing a new task
transition or frame acceptance.

One same-machine continuation has at most 100,000 board calls, 100,000 ordinary
CPU attempts and 120 seconds of monotonic wall time. Actual attempted and committed
CPU counters are distinct. A zero-attempt board call is retained as a neutral
count; an observing session with no source attribution for that call refuses.
A scalar delta never proves an IRQ. Source IRQ events and decoded IRET intents
remain separate records, including candidate invalidation or mode refusal.

Callback boundaries bind CPU/machine, API and memory/cache references and closed
CPU/board scalar and descriptor facts. The new fence permits the source-owned
plain partial-REP context; it does not reuse an entry-only snapshot, hash RAM on
every poll, or claim a bus/device snapshot. Reentry, changes at clock/progress
boundaries, stale tokens and owner changes refuse. Partial status, counters,
exceptions and first refusals remain when cleanup or reporting fails. A completed
source counter read is reconciled before an observer-fence failure can discard
its delta. An unavailable read leaves an explicit pending step and no consistency
credit.

The adapter always retains `passed:false`, the original strict
`task-switch-during-owned-frame` refusal, null return and
`frameReturnQualified:false`. Its separate grade can admit finite source-consistent
observer facts while preserving a CPU refusal. Closed source record shapes,
numeric bounds and commit primitives are required before counting retained IRQ
boundary records or decoded intent records; those counts provide no new authority. A resumption candidate and decoded
IRET intent do not qualify core frame consumption, PF service, repair/retry,
client completion, application compatibility or performance.

Source admission authenticates 278 held Git roles at the prerequisite plus the
12 new profile paths, recursively closes all 175 held JavaScript roles plus the
six new JavaScript modules through literal relative imports and requires an exact clean
checkout and narrow delta. The inventory accepts bounded historical reports,
new observer reports and the exact retained CWSDPMI notice, excluding input
archives, executables, images, RAM and TSS dumps. The workflow defaults to
synthetic controls only; a distinct label-only job remains separately gated.

No local Node, compiler, guest or helper execution occurred. Python source and
inventory controls are static/synthetic checks only. Hosted mock controls,
independent source review, a prospective original reader and one-shot guard,
and all enabled exact-head checks must qualify before one connected diagnostic.
No actual launch is permitted by this source checkpoint.
