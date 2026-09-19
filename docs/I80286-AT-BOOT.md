# Experimental IBM AT BIOS boot profile

`PCAT80286_BOOT` is a bounded IBM 5170-shaped profile for the experimental
protected 80286 backend. It uses the 80286 hardware reset state: visible
`CS:IP=F000:FFF0`, a reset-only hidden CS base of `FF0000h`, and a first fetch
at physical `FFFFF0h`. This is opt-in. Existing machine profiles retain their
legacy reset behavior.

The 16 MiB byte array is the address space, not an installed-memory claim. The
profile decodes 512 KiB at `000000h-07FFFFh` and 512 KiB at
`100000h-17FFFFh`; other unclaimed addresses read as open bus. The supplied
64 KiB system ROM is decoded at both `F0000h-FFFFFh` and
`FF0000h-FFFFFFh`, following the IBM 5170 memory map. A20 starts enabled, as it
does in the pinned PCjs 5170 chipset configuration.

The initial CMOS configuration describes this hardware rather than relying on
POST to invent it: byte `10h=20h` selects one 1.2 MiB floppy, `14h=21h`
selects one floppy and CGA 80-column display, base memory `15h:16h=0200h`, and
extended memory `17h:18h=0200h`. Bytes `2Eh:2Fh=0045h` are the IBM checksum of
configuration bytes `10h-20h`; `30h:31h` repeat the 512 KiB extended-memory
size. This CMOS state survives the 8042 warm reset.

`PCAT80286_BOOT_640K` retains the same hardware and maps conventional RAM
through `9FFFFh`. Its CMOS base-memory word is `0280h` and its configuration
checksum is `00C5h`. The receipt runner selects it with `AT_BASE_RAM_KB=640`;
the 512K profile remains the default for the earlier bounded POST evidence.

The DOS write and fresh-remount receipts use two separate machine runs. The
first run supplies `AT_BASE_RAM_KB=640`, the pristine external disk,
`AT_FLOPPY_OUTPUT`, `AT_EXPECT_FILE=ATBOOT.TXT`, expected text
`at-boot-ok\r\n`, and the scancode script
`<Enter><Enter>echo at-boot-ok>atboot.txt<Enter>type atboot.txt<Enter>`. The
second run mounts only that output disk, supplies its SHA-256 through
`AT_PRIOR_OUTPUT_SHA256`, and types
`<Enter><Enter>type atboot.txt<Enter>`. Acceptance requires the BIOS/FDC DMA
boot-sector transfer, the complete keyboard path, an exact standalone output
line and final `A>` prompt, FAT12 file bytes, and the media-hash link between
the two runs. The reboot phase never replays the file-creation command.

The profile includes cascaded 8259s, an 8254, RTC/CMOS, two 8237 register
files, the AT page-register latches, port 61h refresh/timer status, CGA, a
DMA-connected floppy controller, and the 8042 path used for A20 and CPU reset.
Controller commands use a deterministic two-stage model: the input buffer
accepts after 12 machine cycles and a response becomes available after 32.
These are stable model parameters, not measured 8042 timing. Status polling
never advances controller time. An 8042 `FEh` reset request
is queued until the current OUT instruction completes. It resets the CPU
without clearing RAM, CMOS, the controller system flag, A20, or machine time.
The attached bounded keyboard schedules its power-on BAT completion and the
`FAh`/`AAh` response sequence for an explicit `FFh` keyboard reset. The
profile uses 10 ms for ACK and 700 ms for BAT at 6 MHz, both inside the IBM
manual's stated response (within 20 ms) and BAT (600–900 ms) ranges. Toggling
the 8042 interface with `ADh`/`AEh` does not manufacture another BAT byte;
completed keyboard bytes remain held while the clock is disabled and are
released by `AEh`. An `FFh` BAT countdown starts when the ACK reaches the
enabled controller path, so a held ACK cannot make ACK and BAT arrive together.
Forwarding an `FFh` keyboard command also releases the keyboard clock, matching
the BIOS sequence that sends `FFh` after `ADh` without a separate `AEh`.
`E0h` reports both idle-high keyboard test inputs, with the
clock input low while disabled; serial clock/data transitions are not modeled.
The boot profile also declares the physical keyboard-inhibit switch unlocked,
which drives status bit 4 independently of the `ADh`/`AEh` interface state.
The second DMA controller currently supports BIOS register diagnostics only;
16-bit transfers, address shifting, and cascade behavior remain unsupported.

## External BIOS evidence

