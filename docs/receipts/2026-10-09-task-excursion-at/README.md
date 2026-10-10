# Original task-excursion diagnostic: protected-mode boundary

[Draft PR474](https://github.com/CrispStrobe/bw-board/pull/474), source
`89eadb8c2449ff769b157ee6a4b78ccb833c3610`, passed all 12 enabled
checks, with only the two declared `vectors-full` skips, before its label was
applied once. [Original run37907258126](https://github.com/CrispStrobe/bw-board/actions/runs/37907258126)
completed with official failure. Its [summary](summary.json) binds the retained
original report ZIP and raw log. No replay or second actual replaced it. Root and a separate Sol reader
independently audited the retained official originals and raw Git bytes without
producer imports, guest replay or additional acquisition.

The original strict frame still refuses `task-switch-during-owned-frame` and
retains `returned:null`. The separate observer captured two committed JMP task
transfers: TR `0x60` → `0x70` → `0x68`. It stopped after 47 active steps
(35 after the outgoing transfer), with `unsupported-task-excursion-mode`.
Both recorded task transfers stayed in protected mode; the final machine has
CR0.PE cleared and is not shut down. This observer intentionally rejects real
mode and VM86, so the report establishes its mode boundary. It does not identify
the exact clearing instruction or establish a guest CPU fault.

There are no recorded deliveries, original-task resume candidate or qualified
frame return. `frameReturnQualified` remains false. The original inputs, passive
wrapper receipt, INT 31h entry, task attempt and first core outcome match the
previous retained task-core original. Report identities bind 205 source/ROM
roles and 64 JavaScript modules; source-before and source-after agree.

Next prepare a separately named, bounded mode-crossing diagnostic with committed
before/after mode facts and exact original-task/handler candidate checks. Keep
the protected-only original and strict ownership rules unchanged. Follow the
[task-excursion contract](../../I80386-DPMI-TASK-EXCURSION-LANE.md); no broader
application, strict physical 386DX, performance or RTx result follows here.
