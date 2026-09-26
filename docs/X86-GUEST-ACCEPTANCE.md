# 16-bit guest execution: measured incremental acceptance

Latest wired-board work: [physical DMA, HOLD and keyboard integration](HARRIS-286-PHYSICAL-DMA.md).
The source-pinned reference board has now reached DOS 2's real `A>` prompt;
see the [boot receipt](HARRIS-286-DOS-BOOT-REPORT.json). This does not complete
the broader guest list, compiled-backend acceptance, or the real-time target.
The older milestones below retain their original scope and measurements.

2026-09-08. User requested DOS utilities, shell/editor persistence, Circuit
Editor reference machines, ELKS, then classic MINIX/286 protection, on 8086,
80186 and 80286. The ELKS PC/XT boot and root-mount milestone is now complete;
the remaining MINIX/286 and wired follow-ups are not.

## Implemented in this increment

* Preserve original MIT Paterson CHKDSK source, licence and revision/hash
  manifest in `test/fixtures/paterson/`. Translation in
  `scripts/lib/paterson-routines.mjs` selects real PACK/UNPACK code, with explicit
  SCP syntax changes and an owned caller. The routines, not the entire utility,
  execute on 8086, 80186 and the wired Harris 286 subset.
* Independent FAT12 bit-packing expectations cover odd/even clusters, zero,
  one, ABC and FFF; adjacent bytes/nibbles and SP are preserved. 25 tests passed
  locally (includes provenance test); this is not a silicon-vector comparison.
* Extend wired CPU: byte registers/memory, segment overrides and loads, word
  stack/near calls/returns, byte/word ADD/SUB/CMP/AND/OR/XOR, immediate groups,
  TEST, all short Jcc predicates and single-bit SHL/SHR. Every operand uses the
  wired memory path. This was the initial subset; the subsequent real-mode
  expansion described below supersedes its instruction limitations.
* Prove real Microsoft DOS 2 kernel and COMMAND.COM write a disk file, boot a
  fresh machine, read it, overwrite it, remount again and handle a missing file,
  separately on 8086, 80186 and the fast core's 80286 real-mode variant. Exact Microsoft release hashes are checked.
  Tests use existing external media and report absence explicitly; these are
  BIOS-service-machine tests, not wired-board or full-editor acceptance.
* Boot that same real DOS guest on the fast 80286 variant and run Microsoft's
  hash-pinned MASM 1.10, LINK 2.00 and EXE2BIN from its FAT12 disk. The guest
  assembles and links an owned source, persists `T.COM`, executes it to print
  `GUEST-TOOLCHAIN-OK`, and returns to COMMAND.COM. The persisted bytes are
  independently compared with the repository assembler. The reproducible
  runner is `scripts/run-dos-toolchain-guest.mjs`; the measured receipt is
  [2026-09-19-dos-toolchain-fast286.json](receipts/2026-09-19-dos-toolchain-fast286.json).

The 80186 and 80286 rows are instruction variants with external PC-like hardware,
not complete models of their integrated peripherals or a PC/AT chipset.
Follow-up: carry arithmetic, remaining arithmetic/shift groups, near/far
transfers, stack frames, REP strings, port transactions, software INT/IRET and
real-mode faults now execute in the experimental Harris CPU. The historical
675,501-pass baseline is preserved separately from the expanded-suite receipt.
See [runner, coverage receipts and remaining gates](SST286-RUNNER.md).
An additional [system-state increment](HARRIS-286-SYSTEM-STATE.md) implements
real-mode descriptor-table/MSW setup and relocated INT/IRET with twelve owned
tests; the full pinned SST286 regression remains green. PE=1 still refuses.
An opt-in [wired NMI foundation](HARRIS-286-NMI.md) now covers NMI entry,
HLT wake and REP resumption; general external interrupt support is not complete.
The [wired INTR connector](HARRIS-286-INTR.md) adds opt-in CPU acknowledgement
and vector delivery, verified with an independent lab peer, not a programmed PIC.
Subsequent [programmable PIC](HARRIS-286-PIC.md) and [pin-clocked timer](HARRIS-286-TIMER.md)
subsets add actual port/IRQ0 guest tests. [Conventional/text RAM expansion](HARRIS-286-MEMORY-MAP.md)
adds up to 640 KiB and an owned high-memory code-relocation/stack test.
The [BIOS POST diagnostic](HARRIS-286-BIOS-POST.md) now confirms the original
ROM's PIC-mode mismatch and offers an explicit unbuffered firmware build;
the default ROM is unchanged and diagnostic stops are not boot acceptance.
These do not establish protected mode, complete PC peripherals or DOS boot
on the wired 286. Application engine pins and production
defaults remain unchanged. [Private DOS media](PRIVATE-DOS-FIXTURES.md) remains external-only;
its admission checker does not distribute or execute games.

## Boot diagnostics (not acceptance)

`node scripts/probe-16bit-os.mjs elks 8086` (also `80186`) and
`node scripts/probe-16bit-os.mjs minix 8086` (also `80186`) fetch exact hashed
media into memory, copy a disposable disk and expose only BIOS services.
No DOS syscalls are installed for these kernels. No GPL media is bundled.
Successful diagnostic execution still exits 2 and reports `accepted:false`.

Initial measured attempts:

| Guest | CPU | Observation |
| --- | --- | --- |
| ELKS 0.9.2 fd360-minix | 8086 | Earlier BIOS-service diagnostic reaches setup but is not acceptance |
| ELKS 0.9.1 fd1440-fat | 8086 PC/XT | **Accepted:** kernel banner, floppy probe, root mount, timer and FDC IRQs; image remains external |
| MINIX 2.0.0 TINYROOT | 8086/80186 | CPU reaches unsupported FE encoding before console output; root cause not yet established |
| MIT xv6 x86 (`eeb7b415`) | experimental 386 AT | Source builds reproducibly; 32-bit ATA PIO plus CR4/PSE now reaches the protected xv6 kernel, which visibly panics at `mpinit` because this profile has no MP table/LAPIC/IOAPIC; no OS acceptance yet |
| Either | wired 286 | Refused before download/execution: board/CPU prerequisites absent |

An unsupported encoding can result from executing wrong bytes; it is not by
itself proof that the kernel requires a missing legal opcode. The next work is
to compare disk transfers, relocation addresses and firmware assumptions with
the pinned guest sources and a known working reference machine. Do not patch
guest signatures or mask these failures to produce a boot banner.

## Next work

Complete whole-utility/editor and named reference-board acceptance; resolve
the ELKS/MINIX boot diagnostics; implement remaining system CPU operations and wired I/O;
then execute the same real boot/file/process acceptance on wired profiles.
Protected mode is 286-only, not a required feature on 8086/80186.
The Lite plan is `docs/X86-GUEST-MILESTONES.md`; its preservation/package
research is `docs/X86-PRESERVATION-AND-PACKAGES.md`. No default change, merge or
deployment performed by this increment.
