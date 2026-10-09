# Connected far-attribution original: bounded grader refusal

[Draft PR483](https://github.com/CrispStrobe/bw-board/pull/483), reviewed source
`72d0b32e8bd7d658447745129119e2300ad6bec1`, passed all ten enabled
checks with only two declared optional skips before the single
[original run 37963673934](https://github.com/CrispStrobe/bw-board/actions/runs/37963673934).
The official conclusion is failure. Root and an independent reviewer audited
the retained original packet, source and log; [summary.json](summary.json)
records the bounded facts and original identities.

The closed packet has 119 members, 224 source roles and a 64-node recursive JS
graph. The strict owned frame still refuses `task-switch-during-owned-frame`,
with `returned:null` and `frameReturnQualified:false`. The separate exact-two
task-transfer grader returns `UNQUALIFIED_ATTRIBUTION_REFUSED`: this original
reports **15** committed task transfers and **15** committed mode changes.
Its first three relevant changes are source-issued MOV CR0 at steps 47 and 442,
then a source-issued direct EA reload at step 443. Five EA tickets are reported
in the full bounded tape. That observed prefix does not satisfy the frozen
whole-tape grader; no predicate was relaxed after this run.

The mode observer then records `step-failure`. A CPU fault fact at step 1859
reports vector 14 and error-code presence, but no error-code value or committed
enclosing step. The packet does not establish fault servicing, the cause of
the fault, or a CPU defect. An original-TR candidate at step 1820 lacks saved
continuation and handler-context agreement. No owned frame return, completed
DPMI service, broader OS/application result, physical placement, calibrated
RTx or speedup is qualified.

Next, a separately named immutable full-tape prefix audit may describe the
observed repeated sequence without changing this exact-two result. A distinct
source-owned fault-outcome diagnostic would be needed before claiming how the
step-1859 fault was handled. Preserve the original and strict failure.
