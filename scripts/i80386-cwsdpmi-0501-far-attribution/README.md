# Source-only direct far CS reload attribution

The first task-mode AT guest run retained a committed protected-mode step that
changed CS and cleared the retained-real-CS marker. Its bounded mode recorder
correctly refused that step as unattributed. A CS change and the EIP delta do
not identify an opcode or prove a far transfer.

This opt-in CPU slice gives the separate task-mode recorder a private ticket
only when the source decoder takes a direct non-call protected far transfer
through immediate `EA` or indirect `FF /5`, and the direct code-descriptor
branch commits the CS/cache/EIP reload. The ticket names the actual decoder
path, operand width, selector and target. The recorder compares its copied
post-transfer scalar context with the committed enclosing step, requires the
expected retained-real-CS transition, and refuses concurrent task, flag, CR0,
CR3, TR, stack or unrelated mode changes. A fault or traced/nonpositive step
cannot earn a committed mode change. Calls, task gates, returns and interrupts
do not gain this attribution.

The older strict AX=0501 frame journal still refuses the task switch and has
no qualified return. The older protected-only task observer and default CPU
behavior are unchanged. This source checkpoint has not run a guest and does
not show that the original refused instruction used either decoder path. No
raw guest instruction or TSS bytes are retained by this ticket.
