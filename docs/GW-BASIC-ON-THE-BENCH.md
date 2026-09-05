# GW-BASIC on the bench -- investigation (ROADMAP N6)

**Question.** Microsoft released GW-BASIC's original source under MIT in 2020
([github.com/microsoft/GW-BASIC](https://github.com/microsoft/GW-BASIC)) -- the
1983 8088 MASM assembly, 35 `.asm` files. Does it assemble through bw-board's
`src/i8086-asm.js` MASM front end and boot to a prompt on the DOS bench? If so
the 8086 column gets a **native** BASIC cell beside the 6502's MS BASIC ROM and
the Z80's BBC BASIC.

**Answer: no -- `native: null`.** GW-BASIC targets the *full* 1983 MASM
(multi-module linking, conditional assembly, macros, INCLUDE, COMMENT blocks)
plus an OEM stub layer that is not in the release. `i8086-asm.js` is a
deliberate *single-module subset* assembler for self-contained DOS programs, so
**0 of 35 sources assemble**; nothing links, so there is nothing to boot. This
is a clean "does not assemble because X is missing" result, exactly the hazard
Microsoft's own README names.

## Method (reproducible, no vendoring)

The MIT source is **not vendored** -- 35 files of someone else's assembler have
no place in this tree for an investigation. `scripts/gw-basic-assemble-probe.mjs`
reads a clone via `GW_BASIC_DIR` and runs each source through `assemble(src,
{dialect: 'masm'})`, tallying refusals by the `AsmError.what` construct -- the
same shape as the 525-program corpus harness (510 accepted / 15 refused).

Two preprocessing steps the real MASM performs, and the probe must too, or it
tallies its own artefacts instead of GW-BASIC's constructs:

- **Resolve INCLUDE.** Every source `INCLUDE`s `BINTRP.H` on line 8. Without
  inlining it the tally is just 34x *unsupported directive INCLUDE* and nothing
  past line 8 is seen.
- **Strip at ^Z.** DOS text files end in `0x1A`; MASM stops there. Inlining an
  included file *whole* leaves that EOF byte mid-stream, and the assembler then
  refuses the `^Z` as an unknown mnemonic -- a property of the probe, not of
  GW-BASIC. This bit during the investigation: the first flattened run reported
  34x *unknown mnemonic* whose named line rendered empty -- the offending line
  was the `0x1A` EOF byte itself. Corrected (strip at ^Z), the real constructs
  appear.

## Result -- first refusal per file, INCLUDE resolved, ^Z stripped

| count | construct | kind | example |
|---|---|---|---|
| 19 | `COMMENT` | unsupported directive | BIBOOT.ASM:368 |
| 8 | `EXTRN` | unsupported directive | BIMISC.ASM:386 |
| 4 | `IF1` | conditional assembly (unknown mnemonic) | GWDATA.ASM:454 |
| 2 | `PUBLIC` | unsupported directive | MACLNG.ASM:376 |
| 1 | `OR` of addresses | bad expression | ADVGRP.ASM:373 |
| 1 | over-wide immediate | `112164` in a `WORD PTR` MOV | MATH2.ASM:58 |

**0 accepted, 35 refused.** These are *first* refusals -- each source stops at
the first unsupported construct, so more lie behind every one. `BINTRP.H` alone
defines **18 MASM macros** (`MOVRI`, `un_def`, `T`, `Q`, `QF`, ...), none of
which the front end expands; the tally above is what each file hits *before*
reaching a macro invocation.

**Missing OEM stub:** `CPM86U` is `INCLUDE`d but absent from the release -- the
OEM.ASM-layer gap the README warns about (keyboard/screen/CP-M hooks were
OEM-specific and not open-sourced).

## Why this is `native: null`, not a small build task

The refusals are not a handful of missing instructions -- they are MASM's
*assembly-language* layer, which `i8086-asm.js` documents in its own NOT
SUPPORTED list and does not implement by design:

- **Multi-module linking** -- `EXTRN` / `PUBLIC`. GW-BASIC is 35 modules linked
  together; the front end assembles one self-contained module and has no linker.
- **Conditional assembly** -- `IF1`/`IFDEF`/`ENDIF`, for pass-1 macro and
  include guards.
- **Macro expansion** -- 18 macros in `BINTRP.H`, many more across the tree.
- **`INCLUDE`** and **`COMMENT`** blocks.
- Plus the **OEM stub layer** (`CPM86U` and the rest) that Microsoft did not
  release at all.

Supporting GW-BASIC natively would mean building a full MASM assembler *and* a
linker *and* re-creating the OEM layer -- a from-scratch MASM, not a patch to a
subset one. That is out of proportion to one matrix cell, especially since the
comparison cells do **not** clear this bar the same way: the 6502's MS BASIC and
the Z80's BBC BASIC are shipped as **ROM/binary images**, loaded and run, not
assembled from full-MASM source on the bench. GW-BASIC has no equivalent
redistributable binary here.

**Matrix guidance:** the 8086 BASIC cell should read `native: null` with the
reason *"MIT source is full 1983 MASM (EXTRN/PUBLIC multi-module linking, IF1
conditional assembly, macros, INCLUDE) plus an unreleased OEM stub layer;
i8086-asm.js is a single-module subset assembler, so 0/35 sources assemble -- a
native cell would require a full MASM + linker + OEM layer, not a subset patch."*

## Reproduce

```
git clone --depth 1 https://github.com/microsoft/GW-BASIC /tmp/GW-BASIC
GW_BASIC_DIR=/tmp/GW-BASIC node scripts/gw-basic-assemble-probe.mjs
```

Investigation only -- nothing vendored, no code path changed.
