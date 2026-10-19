# Post-PF CPU continuation prerequisite

This source-only prerequisite adds an optional CPU observer. It is not connected
to a guest driver or qualified by execution. The authored controls have not
been run locally. Hosted CPU and xv6 regressions, review and all enabled checks
must qualify the exact source before any separately admitted connection.

First request `postPfHandoff:true` as an own data boolean when arming the PF
recorder from an observing task-mode session. The absent or false flag keeps
the existing PF profile free of new terminal snapshots.

Call `armOwned0501PostPfContinuation(pfToken, taskModeToken, {maxActiveSteps})`
while both source-owned tokens remain retained, immediately after returned,
nonshutdown PF delivery. Admission binds the original committed task cookie,
outgoing continuation, unique uncommitted PF and internally captured terminal
CPU context and exact callback/cache identities. A report or caller snapshot cannot supply authority. Capture occurs
at the end of the original CPU step cleanup, with repeated validation and
reentry guards. Draining either historical token first refuses admission.
After a successful one-shot handoff, those observations may drain unchanged.

The new private session preserves the old strict task-switch refusal and null
frame return. Its events distinguish ordinary instruction commit, uncommitted
attempts, and source interrupt boundary returns. The original outgoing event is
reference history and contributes no new transition or step. A candidate must
match original TR/CR3, saved continuation and handler descriptor context. Even
a candidate reports `frameReturnQualified:false`; no frame ownership acceptance,
fault service, repair, retry, client completion or performance follows.

Bounds are 100,000 ordinary attempts, 16 task transitions, 32 deliveries,
32 mode changes and 64 decoded CS/IRET-intent or interrupt records.
A decoded IRET intent is not proof of the public core body returning or frame
consumption, and cannot authorize a mode change. Generic event presence or a
delivery array also cannot authorize a mode change. Matching IRET core facts
and any additional mode/delivery authority remain later source work. The later adapter
must bind its own same-machine identity and counters. The later driver must
limit execution to 120 seconds. This CPU slice captures closed CPU scalars and
cached descriptor roles only: no RAM, TSS, media or handler bytes, device state,
or full machine snapshot. The profile is off by default and adds no off-profile
context snapshots. It preserves ordinary results and exceptions.

Only the CPU, focused new controls and this new README belong to this source
slice. No connected driver, workflow, source admission, artifact inventory or
prospective original reader is implemented here. The earlier failed originals
remain unchanged and must not be rerun or relabeled.
