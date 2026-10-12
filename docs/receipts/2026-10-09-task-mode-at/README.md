# Task-mode diagnostic: two attributed CR0 changes, then CS-reload refusal

[Draft PR478](https://github.com/CrispStrobe/bw-board/pull/478), reviewed source
`f2fb33f921bf99b23d1e88ee889512d5d4ee6318`, passed all ten enabled checks
and only the two declared optional skips before the single
[original run37938657230](https://github.com/CrispStrobe/bw-board/actions/runs/37938657230).
Root and a separate reviewer independently audited the retained original ZIP,
raw log, source and report identities without replay or producer imports.
[summary.json](summary.json) records public original identities and attribution.
The official conclusion remains failure.

The closed 114-member packet admits 215 Git roles and a 64-node import graph;
source-before and source-after agree. The same free/owned client and media
pins remain unchanged. Two committed task JMP records move TR from `0x60`
to `0x70` and then `0x68`. No interrupt delivery or uncommitted mode record
is reported. The strict frame retains `task-switch-during-owned-frame`,
`returned:null` and `frameReturnQualified:false`.

At mode step 47, source-issued `0f-22-cr0` attribution records CR0
`0x80000009` to zero at EIP `0x2bca`. At step 442, the same decoded
operation records CR0 zero to one at EIP `0x2ad1`, entering protected mode
with the retained real-mode CS context. At step 443, a committed change
clears that retained context and changes CS `0x26fc` to `0x18`, with EIP
`0x2ad4` to `0x2ad9`. It has no operation ticket. The recorder truthfully
refuses `unattributed-mode-change`; it does not identify the opcode from the
register values or instruction-length difference. Terminal active steps are
443, post-outgoing steps 431, and the driver made 432 continuation calls.
No original-task resume candidate was observed; the final machine is not
shut down. This observer boundary does not establish a guest CPU fault.

Preserve this source and original; never remove/reapply its label or retry it.
Next implement a separately reviewed, bounded source-issued CS-transfer ticket
for decoded direct non-call far transfers. Record explicit decode source,
instruction start, width, requested selector/offset, and copied before/after
CS/cache/retained-context facts. Admit only a committed direct code-descriptor
transfer with exact post-context agreement and unchanged CR0, VM, TR, CR3 and
stack context; competing, uncommitted, gate/task/call/return paths remain
refused. Cover decode forms, precommit faults, enclosing-step failure, reentry,
mutation and old/default behavior in affected hosted CPU regressions before
connecting any new guest diagnostic. No frame-return, complete OS, physical
memory, calibrated RTx or speedup qualification follows from this report.
