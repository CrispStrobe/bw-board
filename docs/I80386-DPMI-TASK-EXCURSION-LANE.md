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
named cases: 71 inherited and 14 new. The first hosted CPU/xv6 checks failed on a descriptor-mutation fixture before
xv6 acquisition/build/guest. The [preserved original failure](receipts/2026-10-09-task-mode-cpu-failure/README.md)
records the out-of-range increment and test-only correction
`44087e8f1d19b1f74c6f2742ebca31594f6e7208`. CPU source is unchanged.
The [corrected original hosted CPU/xv6 result](receipts/2026-10-09-task-mode-cpu-success/README.md)
passes root and independent audit: 114 focused controls and three finite xv6
scenarios, with executed/reviewed tree equality. All twelve enabled exact-head checks passed, with only the two declared
optional `vectors-full` skips. The connected diagnostic and its limited original result are recorded below;
this does not qualify an owned-frame return.

The distinct `armOwned0501TaskMode`, `owned0501TaskModeStatus`,
`abortOwned0501TaskMode` and `takeOwned0501TaskModeObservation` APIs use private
admission and a separate report schema. The new recorder credits mode facts
only with a committing decoded MOV CR0 ticket or co-occurring task-core return.
It validates bounded primitives, copied descriptor roles and final admission
reentry after reflection. Absent protected descriptor fields in a VM86-shaped
cache are explicit nulls; unattributed changes still refuse. It records
`postOutgoingSteps`, preserves uncommitted fault facts, and always reports
`frameReturnQualified:false`. The old protected-only observer remains intact.

PR476's corrected `44087e8f1d19b1f74c6f2742ebca31594f6e7208`
head passed every enabled check and independently audited CPU/finite xv6
regressions. The separate adapter/driver/source admission/closed inventory
and hosted workflow checkpoint below uses these new APIs. Bind the unchanged owned client,
wrapper, compiler, BIOS/VGA, FreeDOS/CWSDPMI and media inputs. Retain the original
strict frame report, then use ordinary steps under the existing wall/step caps;
do not substitute a CPU callback or widen frame acceptance. After source review
and all enabled checks pass, launch one distinct labeled actual and audit its
first original, including committed mode attribution, task transitions,
uncommitted refusals and any original-task protected-handler candidate. A later
CS reload or other unhooked operation remains an explicit refusal boundary.


## Separate task-mode AT diagnostic source checkpoint

