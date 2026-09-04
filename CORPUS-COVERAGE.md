# 8086 corpus coverage — sweep of 2026-09-04

What the `retro-corpus-8086` sweep says about the merged 8086 tier, and where
the real gaps are. This is the coverage lane's record; the raw per-category
verdicts it summarises were produced by `scripts/run-i8086-corpus.mjs` on the
integration tree (my display/keyboard/CRTC work + the DOS INT 10h graphics + the
186 instruction set + lego-ef's `MAX_STDOUT` fix, all merged).

## Method

- Corpus: `8086-ASSEMBLY-LANGUAGE-PROGRAMS/Source Code`, 40 categories, ~525
  programs, assembled by `i8086-asm.js` and run on `DOSBOX8086` (a RAM box +
  the DOS/BIOS software layer; INT 10h graphics write A0000/B8000 as RAM).
- Run per-category rather than as one process, because a single long run was
  repeatedly starved by a second corpus run sharing the box. No `--expect`
  oracle was supplied, so a program that runs to completion reports **EXITED**
  (where an oracle run would say MATCH/DIFFER); the failure verdicts —
  **THREW / HUNG / LOOPING** — need no oracle and are the point of this pass.
- Baseline, from before the display work (lego-47): `467 MATCH · 4 NOINPUT ·
  16 ORACLE · 15 DIFFER · 2 LOOPING · 6 HUNG · 15 THREW`.

## Result: the failure counts are essentially unchanged from baseline

`THREW 14 · HUNG 6 · LOOPING 3+` (three categories with interactive programs
were not fully counted — see below). The merged tier did **not** clear the
baseline's HUNG/THREW, and reading *why* is the whole value:

### THREW — 14, and all 14 are ONE assembler-config gap (not hardware)

Every THREW is `i8086-asm.js` refusing a conditional jump or `LOOP` whose target
is beyond the 8086's ±127 short-jump range — e.g. *"JC to FINISHED is 272 bytes
away and this instruction only reaches 127 -- pass { longJumps: true }"*. The
8086 has no near/far `Jcc`; the promotion to **inverted-condition + a near
`JMP`** ALREADY EXISTS in the assembler (`promote()` + the `longJumps` option).
It just is not enabled for this run: the harness calls `assemble(source, {...})`
without `longJumps`, and MASM dialect defaults it off (`opts.longJumps ??
this.nasm`), while the corpus is MASM (`.MODEL`). Verified: assembling
`copy_file_contents.asm` with `longJumps:false` THREW, with `longJumps:true`
produced 1168 bytes. **So one flag — pass `longJumps:true` in the corpus
harness's assemble() call — clears all 14 at once, byte-safe (promotion only
rewrites jumps that overflow).** (Only the HARNESS, not the assembler default:
MASM 1.10 — measured against the real binary — does NOT promote; later MASM and
TASM do, NASM does and matches our `promote()` byte-for-byte. The MASM-dialect
default stays OFF so byte-fidelity against the MASM oracle holds and a learner is
never handed a program that runs here and fails on the lab machine. The coverage
harness is the one place whose question is "does it run" rather than "is it
byte-identical".)
The single highest-leverage coverage fix, and it is the assembler/harness lane's
call (a documented dialect decision in their file).

**FIXED (2026-09-04, `5303924` on `feat/i8086-tier`, lego-47):** the coverage
harness now passes `longJumps: true` — and counts and prints the promotions,
with the "no longer assembles under MASM" cost beside them — clearing **13 of
the 14**: THREW 14→1, EXITED 502→516. File Operations (6), Control Flow,
Patterns, Procedures, Sorting, Utilities (2), External Devices all EXIT now.
(This session made the same one-line change independently at `cb5e992`; lego-47's
is canonical.) The 14th (`Conversion/string_copy_using_movsb_instruction`) is a
DIFFERENT gap: the assembler did not support `.FARDATA` — a genuine directive
gap (a second data segment reached via `MOV AX, SEG VAL_DEST; MOV ES, AX`).

**`.FARDATA` FIXED (2026-09-04, `fardata-i8086` branch):** it now opens a
FAR_DATA segment (its own segment outside DGROUP; the generic layout and
SEG-as-relocation already handle any named segment, so it was a two-line
addition). The program assembles and RUNS to its exit. **So the corpus's last
assembler THREW is gone — with the harness's longJumps and this, all 15
previously-refused programs assemble.** 77/77 assembler tests green (the three
that asserted `.FARDATA`'s absence / the old counts were updated).

**THE INTERESTING QUESTION — do the 15 newly-running programs hit runtime
service gaps assembly was hiding? Answer: no.** Spot-checked and swept: the
File Operations programs do real DOS file I/O ("Copying a file sixteen bytes at
a time / Source written, 55 b..."), the `.FARDATA` program's cross-segment MOVSB
works, and the interrupt-fidelity test confirms none takes an interrupt its
source never wrote. The assembler default was the only thing hiding them; the
machine behind it was already ready.

The 14 (all fail to ASSEMBLE, so they never run):

| category | program |
| --- | --- |
| File Operations | copy_file_contents, file_error_handling, file_size_by_seek, open_existing_file, read_file_in_chunks, rename_and_delete_file |
| Control Flow | computed_jump_into_a_table |
| Conversion | string_copy_using_movsb_instruction |
| Patterns | spiral_matrix_print |
| Procedures | register_versus_stack_arguments |
| Sorting | merge_sort_bottom_up |
| Utilities | hex_dump_of_a_block, unit_converter_table |
| External Devices | thermometer_sampling_and_average |

### HUNG — 6, all External Devices polling peripherals nobody models

`led_display_test, robot, stepper_motor, thermometer, traffic_lights,
traffic_lights_advanced` — embedded-style programs that wait on an LED panel, a
motor, a sensor, a traffic-light controller on ports the machine does not decode,
so the wait never ends. These need device models nobody has built, and "no lesson
wants them" is a legitimate answer (the project's own rule).

### LOOPING / not-counted — interactive programs starved of input

`Input Output` and `Utilities` each carry one, and three categories were left
uncounted because their interactive programs run to the step budget: `DOS
Services/dos_menu_driven_program`, `Expression/calculator`, and `8086
Microprocessor Simulator`. They print a menu and reprint forever because the
unattended harness types nothing — not defects (lego-ef's diagnosis); with
`--type` they complete.

### Everything else — 30+ categories — EXITS clean

Addressing Modes, Arithmetic, Array Ops, BIOS Services, Bit/Bitwise, Conditional
Jumps, Data Structures/Transfer, Flags, **Graphics**, **Interrupts**, Loops,
Macros, Mathematics, Matrix, Memory Ops, Number Theory, **Port Programming**,
Recursion, Searching, Shift/Rotate, Signed Arithmetic, Simulation, Stack Ops,
String Instructions/Operations, Introduction — all clean.

## What this means for the display work

**The display cards did not move corpus verdicts — by design, and confirmed.**
Every graphics program draws through BIOS INT 10h, which writes A0000/B8000 as
RAM and verifies by reading the pixel back — a software path that was already
passing (the whole Graphics category EXITS clean). The cards are the interactive
*renderer* half of that feature (VdpScreen), which a headless corpus never
exercises. So the coverage opportunity the sweep surfaces is an **assembler**
fix, not a hardware one — handed to the assembler lane with the program list.
