# VM86 common-context fixture

One MIT-authored two-sector guest (`guest.S`: boot sector plus two stage-2 sectors, read by INT 13h under the BIOS and preloaded by the bare JS harness) exercises a strict-386 common
context: real mode → CPL0 protected mode with an explicit GDT, IDT and two TSSs
→ IRETD into VM86 → `INT 40h` through a DPL3 interrupt gate onto the TSS1
`SS0:ESP0` stack → IRETD back to VM86 → `INT 41h` through a DPL3 task gate into
a nested task. CPL0 code emits the whole GDT, both TSS images, the handler and
task stacks and two VM86 RAM words on port E9.

- `build.mjs` assembles the guest with the runner's GNU binutils and records versions.
- `expected.mjs` derives every byte from the architecture without importing a CPU model.
- `engines.mjs` runs the ordinary JS core (`strict386`) and pinned upstream Bochs
  `REL_2_7_FINAL` (`0e45b736…`) built unmodified at CPU level 3, booting the sector
  through the repository's free BIOS.
- `run.mjs` writes the originals and a summary; `reader.py` independently re-hashes and
  audits them and reports the first preserved discrepancy.

## Descriptor accessed bit

Every code/data descriptor starts with A clear. The interrupt-gate CS (0x28) and the
task-switch CS/data (0x30/0x38) must therefore be written back to GDT RAM. The 80386
sets the accessed bit on every segment-register load, CS included. QEMU 8.2 TCG's
protected far-JMP/INT/IRET CS paths do not write the descriptor, so QEMU is not an
oracle for these bytes. This fixture uses Bochs CPU level 3, which does write them;
the CPU model is not weakened and no mask is applied. Older QEMU ring-3 results keep
their own refusal.

## Boundaries

A finite fixture: paging off, interrupts disabled, no I/O from VM86, one task nesting.
It is no full-OS, enhanced-mode, application or performance result. Bochs at CPU level 3
is a reference emulator, not physical 386DX silicon.

The `actual` workflow job runs only for one `x86-vm86-common-context-actual` label
event on the exact pull-request head (first attempt) and uploads the originals.
