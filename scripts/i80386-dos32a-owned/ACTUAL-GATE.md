# Owned LE application gate

The [first hosted result](../../docs/I80386-DOS32A-OWNED-LE-RESULTS.md) passed
this finite application gate at source `f8748bcf8dc5c20b37fe62340b7ea42a048cb144`
in [run 37648932918](https://github.com/CrispStrobe/bw-board/actions/runs/37648932918).
The original artifact had two independent raw-byte audits; the code below
remains the reproducible gate rather than a broader compatibility claim.

This opt-in gate runs the [owned LE fixture](README.md) through a real
FreeDOS 1.4 boot on the experimental AT machine and, separately, QEMU TCG.
Both guests receive byte-identical FreeDOS floppy and FAT16 hard-disk images.
The hard disk contains the owned LE client, DOS/32A, and two owned batch files.
`RUNLE.BAT` checks the DOS exit status; `VERIFY.BAT` runs afterward to prove
that control returned to the shell. The target must also observe the client's
exact instruction prefix while executing in a 32-bit protected code segment,
the arithmetic result and branch, DOS print call, and successful exit call.
The independent QEMU result observes the VGA text prompt before each command,
then checks the guest-produced output, zero exit and subsequent shell command;
the comparison requires the same bounded output
bytes and initial media hashes. A loader banner or printed text alone does not
pass this gate.

The target uses the current AT compatibility profile, a 386-class flat
protected-mode fixture with no PSE/APIC dependence. It declares 4 MiB of
installed guest RAM within a 16 MiB backing/address span retained for high
ROM aliases. It is not strict 386 hardware qualification. QEMU uses its own
`pc`/486/4 MiB/SeaBIOS/VGA profile, so
the comparison establishes this finite application outcome, not cycle, device
or full architectural-state parity. Whole backing-RAM and disk hashes,
selected reset/final CPU and device records, exact scan-code offers/acceptance
and raw first failures are retained for review. The report distinguishes
configured memory from its backing array; those hashes are not an independent
full-memory replay.
Each QEMU prompt milestone retains its exact 4,000-byte physical VGA text
snapshot and SHA-256, so a reviewer can independently decode the observed
last-line prompt. On failure the latest available snapshot is retained.
This gate does not measure speed or qualify DPMI, IRQ, high-memory allocation,
other LE programs, or a protected-mode OS.

The workflow is opt-in through a dedicated same-repository PR label after
source review. It authenticates the exact PR source before and after both
guests, checks the generated LE and FAT16 image with bounded controls, and
preserves the original failed result. It uploads reports, hashes, toolchain
details and license notices, excluding executable binaries and disk images.
The successful run and independent audits are linked above; further guests
still require their own affected acceptance.

External inputs are pinned to publicly distributed, freely licensed sources:

- FreeDOS 1.4 Floppy Edition `FD14-FloppyEdition.zip` from
  `https://www.ibiblio.org/pub/micro/pc-stuff/freedos/files/distributions/1.4/`;
  the extracted 1.2 MiB `x86BOOT.img` image must hash to
  `03df6088be016e57a6c44275f5bb9ab0244db71de1360957fd76ba83243b6a77`.
- DOS/32A `binw/dos32a.exe` and `license` from
  `https://github.com/amindlost/dos32a/tree/06d8e3a0b2397d872205d6c99a7de0d6b8628bcc`.
  The 27,504-byte extender must hash to
  `d189be603e72f79d3c2f68114eb34d0cab8bd9744ef0f327497d57bcd8e16817`;
  its license and required acknowledgment accompany the evidence. This is a
  custom permissive license, not an Apache-2.0 claim.
- The repository's `roms/free-at-bios/` free BIOS and VGA ROM pins, with their
  existing `LICENSE` and `README.md` retained in the evidence.

The QEMU oracle reads physical VGA text using QMP's documented `pmemsave`
command; it does not use a host DOS shim. Its own boot/CPU/BIOS devices remain
independent of the target. See the
[QEMU QMP reference](https://www.qemu.org/docs/master/interop/qemu-qmp-ref.html#command-pmemsave).

Source-only controls (these do not run DOS or QEMU):

```sh
python3 -B scripts/i80386-dos32a-owned/control.py
python3 -B scripts/i80386-dos32a-owned/acquire-control.py
python3 -B scripts/i80386-dos32a-owned/compare-control.py
node scripts/i80386-dos32a-owned/grade-control.mjs
node scripts/i80386-dos32a-owned/keyboard-control.mjs
```

After committing the exact source checkpoint, run
`python3 -B scripts/i80386-dos32a-owned/source-control.py` in that clean
checkout to verify the declared source closure and wrong-head denial.