The repository does not distribute the BIOS. The bounded runner accepts the
external IBM 5170 Rev1 image dated 1984-01-10, exactly 65,536 bytes with
SHA-256 `74e7b36b4ec0adc5ac3277a887579996c1d2aa755b9892ef3afe7485c10ce04f`.
The pinned PCjs source revision is
`c7f21b4fa2bdedac3d5c73094a6402fdc8b24c70`; its ROM metadata identifies IBM
parts 6181028 and 6181029 and traces the dump to minuszerodegrees.net.

Run the receipt with Node 22:

```sh
AT_BIOS_ROM=/path/to/ATBIOS-REV1.rom node scripts/run-at-bios-post.mjs
```

The default two-million-instruction bound proves the real reset-vector fetch,
the BIOS checkpoint-30 path, an 8042 warm reset, and return through the CMOS
shutdown dispatch while preserving board state. It records source hashes and
the exact ROM hash. This is POST progression evidence, not a claim that POST,
disk boot, secondary-DMA transfers, or 80286 timing qualification is complete.
`AT_POST_MUTATION=dma-checkpoint` and
`AT_POST_MUTATION=reset-preservation` are strict negative controls: each must
produce a failing receipt by corrupting one acceptance fact after execution.

Primary hardware references are the *IBM Personal Computer AT Technical
Reference* (1984), system-board memory map and system-control schematics, and
Intel's *80286 and 80287 Programmer's Reference Manual* (1987), processor
initialization chapter.

The RTC calendar model follows Motorola's *MC146818A Real-Time Clock Plus RAM*.
While SET is asserted, the ten time/calendar registers retain the literal bytes
written by firmware. Clearing SET validates and decodes them using the final
DM and 12/24-hour format, because changing either format requires firmware to
reinitialize the affected registers. Setting SET also clears UIE. The bounded
model keeps day-of-week independently writable, advances its two-digit year on
a four-year cycle, and admits deterministic initial epochs only before 2100.
Day-of-week zero is retained literally and advances to one at midnight. This is
a deterministic bounded policy for firmware that writes zero outside the
documented 1-through-7 range, not a claim that zero is a valid calendar value.
Changing DM or 12/24-hour format outside SET refuses because the required
calendar reinitialization cannot be inferred. The model migrates valid
version-1 non-SET checkpoints; it refuses
version-1 checkpoints captured during an unrepresentable SET transaction.

Historical source-bound [POST receipt](receipts/2026-09-19-at-bios-post.json)
records execution at `d8ff0734e9283aa1ca5662bce70d6c8ad10da713`.
Both [negative controls](receipts/2026-09-19-at-bios-post-negative.json) reject
the same source when an acceptance fact is corrupted. The controller self-test
returns 55h; command-byte bit 2 controls the status system flag.

The earlier 512KiB [30M-step diagnostic](receipts/2026-09-19-at-post43-diagnostic.json)
mounts the hash-recorded DOS floppy and reaches genuine POST37/38 (keyboard
reset), then POST40/41/43 and INT19, without displayed POST errors. It does not
prove boot-sector execution: later samples enter the BIOS unexpected-hardware-
interrupt handler. That result is superseded by the explicit 640KiB run below:
the owned IO.SYS fixes SYSINIT at segment 9F84h, beyond the 512KiB RAM map.
Port 80h values alone are insufficient: DMA page-register tests also write
those values, so genuine checkpoints must include their firmware CS:IP.


## Accepted DOS disk boot and persistence

The [source-bound write/reboot evidence](../test/fixtures/at-dos-persistence-evidence.json)
records two fresh machines requalified at `439560e3dc02c9c11eb36afbe374859126e11e47`. The fixture retains the earlier c5 execution revision, step counts, media hash and raw-report hashes as historical provenance.
All 15 recorded CPU, device and harness hashes match the integrated stage.
The BIOS starts at physical FFFFF0h, completes POST and INT19, and loads the
mounted floppy through the FDC and DMA channel 2 into 0000:7C00. The machine
then executes the owned boot/IO.SYS glue and external Microsoft MS-DOS2.00
kernel with Command2.02. No firmware service is intercepted by the host.

The write run injects date/time Enter keys followed by
`echo at-boot-ok>atboot.txt` and `type atboot.txt` through the 8042 keyboard
path. It finishes after 24,406,016 instructions. The fresh reboot mounts the
saved image and injects only date/time Enter keys and `type atboot.txt`;
it finishes after 24,318,976 instructions. Both display a standalone
`at-boot-ok` line and return to the final `A>` prompt. The FAT12 file is
exactly `at-boot-ok\r\n` (12 bytes), and the saved-image SHA-256 matches the
second machine's input:
`6d0b480a26daeb20d8a017c20d5ab5ba09926a75c5b73f311e270211f16c8c69`.