[Draft PR478](https://github.com/CrispStrobe/bw-board/pull/478), reviewed head
`f2fb33f921bf99b23d1e88ee889512d5d4ee6318`, publishes nine files under
`scripts/i80386-cwsdpmi-0501-task-mode-at/` and
`.github/workflows/i80386-cwsdpmi-0501-task-mode.yml`, stacked on PR476.
Root and an independent reviewer verified the ten-path delta, 215 source roles
and 64-node recursive import graph. CPU and inherited PR474 implementation,
compiler/media/helper pins and strict frame rules remain unchanged. Source,
inventory and CPU-free controller/input-admission controls passed.
All ten enabled exact-head checks passed, with only the two declared optional
skips, before the independently audited original below.

The derivative adapter arms the new mode API after committed strict entry,
requires the original task-switch refusal and outgoing transition before
continuing, and retains `passed:false`, strict `returned:null` and
`frameReturnQualified:false`. The one-shot controller permits at most 100,000
ordinary machine-step calls and 120 seconds. Preflight or initial-clock
refusal stops locally even if CPU abort throws or returns observing. Terminal
records are drained where possible, while status/abort/take/progress failures
remain visible. Progress mode counts are distinct from full terminal mode
records; a killed process does not establish complete history. Pure controls
cover zero-extra-step refusals, callback reentry, bounds, failed drains, and
FIFO/symlink/inode/size input races without importing the emulator.

The single [original run37938657230](receipts/2026-10-09-task-mode-at/README.md)
completed with preserved strict refusal. Root and independent audits agree on
two task transfers and two source-attributed MOV CR0 changes: PE cleared, then
was set again with retained real-mode CS context. The next committed CS reload
has no operation ticket and refuses `unattributed-mode-change` at active step
443. The packet records no original-task resume candidate. Its official failure
and finite observer boundary do not identify a CPU fault or terminal opcode.

The separately reviewed bounded CS-transfer attribution slice defined in
that receipt is implemented in the source checkpoint below. Explicit decode tickets must match source-owned
before/after context and a committed direct non-call code-descriptor transfer.
Gate/task/call/return and competing or uncommitted paths stay refused. Keep
strict frame rules and the protected-only observer unchanged; run affected
hosted CPU/xv6 controls before a separately named connected diagnostic and one
new original. Preserve all earlier results without relabeling or replay. No
IRET, original frame return, physical placement or broader application
compatibility is qualified here.


## Separate direct CS-reload attribution source checkpoint

[Draft PR480](https://github.com/CrispStrobe/bw-board/pull/480), reviewed source
`33a8f62a8ac3613007e80f2f3ee066d6ea987edf`, is stacked on frozen PR478.
Exactly three paths change: `src/experimental/i80386.js`, the existing journal
test, and `scripts/i80386-cwsdpmi-0501-far-attribution/README.md`. Root and
independent source/syntax review passed. The journal has 102 authored named
cases, including 17 new controls; these CPU controls have not run locally.
The [first automatic hosted failure](receipts/2026-10-09-far-attribution-cpu-failure/README.md)
records 16 fixture-setup refusals at CPL3 before xv6 build or boot. The
test-only correction `6191a70650142ea46552c2d417eb7eb62aa08e38`
establishes explicit synthetic ring-0 task context before MOV CR0 and fixes
a code16 competing jump. Production CPU bytes are unchanged. The [first corrected original CPU/xv6 run](receipts/2026-10-09-far-attribution-cpu-success/README.md)
passes root and independent audit: 131 focused controls, three finite
compatibility-profile xv6 scenarios and 71 Git roles. All twelve enabled exact-head checks passed, with only the two declared
optional skips, before the separate connection source was opened.

Only the active mode profile enters private direct-transfer and group-5
decoder paths. Public helper wrappers cannot expose or replay the private
source marker; off-profile execution keeps the existing public dispatch.
Source-issued tickets identify actual immediate `EA` or indirect `FF /5`
non-call code-descriptor commits. The recorder requires copied post-context
agreement, retained-CS exit, unchanged CR0/flags/TR/CR3/stack, and a committed
enclosing step. Competing, reentrant, uncommitted and unrelated changes remain
refused. The controls cover both operand widths, public capture/replay/helper
paths, precommit faults, competing transfers, mutation and disabled behavior.
Initial source-review defects in marker exposure and target-fixture privilege
were corrected before publication; syntax review is not control execution.

Keep the original strict frame and protected-only observer unchanged. The CPU prerequisite checks and original audit have passed. Use a separately
named adapter/workflow/source-inventory profile to connect these tickets. The existing frozen PR478 admission is not a runner
for this changed CPU source. Review that new connection and all enabled checks
before one distinct guest actual. Do not infer the opcode of the old refused
step or claim frame return, compatibility, adoption or speedup from this
bounded CPU controls.


## Separate connected far-reload attribution source

[Draft PR483](https://github.com/CrispStrobe/bw-board/pull/483), reviewed source
`72d0b32e8bd7d658447745129119e2300ad6bec1`, adds eight new paths in
`scripts/i80386-cwsdpmi-0501-far-at/` and its dedicated workflow, stacked on
frozen PR480. Root and independent source/syntax/workflow/inventory review and
three CPU-free control suites passed. Its new admission derives 224 source
roles / 64 recursive JS nodes and binds the reviewed CPU/test/README while
retaining the old guest runner, media, helpers and strict frame rules.

The separately run grader reads retained `task-mode.json` without replaying
instructions. It requires exactly two committed task JMPs bound to the original
AX=0501 entry/cookie and full task-context chain, then decoded MOV CR0 PE clear
and set followed by a source-issued EA or FF /5 reload in the immediately next
step, with the full predecessor post-context equal to the far ticket's before
context. Typed mode/cache facts, selector/width/target and TR/CR3/stack continuity
must agree. Missing, uncommitted, duplicate, reordered or inconsistent records
refuse; the original report and first failure remain visible. The separate
`attributionQualified` predicate is report consistency only. Strict `passed`
and `frameReturnQualified` stay false, with a null frame return.

All ten enabled exact-head checks passed, with only the two declared optional
skips, before the single [connected far-reload original](receipts/2026-10-09-far-attribution-at-failure/README.md)
at reviewed source `72d0b32e8bd7d658447745129119e2300ad6bec1`.
Root and independent retained-original audits passed within its official
**failure** boundary: 119 closed members, 224 source roles and 64 JS nodes.
The frozen exact-two grader returns `UNQUALIFIED_ATTRIBUTION_REFUSED` because
the bounded original contains 15 committed task transfers and 15 committed
mode changes. Source-issued MOV CR0 tickets at steps 47 and 442 followed by
an EA ticket at step 443 form an observed prefix; five EA tickets appear in
the full tape. This is not whole-tape qualification, and the grader remains
unchanged. Strict frame failure `task-switch-during-owned-frame`, null return
and `frameReturnQualified:false` remain.

The observer's first later refusal is `step-failure`. A step-1859 CPU fault
fact reports vector 14 and error-code presence, without an error-code value
or committed enclosing step. The original does not establish fault servicing,
its cause or a CPU defect. A step-1820 original-TR candidate lacks saved
continuation and handler-context agreement. The separate
[retained full-tape prefix audit](receipts/2026-10-09-far-attribution-at-failure/README.md)
now confirms five source-record-consistent triplets, with the original failure
and exact-two refusal intact; it does not qualify the whole task-return chain.
Next, a distinct source-owned fault-outcome diagnostic can establish what
happened during the fault-delivery attempt. Neither audit nor diagnostic may
relax this frozen exact-two result or strict frame
guard. Do not reuse frozen PR478 for the changed CPU or infer its old refused
opcode. No completed DPMI frame, broader OS/application result, speedup or
adoption follows.


## Separate page-fault delivery outcome source

[Draft PR486](https://github.com/CrispStrobe/bw-board/pull/486), reviewed source
`33d53542aa4375f9eb4c3c508ecf9bc8b1bba0d9`, is stacked on frozen PR483.
It changes only the experimental CPU,
`test/i80386-0501-fault-outcome.test.mjs`, and the new diagnostic
`scripts/i80386-cwsdpmi-0501-pf-outcome/README.md`. The separate default-off
recorder copies numeric fault/context facts, the actual rollback choice, and
whether delivery returned, threw or was disabled. Post-context includes
shutdown. Returned delivery alone is not fault service or a completed frame.

Root and independent static review passed after correcting absent-marker
normalization, falsey throws, method/argument evaluation order and noncallable
setup credit. The [original hosted CPU/xv6 qualification](receipts/2026-10-09-pf-outcome-cpu/README.md)
passed all twenty new tests, 131 related focused controls and three finite
free xv6 scenarios. Root and independent original-packet audits passed.
All twelve enabled exact-head checks passed, with only the two declared
optional `vectors-full` skips. No CPU or guest test was executed locally.
The default-off delivery expression and the strict frame guard stay unchanged;
the opt-in malformed noncallable-hook TypeError wording limit is documented.

The prerequisite is qualified; implement a separately named driver, source
admission and workflow that bind this CPU/session to the owned client,
entry and same-machine execution. The inherited driver continues before its
exported function returns: add an explicit fail-closed arm-result gate between
the strict terminal refusal and task-mode continuation. A throwing progress
callback alone cannot prevent that continuation. Bind the opaque recorder to
the trusted admitted wrapper, committed entry and exact CPU/machine/session.
Capture mode counters and continuation-call counters at arm; PF attempted
steps include the faulting call, whereas mode committed steps exclude it.
Drain after the existing terminal step, without an extra guest step or reset.
Discard a partial session with its fresh machine rather than reusing it. Preserve the earlier original failure and
strict frame refusal; retain numeric fault-time, pre-delivery and post-delivery facts without
RAM, TSS or handler inspection. Review the prospective result reader and
closed artifact inventory before one connected actual. Do not run the frozen
PR483 workflow against this changed CPU or claim a completed DPMI frame from
the unconnected source checkpoint.


The separate connection is now [draft PR487](https://github.com/CrispStrobe/bw-board/pull/487)
at reviewed `6c342303f619035b5037426cef335d059628e3dc`: twelve new paths,
238 source roles and 71 recursive JavaScript nodes, with inherited CPU, media,
client and runner bytes unchanged. Coordinator and independent source reviews
passed. Python source/inventory controls and static workflow checks passed;
JavaScript mock controls are authored and reviewed but were not run locally.
The review added fault-time/pre-delivery CR0/CR2/CR3 joins and retained snapshot
refusal as a secondary diagnostic without replacing the first strict failure.
A subsequent grading correction rejects a disabled delivery as a positive
PF-call result while retaining its complete recorder facts and original strict
failure. The standalone prospective reader passed coordinator and independent
review with five positive and 47 negative synthetic cases. The one-shot launch
guard also passed both reviews; it rejects any earlier dedicated run on this
branch, changed source or reader, an existing label and incomplete checks.
At that source checkpoint, the dedicated workflow had produced no diagnostic
evidence. All ten enabled exact-head checks were required, with only the two
declared optional skips, before the label could be applied once.
All ten enabled exact-head checks subsequently passed, with only the two
declared optional skips. The label was applied once. The [original connected
run38023601004](receipts/2026-10-10-pf-connected-control-failure/README.md)
failed in the PF orchestration mock controls before guest execution. Both
retained-original audits pass within that refusal boundary; no PF report or
frame-return qualification exists. The next step is a separately named hosted
mock-only gate that arms valid fixtures before introducing transition loss or
contradiction. Keep production admission unchanged and preserve the original.
A further connected guest attempt needs a new admitted source/workflow profile
and prospective audit, rather than rerunning or relabeling this attempt.

The separately named [draft PR492 connected profile](https://github.com/CrispStrobe/bw-board/pull/492)
is published at `e321e000e6a6bc44e626bbef119febbcac27e73d`: four new files,
243 Git roles and the same 71-node import graph. Git-only source admission
reconstructs the original 238-role receipt and its exact hash, accepts only
the reviewed mock correction, and leaves all other CPU/driver/adapter/media
bytes unchanged. Coordinator and independent source review, Python controls
and full live/Git/hash admission pass. The corrected mocks separately passed
hosted run38024107151 and two original audits. The standalone prospective
reader passed both reviews and five positive / 57 negative synthetic cases.
The one-shot guard also passed both reviews and binds the exact prior mock
audit receipts. All enabled exact-head checks must pass before its distinct
label is applied once.
No connected guest has run under this new profile.
