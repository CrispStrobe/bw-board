# Ring-changing INT/IRETD qualification status

**Source status — 2026-10-26:** [PR645](https://github.com/CrispStrobe/bw-board/pull/645)
merged as `b51be2c62ee57214350bd00db667c147a25748f3`; the source and inactive
same-job V3 cleanup route are on the default branch. The V2 actual failure below
remains refused. No passing guest/QEMU comparison or whole-386 qualification
follows from the source merge; V3 execution remains disabled.

The MIT-authored reset ROM tests one 32-bit software INT80 from CPL3 through a
CPL0 interrupt gate and TSS stack, followed by IRETD back to the original user
stack. The ordinary JavaScript CPU uses `strict386`; the independent
QEMU control uses `pc`/`486` TCG as a compatibility oracle for these instructions.
Neither this fixture nor that comparison establishes a complete 386DX.

The source includes deterministic ROM construction, independently frozen
register/frame/RAM expectations, a standalone original-only reader, bounded
process helpers, runtime-discovery functions and manufactured controls. The
[source guide](../scripts/i80386-ring3-int-iret/README.md) documents the controls
and their current boundaries. Passing these controls establishes no actual
privilege transition, resource cleanup or runtime identity result.

## Remaining qualification work

The list below is the historical source plan, before the selected V2 result.
The current next steps follow that retained result at the end of this page.

1. Finish and independently review the dedicated controller entry and outside
   owner. Establish child wait ownership before any probe, retain the finite
   controller and child limits, and clean every owned group after success or
   failure. Polling alone cannot bound process creation or an identity read.
2. Connect the frozen JavaScript launch descriptor and QEMU argument list. Run
   two fresh guest children serially, retain raw outputs and partial failures,
   then obtain the terminal resource census after the controller exits.
3. Complete bounded packet finalization and the hosted actual job. Preserve
   the closed twenty-role packet, existing independent reader predicates,
   original runtime observations and source readbacks. The source-only CI job
   does not execute this path.
4. Freeze the complete source/input/runtime plan and review every enabled
   check on the final head. Confirm current mergeability and admit one distinct
   hosted event. Acquire its official originals once, then audit them with
   independent readers before considering a merge.

The fixed envelope is one logical CPU, 1 GiB RAM, zero swap and 64 PIDs per
owned group; guest children have 120-second limits and 128 KiB per output
stream. The controller has 600 seconds and the hosted job 15 minutes. These
are requirements awaiting actual qualification, not measured sufficiency.

Hardware IRQs, paging, task switching, general DPMI, complete operating systems,
applications, physical timing and performance remain outside this fixture's claim.
Product repairs
need their own reviewed ownership scope. Preserve every original failure and
keep raw evidence outside public documentation.

## V9 metadata checkpoint and proposed actual route

The V9 metadata [run](https://github.com/CrispStrobe/bw-board/actions/runs/40111138937)
completed. Its retained originals passed a standalone installed-state, Node
and QEMU graph audit. A separate comparison admitted the graph digest and
selected static DATA facts as inputs for a future same-job check; the original
`candidateReviewed=false` was not changed. The run executed no authored guest.

A new [claim](../LANES.md) proposes one job with fixed setup and an
independent same-job graph comparison before the authored JavaScript and QEMU
oracle. It remains claim-only: no new actual source, event or guest result
exists. The older fifteen-minute controller envelope above is a historical
source checkpoint; the proposed combined job is bounded at 35 minutes and a
32 MiB artifact without enlarging the controller's 600-second or any other
old leaf limit. A later result must be tied to a distinct actual event and
independently audited originals.

## Inactive same-job source checkpoint — 2026-10-24

The claim merged. A source candidate now contains the distinct two-service
actual route and independent readers. Its connected pure controls use
manufactured OS and guest outputs to check setup handoff, serial controller,
the twenty-role finalizer and local packet admission. This is source-only
evidence: no same-job actual event, hosted guest, official original or
architectural result exists. The actual and compiler guards remain false.

## Selectable same-job source checkpoint — 2026-10-24

The distinct same-job source, reader and workflow guards are now enabled
behind an owned, explicit label and canonical request. This is a source
checkpoint only: the label is unselected, the exact-head hosted checks are
pending, and no same-job guest has run. Historical actual and compiler guards
remain false. The manufactured controls and source review do not establish
an official run or architectural result.

## V1 failed setup and selectable V2 actual candidate — 2026-10-24

The selected [V1 run](https://github.com/CrispStrobe/bw-board/actions/runs/40121786243) failed after the reaped unpack phase because its first cgroup census retained an additional, unidentified direct member. Configure, Node staging and guest execution did not follow. Its label is spent and its originals remain held.

The new V2 source candidate records a bounded sequence of post-reap cgroup samples while keeping final acceptance controller-only with no nested or dying descendants. Mocked controls connect its independent first-service handoff to the second service, twenty-role packet and offline official reader. Those controls do not prove a hosted setup or guest result. The V2 source and workflow guards are enabled, but no V2 event has been selected; exact-head qualification and external one-shot admission remain pending.
## Selected same-job V2 result and proposed V3 cleanup

The selected [V2 actual run](https://github.com/CrispStrobe/bw-board/actions/runs/40130461323)
failed. Its retained first service completed the fixed setup, and both authored
guest children ran. The second service composed its packet, but outside cleanup
found the selected systemd unit absent and the separately owned manual cgroup
root still present; its original does not establish a PID identity there. The
JavaScript and QEMU defined outputs also disagree at two selected GDT
access-byte positions. The positive reader continues to refuse. No actual
architectural pass, strict 386DX, physical timing or release result is claimed.

The [V3 claim](../LANES.md) proposes a new, separately admitted same-job route
with exact four-role manual-cgroup census and bounded descriptor-relative
cleanup, plus an optional negative-only audit of the V2 failure. It does not
change the fixture, expected bytes, CPU model, QEMU output or the V2 reader's
refusal. The V3 implementation has landed with execution disabled. Its mocked
cleanup and guest controls are source evidence; no V3 event has been selected.

Next establish the exact reference-emulator source/build provenance and review
the two descriptor-access-bit differences against the architecture. Preserve the
original expected bytes and V2 refusal until that review justifies a separately
scoped correction. Qualify the existing V3 cleanup and affected guest route with
fresh exact-head checks and an independently admitted event, rather than
recreating its source. Clean cleanup alone would not resolve the observed
JavaScript/QEMU disagreement. The comparison and outside-cleanup refusals
remain independent, and a source control pass settles neither.
