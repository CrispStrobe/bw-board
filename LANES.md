# Who is doing what in bw-board — claim before you start, release when you finish

Created 2026-09-04, at `lego-47`'s request, because the fleet's 8086 work now
runs across a dozen worktrees and the claims had nowhere in THIS repo to live.
The protocol is brickwright-lite's `LANES.md`, unchanged, and that file remains
the long-form statement of it. The short version, and the two rules that were
each learned by losing work:

**1. Before you start, look.** `git fetch origin`, read the recent branches,
read the CLAIMS table below. If your work is already claimed or already landed,
you have just saved yourself a day.

**2. Claim it here in the same push as your first commit; release it to DONE
with the sha in the same push as your last.** An abandoned claim is worse than
no claim — the next worker reads it as work in progress and stays away from
something nobody is doing.

**3. ONE WORKER PER TREE, and an agent counts as a worker.** On 2026-09-04 a
`git add -A` swept one agent's uncommitted work into another's commit, and a
`git checkout -- src/` destroyed a third's. Commit BY EXPLICIT PATH, never with
`-A` or `.`, in any tree you did not create.

**4. Check the SHAPE of your tree before pushing a ledger edit**, not just your
diff: `git ls-tree HEAD | wc -l`. A single entry means your tree is a DELETION.

**5. A roadmap item asserting a gap must be re-checked against the tree on the
day it is ACTED ON.** Two of §E6.8's nine items were stale within twenty-four
hours of being written, by work that landed while the survey was being drafted.

## CLAIMS — work in progress

| lane | who | started | what |
| --- | --- | --- | --- |
| E6.8.1 — the 80186/80188 instruction variant | lego-a4 (VPS Claude session) | 2026-09-04 | **CLAIMED at `lego-47`'s direction**, after it corrected two stale premises in §E6.8 and confirmed it holds none of these files. Scope: `variant: '8086' \| '80186'` on the machine config, and the ~15 opcodes a 186 adds that `src/i8086.js` does not have — `PUSHA`/`POPA`, `PUSH imm`, `IMUL r,rm,imm`, `INS`/`OUTS`, `BOUND`, `ENTER`/`LEAVE`, and `&31` shift-count masking (which §3 note 8 of the core plan already documents as an 8086-vs-later fact; it simply is not selectable). Evidence the gap is real, re-verified on `feat/i8086-tier` 2026-09-04: `src/i8086.js:791` still decodes `0x60` as a `Jcc` alias, which is correct 8086 and exactly what a 186 is not; zero hits for the 186 mnemonics. **The oracle is `SingleStepTests/v20` (MIT)** — the NEC V20 implements the 186 set, so the same grinder that reached 646,000 grades the extension, and sim3's `vectors:` CI job (R1) is the mechanism it plugs into. Nothing lands without a grind. Files: `src/i8086.js`, `src/i8086-machine.js`, `src/i8086-disasm.js`, a new `scripts/grind-i8086-v20.mjs`, `test/i8086*.test.mjs`. |

## DONE

| lane | who | landed | sha |
| --- | --- | --- | --- |
| §E6.8 — the finished-emulator gap survey (emu86, PCjs, XTCE-Blue) | lego-a4 | 2026-09-04 | `4560d78` on `feat/i8086-support-chips`, merged to `feat/i8086-tier` at `fca6b9a`. **Note for the record:** the section was written into a shared tree and swept into another agent's commit by a `git add -A` — see rule 3. No work was lost; the attribution in that commit message is not the whole story. Two premises corrected same-day by `lego-47`; both corrections are recorded in place in §E6.8 rather than edited out. |