The ordinary evidence test checks reset, 640KiB RAM, source binding, DMA
address/count/terminal-count state, boot-sector hash, keyboard consumption,
file bytes, final prompt and linked media. It rejects mutations to file
contents, output, DMA completion, keyboard evidence and reboot media identity.
The raw reports are represented by their hashes and retained grading fields;
ROM and disk images remain external. This qualifies the named DOS boot and
persistence workload on this functional AT profile. It does not qualify all
AT peripherals, Windows, Doom, or physical bus/cycle timing.

## FreeDOS 1.4 diagnostic

The compact [FreeDOS diagnostic](receipts/2026-09-19-freedos14-diagnostic.json) binds the untouched official 1.2MiB image, Node 22 execution at `439560e`, and all executed source hashes. It reaches INT19, verifies the loaded boot sector, and displays the FreeCom 0.86 interface within a 40-million-instruction ceiling without a host refusal, shutdown, halt, or unexpected interrupt. No final shell prompt or keyboard interaction was observed, so `fullBootAccepted` remains false. This is bounded boot progression rather than a failed or accepted installation.

The separate `scripts/run-freedos14-at-acceptance.mjs` runner recognizes the
installer's displayed “Do you want to proceed” prompt and injects `N` through
the real 8042 keyboard route. That follows SETUP.BAT's `UserAbortExit` path;
no partition, format, copy, or other installation action is selected. Only
after the returned `A:\>` prompt does it inject the requested shell command.
It records one-million-instruction UI and BIOS keyboard-ring samples so a
bounded run distinguishes slow logo/menu drawing from a stable wait. Write
acceptance requires exact FAT12 file bytes and a final prompt; persistence
requires a fresh machine mounting the saved-image hash and issuing only the
read command.
Guest HLT is not a stop condition in this runner: the machine advances to its
next device deadline and may wake on an interrupt. Architectural shutdown
remains a hard diagnostic stop.

## Accepted FreeDOS 1.4 shell persistence

The [source-bound FreeDOS evidence](../test/fixtures/freedos14-at-persistence-evidence.json)
uses the unchanged official 1.2MiB image. The first fresh machine waits for the
installer's real prompt, injects `N` and Enter through the 8042, and observes
FreeDOS's explicit aborted-install message before reaching the shell. It then
runs `echo fd-boot-ok>fdboot.txt` and `type fdboot.txt`. The FAT12 root file is
exactly `fd-boot-ok\r\n`, and the output image SHA-256 is
`1462a0fa85bfe9920250725bbface8c637e66d49bad17793e0da01b2e9bc9815`.

A second fresh machine admits that image only through the accepted write report,
repeats the no-install choice, observes the live prompt cursor, and injects only
`type fdboot.txt`. It displays the exact standalone line and returns to a final
standalone `A:\>` prompt. The two raw reports retain their actual, separately
source-bound harness revisions; the reboot receipt binds the current pure
acceptance grader and rejects key, cursor, DMA, file, output and media-link
mutations. No installer partition, format or copy action executes.

## Next platform boundaries

A Doom-class target needs a separate opt-in machine profile with at least 4MiB
installed RAM and matching CMOS/BIOS memory evidence; the accepted 286 profile
remains 640KiB conventional plus 512KiB extended. The repository has no
AT-compatible hard-disk controller, while the executable and WAD exceed floppy
capacity. A real sector-I/O path therefore needs an ATA/WD1003-style controller
at 1F0h with IRQ14, bootable FAT media, and native 16-bit data-register I/O;
splitting that access across adjacent byte ports would incorrectly hit 1F1h.

The existing VGA device supplies register, DAC, retrace and linear mode-13h
behavior. It does not interpret planar memory or unchained page flipping, and
the IBM CGA BIOS does not initialize a VGA card. A later Doom platform needs a
licensed external VGA ROM/INT10 path plus the planar/Mode-X behavior required
by the selected unchanged binary. These are concrete missing platform pieces,
not capabilities implied by the current 386 CPU or AT adapter.

The combined [platform receipt](receipts/2026-09-19-at-freedos-386-platform.json)
records the FreeDOS evidence audit, functional 386 pacing checks and the
separate larger-memory BIOS diagnostic. The latter remains incomplete.
