# Proposed AX=0501 task mode-crossing diagnostic

This is a separate, opt-in diagnostic profile for the owned AX=0501 AT gate.
It is not an extension of the strict frame journal's acceptance rule. The
original committed entry and `task-switch-during-owned-frame` refusal remain
visible, with `returned: null`, `frameReturnQualified: false`, and top-level
`passed: false` even if this diagnostic later sees an original-task candidate.
No guest run has qualified this profile.

The controller may arm only with its private token for the committed, mixed
profile INT 31h entry, while the CPU is paused between ordinary machine steps.
The new CPU API should have its own name and mint a distinct private session
and report schema. The old protected-only task-excursion API and receipts stay
unchanged. It must retain the same one-entry, 100,000-step, 16-transition and
32-delivery bounds, plus at most 32 mode-change records. Observer abort, reset,
reentry, exceptions and wrong-token calls fail closed without changing a guest
result or the original frame journal. A source-owned callback must never be
used in place of the ordinary `machine.step()` path.

For each ordinary CPU instruction, the enabled recorder captures bounded
primitive mode facts before the instruction and settles them only after the
original step's outcome. A `decoded-mov-cr0` source ticket is minted only in
the decoded `0F 22 /r` CR0-write path and carries the instruction start and
before/after CR0 values. A task-core-return ticket names a co-occurring
source-owned operation; it does not prove an otherwise unseen write. A mode
change with neither ticket is refused as unattributed. The earlier actual
packet did not record either operation at its PE-clear boundary, so source
inspection alone does not retrospectively prove which instruction ran there.
This first slice does not hook every possible retained-real-CS or VM86 change;
for example, a later PE-enable and CS reload without a source ticket refuses
rather than acquiring credit from a before/after difference.
The receipt separates committed CPU-step mode changes
from a zero-return, trace or thrown-step refusal; the latter makes no rollback
or no-side-effects claim. A mode fact includes CR0.PE, EFLAGS.VM, retained-real-CS,
CS:EIP, SS:ESP, CR3, TR selector/type and source-defined CPL. The three mode
classes are `protected`, `vm86` and `pe-clear`; PE-clear is not called completed
real-mode setup. VM86 has CPL 3 regardless of CS low bits; PE-clear and retained
real CS use the CPU's source-defined CPL 0. Raw CR0/EFLAGS representations may
be retained as bounded scalars, with their decoded flags derived from the same
captured values. No task-state bytes, RAM snapshot or physical mapping is read.

The existing task-transfer and delivery tickets stay bounded and only gain
credit after their enclosing CPU step commits. A mode transition and a task
transfer in the same step have the same step identifier without an invented
within-step order. A change detected between recorded steps is refused as
unattributed rather than credited to an instruction. The observer can continue
through a committed PE-clear or VM86 step, while preserving the exact mode
history. An original-task resumption is only a candidate after the source-owned
TR role, saved continuation, CR3 and handler descriptor scalar roles match in
protected, non-VM86 mode. It does not establish the owned IRET, frame contents,
physical backing, a DPMI service result or a full application boot.

The future dedicated workflow must bind the same owned source, compiler,
free BIOS/VGA BIOS, FreeDOS floppy, CWSDPMI host, executable/map, ROM and media
inputs as the reviewed AT gate. It will upload only closed, bounded reports and
notices; no raw executable, media, RAM or task-state segment bytes. CPU-hosted
controls and an actual guest packet are required before any claim beyond this
source-only contract.
