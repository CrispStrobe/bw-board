# Experimental AT boot profile

External licensed-guest notes and historical context are retained in the [private documentation archive](https://github.com/CrispStrobe/brickwright-firmware-private/tree/master/public-documentation-archive/2026-10-04). Public examples and instructions use freely licensed or freeware software.

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

## Firmware provenance and references

The historical proprietary ROM input pins, POST commands, negative controls
and diagnostic progression are retained in the
[private firmware notes](https://github.com/CrispStrobe/brickwright-firmware-private/blob/master/docs/LEGACY-PC-FIRMWARE.md)
and exact original archive. They are not free BIOS examples. The free-software
acceptance below retains its recorded external-firmware dependency; it does
not establish that a freely licensed replacement BIOS was tested on this 286
profile. The separate 386 GUI recipe uses bundled LGPL firmware when omitted
by the user; see [the loading guide](X86-LOADING-GUIDE.md).

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

The controller self-test returns 55h; command-byte bit 2 controls the status
system flag. Earlier firmware POST observations and their exact instruction
addresses remain private. The owned IO.SYS places SYSINIT at segment 9F84h,
beyond the 512KiB RAM map, so the accepted disk boot uses the 640KiB profile.

## Accepted DOS disk boot and persistence

The [source-bound write/reboot evidence](../test/fixtures/at-dos-persistence-evidence.json)
records two fresh machines requalified at `439560e3dc02c9c11eb36afbe374859126e11e47`. The fixture retains the earlier c5 execution revision, step counts, media hash and raw-report hashes as historical provenance.
All 15 recorded CPU, device and harness hashes match the integrated stage.
The recorded external firmware dependency is described privately above. The
receipt requires a real FDC/DMA boot-sector transfer into 0000:7C00. The machine
then executes the owned boot/IO.SYS glue and MIT-released Microsoft MS-DOS2.00
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
contents, output, DMA completion, keyboard evidence and reboot media identity. The raw reports are represented by their hashes and retained grading fields;
ROM and disk images remain external. This qualifies the named DOS boot and
persistence workload on this functional AT profile. It does not qualify all
AT peripherals, broader guest, broader game, or physical bus/cycle timing.

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

## Profile boundaries

The 286 profile documented here uses floppy/FDC media. It does not inherit the separate experimental 386 AT profile's ATA hard disk, larger memory or VGA behavior. Select the appropriate board and media loader explicitly; see [the loading guide](X86-LOADING-GUIDE.md). Earlier missing-platform observations in the private historical archive describe their dated source, rather than current repository-wide capabilities.

The combined [platform receipt](receipts/2026-09-19-at-freedos-386-platform.json)
records the FreeDOS evidence audit, functional 386 pacing checks and the
separate larger-memory BIOS diagnostic. The latter remains incomplete.
