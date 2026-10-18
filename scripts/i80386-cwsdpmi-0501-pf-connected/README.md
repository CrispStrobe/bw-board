# Owned AX=0501 PF outcome AT diagnostic

This separate, opt-in gate uses the unchanged fresh high-memory client build,
free AT ROMs, FreeDOS input, owned media, and the source-bound task-mode
controller. It is a bounded follow-up to the strict AX=0501 frame refusal. The
existing strict frame remains invalid with no return credit, and the finite
client remains incomplete. The PF outcome recorder describes one source-owned
page-fault capture and the call outcome of `_deliverFault`; it does not prove
that the fault was serviced, that the guest returned to the handler, or that
DPMI or a broader operating system works.

The derivative controller pauses after the original strict refusal, before any
task-mode continuation step. It admits the same private task-mode token and
copied strict entry, arms the separate PF recorder, and refuses continuation if
arming or the progress boundary fails. A source-owned step facade calls the
real machine once and observes the recorder's attempted-step count before and
after each call. A board call with no CPU attempt, a multiple-attempt call, or
an observer error stops the diagnostic. Mode committed-step counts and the
final uncommitted PF row are checked separately; a faulting step is not counted
as a committed mode step. The PF receipt is drained only after the existing
terminal stop, without an additional guest step. Partial failures remain
bounded and are reported without changing the first strict refusal.

`adapter.mjs input.json pf-connected.json progress.json` is the source-owned
entry. `grade.mjs` produces a separate source-consistency verdict inside the
retained report; a positive verdict is narrower than frame or PF-service
qualification. The labeled workflow uploads only a closed, bounded inventory
of JSON, text, hashes, and required notices. It excludes executable, guest
media, RAM, TSS and raw code bytes. This checkpoint is source-only until a
reviewed hosted run and independent original-artifact audit establish its
observed boundary.
