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

A separate retained-original audit now checks the full bounded mode tape as
**source-record consistency only**; [prefix-consistency.json](prefix-consistency.json)
records its original bindings and five triplets. The CR0-clear/enable/far steps
are 47/442/443, 563/886/887, 995/1183/1184, 1294/1487/1488 and
1596/1780/1781. Each enable post-context equals the immediately next far
pre-context in full recorded fields; the preceding task/control context agrees,
with no recorded task transfer inside the triplet. All fifteen task rows have
typed committed steps and selector/post-TR agreement; only the first two have
the separately checked outgoing source-chain predicate. This is not an
independent instruction oracle or qualification of every task return.

The separate reader passed root and independent source review and one positive
plus sixteen negative CPU-free controls before reading the retained original.
Root and independent retained-original audits agree on the five triplets and
preserved failure boundary. The original failed conclusion, frozen exact-two refusal, strict false/null
frame result and later step-1859 fault remain unchanged. Next, qualify the
[separate recorder source](https://github.com/CrispStrobe/bw-board/pull/486),
then connect it through a separately reviewed driver/admission/workflow to
observe fault-time, pre-delivery and post-delivery facts. Returned delivery
alone will not prove handler execution, fault service or a completed frame.
