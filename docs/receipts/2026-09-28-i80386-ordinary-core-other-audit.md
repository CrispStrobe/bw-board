# Ordinary Windows 386 `coreOther` profile audit

This is a read-only reduction of the existing 60-million-step Windows 3.11
ordinary-executor V8 profile. No new guest run or runtime change was made.
The measured board revision was `aafffc245c4c2cc286bb8a226ca5a8efa0962bc2`;
the raw 5 ms V8 profile SHA-256 is
`a70bc7ce7feff8edcdc53f53332549d8b5ee554528a81ce483209df8e265d179`
in the private `windows/2026-09-28/ordinary-fetch-screen-60m/` receipt.
The complete guest report matched an adjacent unprofiled control. Measured
`src/experimental/i80386.js` and `i80386-at-machine.js` SHA-256 values are
`510a7b18c7e5d3c2db67a3624fbea09fdeef169c381dd8e6744dabdb8ea6c5e2`
and `cd590385f617841429e5de2f2bf7759fcd064f67db61a474272f3188e86c31fb`.
Those CPU/board bytes still match the current master at this audit. The CLI
has since gained an off-by-default event observer, so its bytes are no longer
identical to the measured CLI.

The published fetch-profile reducer first assigned each of **13,718 V8 self
samples** to one disjoint ancestry bin. The `coreOther` bin contains **7,695**
samples: leaf URL is the 386 core, with no visible `_fetch8`/`_fetchN` or
data/EA ancestor. For this audit, each of those 7,695 samples is assigned
once by its V8 leaf function; the counts below sum exactly to the bin.

| Core leaf function | Self samples | Share of all 13,718 |
| --- | ---: | ---: |
| `_stepInstruction` | 2,592 | 18.89% |
| `step` | 1,899 | 13.84% |
| `maskFor` | 284 | 2.07% |
| `_operandRead` | 208 | 1.52% |
| `_descriptorBytes` | 206 | 1.50% |
| `I80386Fault` constructor | 204 | 1.49% |
| `_loadSeg` | 150 | 1.09% |
| `_linear` | 124 | 0.90% |
| `_stringIo` | 124 | 0.90% |
| `_string` | 123 | 0.90% |
| `_push` | 115 | 0.84% |
| `_translate` | 108 | 0.79% |
| All remaining core leaves | 1,558 | 11.36% |
| **`coreOther` total** | **7,695** | **56.09%** |

Immediate caller ancestry confirms the broad nature of the top bins:
2,592 `_stepInstruction` samples have `step` as caller; 1,819 of 1,899
`step` samples have the AT machine's `step` as caller. `maskFor` mainly comes
from `_add` (169) and `_setLogic` (93); `_operandRead` from
`_stepInstruction` (157); `_descriptorBytes` from `_loadSeg` (142); and
`I80386Fault` construction from `_stepInstruction` (133). These are subsets
of their respective leaf counts, not additional samples.

The two interpreter leaves together are **4,491/13,718 = 32.74%** of all
samples, an *attribution envelope*, not removable overhead. V8 source-position
ticks within the `step` nodes assign 750 ticks to inlined
`_snapshotInstruction` lines 1992–2032 (**5.47%** of all samples) and 832
ticks to the `_stepInstruction()` call site at line 2755 (**6.06%**).
Another 305 ticks map to other `step` lines; 12 of its 1,899 leaf samples
have no position tick. Position ticks are diagnostic source mappings of
samples, not an independent time measurement. Even a hypothetical removal
of both the 750 and 832 ticks has an 11.53% all-sample envelope before the
required fault rollback, trace/debug and one-instruction event work is paid.
The 2,592 `_stepInstruction` leaf samples span prefix decode, diverse opcode
bodies, inlined helpers and fetch work; they cannot be credited wholesale
to a single opcode or dispatcher patch.

**Decision:** no single narrow default-path candidate currently clears a
credible pre-coding screen for a 10% whole-run gain. A snapshot-only change
is bounded by a 5.47% diagnostic share; `maskFor`, descriptor, fault and
operand helpers are smaller. The prior 32-bit MOV/LEA inline trial and the
ordinary fetch-page cursor trial both failed their measured retention gates.
Grouping all `step`/`_stepInstruction` samples as avoidable would repeat that
mistake. No runtime optimization follows from this profile alone.

For a broader default dispatcher design, require a **pre-coding**
source-bound mechanism that identifies at least 15% of all-process self
samples in one disjoint, genuinely avoidable path, with actual completed-step
coverage across real/protected16/VM86/protected32 and explicit fault,
page-table/code-write, chip-event and debug boundaries. Do not count entire
interpreter functions or V8 call-site ticks as savings. A subsequent opt-in
prototype would require focused differential tests, complete Windows 60M and
lean xv6 guest/RAM parity, then three serial AB/BA/AB user-CPU pairs with at
least 10% mean Windows improvement and every pair favorable before adoption
as a default path. This gate is prospective; no candidate passes it here.
