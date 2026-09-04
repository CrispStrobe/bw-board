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

**3. ONE WORKER PER TREE, and an agent counts as a worker. PATH SCOPING IS NOT
ENOUGH.** Commit by explicit path, never `-A` or `.`, in a tree you did not
create — but understand what that buys you, because on 2026-09-04 it twice did
not save anyone. **Path scoping limits which FILES you sweep, not which
AUTHORS' changes within a file.** The support-chip lane committed `ROADMAP.md`
by path and still swept another session's uncommitted survey into its commit
(`4560d78`), because both sets of hunks were in the one file. And `lego-47`
destroyed its own uncommitted fix with `git checkout --` on a SINGLE FILE —
path-scoped, still lost. The two forms that actually hold:

- **Commit before you mutate.** An uncommitted edit in a shared tree is not
  yours, it is ambient.
- **Or copy the file out first**, and re-apply after.

And if you find another author's hunks intermixed with yours in a file you are
about to commit: revert YOURS, tell them to land theirs, re-apply after. That
is what happened on the second pass of `4560d78` and it worked.

**4. Check the SHAPE of your tree before pushing a ledger edit**, not just your
diff: `git ls-tree HEAD | wc -l`. A single entry means your tree is a DELETION.

**5. A roadmap item asserting a gap must be re-checked against the tree on the
day it is ACTED ON.** Two of §E6.8's nine items were stale within twenty-four
hours of being written, by work that landed while the survey was being drafted:
the CI vector grader already existed (sim3's R1) and the bootable MS-DOS image
already booted, down two independent paths. The rule earned itself twice more
the same day — the support-chip lane found its own EXTRACTOR IRQ gap closed on
the day it was written down. **At this fleet's current rate a gap claim has a
shelf life measured in hours**, so the check is not diligence, it is the only
thing standing between a claim and a day spent re-doing finished work.

## CLAIMS — work in progress

| lane | who | started | what |
| --- | --- | --- | --- |
| E6.8.1 — the 80186/80188 instruction variant | lego-a4 (VPS Claude session) | 2026-09-04 | **CORE LANDED, DISASSEMBLER OUTSTANDING.** `feat/i8086-186` off `feat/i8086-tier`, worktree `wt/bw-i8086-186`, pushed at `1f6b3e2`. Done: `variant: '8086'\|'80186'` on the core and on `MachineConfig`; the fifteen opcodes (PUSHA, POPA, BOUND, PUSH imm8/imm16, three-operand IMUL, INS/OUTS, shift-by-immediate, ENTER, LEAVE); shift-count masking; reg=6 as a second SHL. **8086 path unchanged at 646,000/646,000**, and 407/407 across the tier's other tests. New grader `scripts/grind-i8086-v20.mjs` at **132,532/132,532** against SingleStepTests/v20 (MIT), sparse-checked out at 156 MB of 851. **Where the V20 stops being a 186 it EXCLUDES and reports rather than scoring the wrong chip**: 39,898 vectors with a shift count above 31 (the V20 does not mask, measured — 470/600 masked vs 579/600 unmasked on C0.4+C1.4) and 3,570 REPC/REPNC vectors (NEC prefixes with no 186 equivalent). `test/i8086-186.test.mjs` (13 tests) holds up exactly what the suite cannot. **What the vectors taught: OF is defined for EVERY shift count on the later part, and it is the count-of-one rule applied to the LAST iteration, not a new rule.** STILL OPEN: `src/i8086-disasm.js` renders the fifteen opcodes as their 8086 aliases, so a 186 debugger pane is wrong; the v20 suite ships a disassembly string per vector, so it can be ground to the same standard the 8086 disassembler already meets. Not started. |

## DONE

| lane | who | landed | sha |
| --- | --- | --- | --- |
| §E6.8 — the finished-emulator gap survey (emu86, PCjs, XTCE-Blue) | lego-a4 | 2026-09-04 | `4560d78` on `feat/i8086-support-chips`, merged to `feat/i8086-tier` at `fca6b9a`. **Note for the record:** the section was written into a shared tree and swept into another agent's commit by a `git add -A` — see rule 3. No work was lost; the attribution in that commit message is not the whole story. Two premises corrected same-day by `lego-47`; both corrections are recorded in place in §E6.8 rather than edited out. |
| coverage-and-boards — the three self-booting 8086 example firmwares + board fixes | this session (sim2 / `8086 coverage testing materials`) | 2026-09-04 | On `feat/i8086-support-chips`: **`4133114`** TIMERDEMO8086 — the interrupt example (INT 8 tick painting a live counter; first end-to-end proof a running program takes & services a hardware interrupt here: 8254 OUT0 → 8259 IR0 → CPU INT 8 → ISR → B800 → EOI); **`cffca33`** CGADEMO8086 screen example + PCXT8086 CGA video-RAM fix (B8000-BFFFF, matching XTDISK); **`eb8109a`** PCXT8086 `dma:'dma1'` load-bearing-wire comment. On bw-circuit-ui `feat/i8086-ui`: **`afee1de`** Machine-Loader offers all three firmwares, loaded high via `romAt = 0x100000 − length`. E7 step 2 + the EXTRACTOR-IRQ-GAP correction landed in ROADMAP the same push as this row (rule 2). |
