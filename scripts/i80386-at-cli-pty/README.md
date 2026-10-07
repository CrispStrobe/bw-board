# Owned live-terminal fixture (source checkpoint)

This directory prepares a source-owned 306×4×17 FAT16 HDD for the existing
`run-i80386-at-console.mjs --live` route. Its boot sector prints `PTY READY> `
through BIOS INT 10h, waits for three BIOS INT 16h keys, echoes the returned
ASCII bytes through INT 10h, prints ` PTY DONE`, and idles. It does not contain
DOS, FreeDOS or any external guest software. The disk is generated on demand;
its bytes are not committed.

Run the bounded source control with no guest or media:

```sh
node --test scripts/i80386-at-cli-pty/owned-hdd-control.mjs
python3 -B scripts/i80386-at-cli-pty/live-pty-control.py
```

The source control pins the resulting boot-sector and whole-image hashes,
checks the 55AA signature and preserves the parent FAT16 BPB and every
nonboot disk byte. This does **not** prove the free Bochs BIOS boots the
sector, that `--live` delivers keys, or that host terminal state is restored.
Those require a later exact-source PTY execution with the bundled free BIOS
and VGA ROM, original terminal transcript and final console report.

`live-pty.py` is the proposed real PTY driver. Its exact-role JSON input names
the clean source head, Node executable, free BIOS and VGA ROM paths and hashes,
owned HDD path and pinned image hash, geometry and fresh output directory.
It starts the unchanged console in a private 100-column PTY, waits for a
rendered READY frame before sending `abc`, requires a later rendered DONE
frame, forces a distinct Ctrl-L redraw, sends Ctrl-] to quit, and checks the
original console report's six accepted Set-1 make/break bytes. It compares
terminal attributes before and after, requires an empty process group, and
retains a bounded raw transcript plus the first failure. The driver is
**unrun against the guest** in this source checkpoint.

The planned PTY acceptance sends three visible keys only after an actual
`PTY READY>` frame, requires `PTY READY> abc PTY DONE` in a later rendered
frame, sends Ctrl-L and requires a fresh retained frame, then sends Ctrl-]
and requires `stop=user-quit`, accepted Set-1 make/break codes, a clean exit,
and restored canonical/echo terminal attributes. It must bound output,
instruction count, wall time and process group, and retain the first failure.
Queued host bytes or a source-only test cannot substitute for guest pixels.

The existing 386 CLI takes a raw HDD and BIOS/VGA files; it has no floppy
attachment option. The prior browser FreeDOS floppy plus marker HDD is not
the same media route. The separate DOSBox importer admits only one raw HDD
with CHS geometry. ZIP admission, ISO/CD-ROM, VHD decoding and disk export
remain separate work.
