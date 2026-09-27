# Windows 3.1x enhanced-mode diagnostic

`scripts/probe-i80386-windows-enhanced.mjs` is a read-only, media-neutral boot
probe for an externally supplied, installed Windows 3.1/3.11 hard-disk image.
It deliberately never sets `windowsEnhancedAccepted` to true. The report records
the first protected-mode, paging, and VM86 observations separately, plus bounded
POST, keyboard, text checkpoints, CPU refusal and VGA hashes. A mode bit alone
does not prove that Windows reached Program Manager or that a DOS box works.

Supply an exact SHA-256 for each input and the image's physical CHS geometry.
The current probe uses the 4 MiB VGA AT profile. Use IBM drive type 2 only for a
615/4/17 image; type 47 needs firmware that supports user geometry. The image
must boot DOS and contain `WIN386.EXE`; arrange for `WIN /3` in `AUTOEXEC.BAT`,
or send Set-1 make/break events after DOS reaches its prompt with
`AT_KEY_SCRIPT=/path/to/events.json`. The script is an ordered JSON array of
`{"step": integer, "code": byte}` objects. `checkpoints` help choose the step;
set `AT_PROGRESS_OUTPUT=/path/to/progress.json` to inspect the latest checkpoint
while a long run is still active. `AT_PROGRESS_EVERY` defaults to one million
instructions. The progress file is atomically replaced at each checkpoint.
Disk writes stay in the in-memory image clone.
Both the 32 KiB SeaVGABIOS variant and the vendored 38.4 KiB Bochs VGA BIOS
fit the probe's option-ROM mapping. A two-million-instruction type-47/Bochs
smoke run with the existing Windows 3.0 disk reached its budget without a host
refusal; that short run establishes input wiring only, not a DOS or Windows
boot. The Windows 3.0/type-2 IBM BIOS path has the separate accepted desktop
receipt.

```sh
AT_BIOS_ROM=/path/to/at-bios.rom AT_BIOS_SHA256=<64-hex> \
VGA_BIOS_ROM=/path/to/vga-bios.bin VGA_BIOS_SHA256=<64-hex> \
AT_HDD_IMAGE=/path/to/installed-win31.img AT_HDD_SHA256=<64-hex> \
AT_HDD_GEOMETRY=615,4,17 AT_HDD_CMOS_TYPE=2 \
AT_POST_STEPS=150000000 \
node scripts/probe-i80386-windows-enhanced.mjs > /tmp/win31-probe.json
```

Before treating a run as compatible, identify the Windows version and
`WIN386.EXE` in the *input* image; inspect the VGA output; demonstrate a live
keyboard-driven Windows application and a DOS box; then reboot a cloned disk
and verify a saved file. Record the media, BIOS, code revision, and output
hashes outside the repository. Windows 3.0 standard-mode evidence is documented
separately in [I80386-WINDOWS300.md](I80386-WINDOWS300.md).

There is no suitable Windows 3.1x input among the project test media currently
identified. The existing Windows 3.0 image has no `WIN386.EXE`. The previously
referenced Internet Archive `win3_stock` item is marked access-restricted and
stream-only; its page does not provide a reusable raw hard-disk fixture. Keep
Microsoft media outside this MIT repository.
