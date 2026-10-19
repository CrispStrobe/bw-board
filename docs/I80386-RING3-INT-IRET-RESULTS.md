# Ring-changing INT/IRETD qualification status

[Draft PR645](https://github.com/CrispStrobe/bw-board/pull/645) is a source
checkpoint. No hosted guest execution or QEMU comparison has qualified this
fixture. Its actual command remains closed.

The MIT-authored reset ROM tests one 32-bit software INT80 from CPL3 through a
CPL0 interrupt gate and TSS stack, followed by IRETD back to the original user
stack. The ordinary JavaScript CPU uses `strict386`; the planned independent
QEMU control uses `pc`/`486` TCG as a compatibility oracle for these instructions.
Neither this fixture nor that comparison establishes a complete 386DX.

The source includes deterministic ROM construction, independently frozen
register/frame/RAM expectations, a standalone original-only reader, bounded
process helpers, runtime-discovery functions and manufactured controls. The
[source guide](../scripts/i80386-ring3-int-iret/README.md) documents the controls
and their current boundaries. Passing these controls establishes no actual
privilege transition, resource cleanup or runtime identity result.

## Remaining qualification work

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
