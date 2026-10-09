# Owned DPMI task excursion: next bounded gate

Status: a task-switch destination was observed, but the owned INT 31h frame
has **not** returned. This is a proposed, separately named diagnostic and
qualification lane. It changes no existing journal acceptance rule.

The [first task-attempt result](https://github.com/CrispStrobe/bw-board/actions/runs/37893093332)
recorded a `jmp` attempt from task selector `0x60` to `0x70` while the owned
AX=0501h frame was open. The [task-outcome run](https://github.com/CrispStrobe/bw-board/actions/runs/37897547815)
at reviewed source [`15afcd6b`](https://github.com/CrispStrobe/bw-board/commit/15afcd6ba9dd1b494c343c6af6307bcf324b0ebd)
retained the same first failure, `task-switch-during-owned-frame`. Its
source-owned `_taskSwitchCore` returned normally and left CS:EIP at
`0x18:0x3ee9`, CPL 0, TR `0x70`, VM86 and NT clear. The journal's committed
INT 31h entry remains present; its return is `null`, and the finite client
did not complete. A normal local core return establishes neither resumption
of the original task nor an IRET from the owned handler. Both original runs
remain failed evidence.

## First slice: observe the excursion without accepting it

Use an isolated source branch and a distinct opt-in diagnostic profile. Keep
the current journal's first refusal and `returned:null` unchanged. At the
already authenticated same-machine main and wrapper cut, require the exact
client, map, media, ROM and source roles, the privately compared wrapper
bytes, unchanged before/after observer fingerprints and a committed owned
software INT 31h entry. Do not arm from a caller-supplied CPU snapshot or
from the public layout object's mutable role list.

Mint a private, one-shot CPU/session cookie when the entry commits. Bind it to
the machine, source instruction and return CS:EIP, handler CS:SS:ESP, the
CPU-consumed linear 12-byte frame role, original TR selector/type/base/limit,
and CR3. Retain the original frame bytes and source-owned descriptor context
under a fixed cap. This is a linear-frame continuity contract; it does not
prove unchanged physical backing or page-table mappings over the excursion.
Any stale token, altered admission identity or second arm fails closed.

For the first diagnostic, capture the already observed outgoing `jmp` and
then continue **ordinary machine steps** only under a separate bound: at most
100,000 subsequent steps, 16 task-transition records and 32 interrupt or
fault records. Record attempted selector/kind/source context, original-core
result or exception, and post-step committed CS:EIP/CPL/VM86/NT/TR/CR3 for
each transition. Distinguish a task-switch attempt, a normal `_taskSwitchCore`
return, recognized faults with or without the core's own `taskCommitted`
marker, and an enclosing instruction that actually commits. An absent marker
does not prove that earlier task-state writes were absent. A local core return alone cannot advance the accepted
frame phase. Retain partial records and the first failure if a bound, fault,
reentry, reset, unsupported mode or observer error stops the run. Keep raw
RAM, TSS images, executable and disk bytes out of the report artifact.

Do not prescribe the return mechanism yet. The source has far transfer and
NT-IRET task-switch paths; the observed outgoing path is `jmp`, but no
return path has been observed. This diagnostic must show the next transition
kind and target, any intervening IRQ/fault, and whether execution returns to
the original TR and owned handler context. An unmatched transition, missing
return, or exhausted bound remains a diagnostic failure, never an inferred
owned IRET. The disabled profile adds no per-step records and preserves
ordinary CPU behavior.

## Later qualification, only after the return path is observed

Define a second, explicit owner profile from the first diagnostic's retained
source-committed events. Its preflight must bind the original task/frame
cookie and every permitted transition. Stage each transition before the
original CPU operation, credit it only after the original enclosing step
commits, and discard it on rollback, exception, trace or reentry. Reject
unexpected task selectors, task nesting, mode changes and unaccounted IRQs
or faults; cap the full sequence and retain the first mismatch. Compare
original TR and handler context on resumption, then require the CPU's actual
matching IRET event to consume the same linear frame role with source-owned
return CS:EIP, flags and selector continuity. Report every admitted event and
its step so an independent reader can check ordering and the still separate
finite client result.

Passing such a gate would qualify this one owned AX=0501h transaction in the
free, pinned AT fixture with its separately identified QEMU control. It would not establish arbitrary task switching,
all INT 31h calls, physical frame stability, a complete 386DX machine,
general applications, games or performance. Source-only and synthetic controls cannot
replace one exact-head hosted guest run with an independently audited original
packet.

## CPU architecture checkpoint published; driver still unconnected

[Draft PR472](https://github.com/CrispStrobe/bw-board/pull/472) at
`d1ca2763ce30dc91df0c29e888590ab1d8135256`, stacked on PR470, contains only
the CPU observer and focused journal controls. Root and a separate Sol reviewer
checked source and syntax. The original [hosted xv6 regression](receipts/2026-10-09-task-excursion-cpu/README.md)
passed the focused CPU controls and three finite scenarios. There
is no runnable excursion driver, source-admission packet or actual return
receipt at this checkpoint. The original frame refusal is unchanged.

The separate private session binds a committed entry once, stages task facts
and credits them only after the ordinary enclosing step succeeds. Candidate
resumption compares saved outgoing continuation and descriptor scalar roles,
allowing only the descriptor Accessed-bit difference on reload. It preserves
original results and faults, refuses accessor/reentry observations, and caps
steps and records. A later step or reset makes an unconsumed candidate stale
while retaining historical facts. This is an observation candidate, never
an accepted owned frame return.

The hosted CPU prerequisite passed; implement the separate driver and
admission/workflow slice, then qualify its new exact source. The inherited frame policy hides its token and stops
on the first strict refusal; wrapping its exported runner is insufficient.
Use a reviewed derivative with unchanged media/machine/owned-wrapper admission,
arm against its private committed entry, retain the old terminal frame report,
and continue only bounded ordinary machine steps for this diagnostic. Retain
the candidate-reset control gap as a focused test follow-up; do not infer real
task continuity from the synthetic two-switch control. Qualify a new exact
source head and independently audit its first original guest packet before
proposing any later task-aware ownership acceptance.


## Derivative diagnostic source checkpoint published

[Draft PR474](https://github.com/CrispStrobe/bw-board/pull/474) at
`89eadb8c2449ff769b157ee6a4b78ccb833c3610`, stacked on PR472, publishes
the separate adapter, driver, private orchestration, source admission, closed
inventory and dedicated workflow under
`scripts/i80386-cwsdpmi-0501-task-excursion/`. Its 12-path change also adds
the narrow CPU diagnostic-abort method and focused journal controls, including
the missing candidate-reset case. Root and a separate Sol reviewer checked
source, syntax and pure mock controls; source admission binds 205 Git roles
and 64 JavaScript modules. All 12 enabled exact-head checks passed, with
only the two declared `vectors-full` skips. The dedicated label was then
applied once; [original run37907258126](https://github.com/CrispStrobe/bw-board/actions/runs/37907258126)
completed with official failure. The [original result](receipts/2026-10-09-task-excursion-at/README.md)
records two committed task transfers, then the protected-only observer
refuses after PE clears; it records no original-task resume candidate.

The driver retains the original strict frame refusal and partial finite-client
report. Before any continuation step it requires a source-committed outgoing
task record, then continues the same machine under the 100,000-call and
120-second limits. Bounds, exceptions and callback reentry close only the
private diagnostic recorder and retain its partial facts. The abort method
does not reset the guest or change the strict frame. Candidates remain
diagnostic observations; `frameReturnQualified` remains false.

The original packet and its first failure are preserved; do not remove/reapply
its label or launch a second actual at this source. The strict frame remains
invalid with `returned:null`, and `frameReturnQualified` remains false. The
final machine is not shut down; this report establishes the observer's mode
boundary, without identifying the exact PE-clearing instruction or proving a
guest CPU fault.

Next implement a **separately named bounded mode-crossing diagnostic** in an
isolated source lane. Keep this protected-only profile and the original strict
owner unchanged. Record committed before/after mode facts across PE and VM86
changes, including CR0, flags, effective mode/CPL, CS context, task identity
and the explicit CPU operation/source hook that attributes the change;
retain separately any uncommitted attempt. Refuse unattributed mode changes
rather than infer an instruction from the final CR0 value. Preserve owner/reentry/exception,
transition/delivery/output and step/wall bounds. A candidate must still match
the original task, saved continuation and protected handler context; real mode
or VM86 alone cannot qualify it. Review adversarial controls and affected hosted
CPU/xv6 regressions before one separately labeled original diagnostic. That
original, independently audited result is the next gate before any later
ownership profile or application-completion claim.


## Separate mode-recorder CPU source checkpoint

[Draft PR476](https://github.com/CrispStrobe/bw-board/pull/476), source
`e8bed46bd472a9307ba16a0fac48a710fa6f24fa`, stacked on PR474,
publishes exactly three paths: the CPU, its existing journal test and
`scripts/i80386-cwsdpmi-0501-task-mode/README.md`. Root and a separate Sol
reviewer passed source/syntax review. The journal now contains 85 authored
named cases: 71 inherited and 14 new. **Hosted CPU/xv6 checks are pending;
this recorder has no connected guest driver or actual qualification.**

The distinct `armOwned0501TaskMode`, `owned0501TaskModeStatus`,
`abortOwned0501TaskMode` and `takeOwned0501TaskModeObservation` APIs use private
admission and a separate report schema. The new recorder credits mode facts
only with a committing decoded MOV CR0 ticket or co-occurring task-core return.
It validates bounded primitives, copied descriptor roles and final admission
reentry after reflection. Absent protected descriptor fields in a VM86-shaped
cache are explicit nulls; unattributed changes still refuse. It records
`postOutgoingSteps`, preserves uncommitted fault facts, and always reports
`frameReturnQualified:false`. The old protected-only observer remains intact.

Refresh PR476's exact head and every enabled check first. Once affected CPU and
finite xv6 regressions pass and their originals are independently audited,
implement a separately named adapter/driver/source admission/closed inventory
and hosted workflow using these new APIs. Bind the unchanged owned client,
wrapper, compiler, BIOS/VGA, FreeDOS/CWSDPMI and media inputs. Retain the original
strict frame report, then use ordinary steps under the existing wall/step caps;
do not substitute a CPU callback or widen frame acceptance. After source review
and all enabled checks pass, launch one distinct labeled actual and audit its
first original, including committed mode attribution, task transitions,
uncommitted refusals and any original-task protected-handler candidate. A later
CS reload or other unhooked operation remains an explicit refusal boundary.
