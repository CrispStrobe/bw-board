# AX=0501 decoded far-reload attribution gate

This opt-in, label-only gate runs the previously reviewed finite task-mode AT
fixture and retains its `task-mode.json` unchanged. A separate bounded grader
reads that report and writes `far-attribution.json`. The grader does not run a
guest, reinterpret old instruction bytes, or convert the strict frame refusal
into a pass.

The narrow positive predicate requires a committed outgoing task transition,
then two source-recorded MOV CR0 mode changes, followed by one committed
source-issued `decoded-direct-far-cs-reload` ticket. The ticket identifies the
actual EA immediate or FF /5 indirect decoder path, operand width, instruction
start, selector, target, and post-transfer context. The before and after
contexts must retain the same task register, CR3, stack, and raw control/flags
values while the real-CS retention state clears. Missing, duplicate,
uncommitted, reordered, or inconsistent records refuse attribution.

A qualified `attributionQualified` result means only that these source-owned
report fields satisfy this bounded predicate. It is not independent machine
attestation. `passed` and `frameReturnQualified` remain false; the original
AX=0501 task-switch refusal and null return remain visible in the retained
report. No completed DPMI frame, broader OS behavior, physical backing,
performance, or application qualification follows from this gate.

The workflow binds a reviewed source tree and inherited pinned compile, media,
ROM, and notice inputs. It uploads only a closed inventory of bounded reports,
logs, notices, and hashes; no executable, disk image, RAM, or guest binary is
published. Failed or missing task-mode evidence produces a bounded refusal
receipt and preserves the original first failure. Hosted execution is required
before any actual result can be claimed.
