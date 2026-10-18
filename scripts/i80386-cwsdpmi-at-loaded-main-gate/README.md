# Owned CWSDPMI AT loaded-main gate

This separate gate recompiles the unchanged owned DJGPP client and admits its
fresh EXE/map pair, builds the unchanged pinned FreeDOS/CWSDPMI disk, then runs
the repository's experimental 4 MiB AT FreeDOS VGA profile with the pinned free
AT BIOS and LGPL VGA BIOS. The backing array is 16 MiB; the configured guest
RAM is 4 MiB. The earlier QEMU control used QEMU pc/486 and different firmware.

The driver performs only ordinary synchronous machine steps. At a top-of-loop
cut after the client command's Set-1 input was accepted, it checks protected
32-bit CS:EIP against the fresh map's `main`, copies the complete linked text
through the separate passive ordinary-RAM reader, and binds it to the same
fresh EXE/map admission. CPU, RAM, page-classifier, translation, selected board,
and VGA-plane fingerprints must be unchanged across that synchronous read.
The cut happens before the next `machine.step()`, which may service chips or an
interrupt before executing another CPU instruction. A passing cut establishes
loaded text identity at that architectural state, not a startup call, first
`main` instruction, INT 2F/INT 31 service, client completion, or performance.

The [first hosted attempt](FIRST-RESULTS.md) failed before any keyboard input
or loaded-text cut. Its raw report had no VGA-register snapshot, so the
follow-up source admits the source VGA text route and retains bounded rejection
registers without attributing that historical failure to a proven mode value.
The [second hosted attempt](SECOND-RESULTS.md) accepted keyboard input and
recorded a protected `main` candidate, then refused the signed JavaScript CR0
representation before any loaded-text bind. A CR0-only source correction was
then exercised by the third hosted attempt.
The [third hosted attempt](THIRD-RESULTS.md) passed that CR0 guard and failed
strict whole-text binding at linked text offset 23,472. The follow-up adds
bounded mismatch metadata only; it keeps the exact-byte acceptance rule.

The labeled hosted workflow authenticates exact Git source, recursive imports,
dynamic Python helper roles and ROM bytes before the run and after it. It keeps
bounded compile, package, input, progress, and guest reports; binaries, images,
archives, and toolchain bytes are excluded from the artifact. A failure before
the cut is retained as a failure. No actual AT run is qualified by this source
checkpoint; the follow-up requires a separately reviewed hosted run.
