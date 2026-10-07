# Owned live-terminal acceptance

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
The actual PTY result below supplies separate guest execution evidence with
the bundled free BIOS and VGA ROM, original transcript and console report.

`live-pty.py` is the real PTY driver. Its exact-role JSON input names
the clean source head, Node executable, free BIOS and VGA ROM paths and hashes,
owned HDD path and pinned image hash, geometry and fresh output directory.
It starts the unchanged console in a private 100-column PTY, waits for a
rendered READY frame before sending `abc`, requires a later rendered DONE
frame, forces a distinct Ctrl-L redraw, sends Ctrl-] to quit, and checks the
original console report's six accepted Set-1 make/break bytes. Ambient `AT_*`
variables are removed so a scheduled input file cannot supply those keys.
It compares
terminal attributes before and after, requires an empty process group, and
retains a bounded raw transcript plus the first failure.

The dedicated `i80386-at-cli-pty-actual.yml` workflow runs only when an
owned pull request receives the `x86-cli-pty-actual` label. It checks out the
exact pull-request head, uses the repository's hashed LGPL BIOS and VGA ROM,
generates the owned HDD, then runs the real console through a 100-column PTY.
The original transcript and console report stay in a bounded artifact, along
with the first failure if acceptance stops. The driver checks the original
console's ordered alternate-screen, cursor, mouse and focus-report setup and
cleanup bytes as well as restored PTY attributes. The workflow does not
upload the disk or ROM binaries.
The driver samples the live child's RSS and also checks the Linux kernel's
reaped-children peak RSS before accepting a result, so a short peak between
samples still fails the bound. Cleanup errors are retained separately and
cannot replace the original guest failure.

The PTY acceptance sends three visible keys only after an actual
`PTY READY>` frame, requires `PTY READY> abc PTY DONE` in a later rendered
frame, sends Ctrl-L and requires a fresh retained frame, then sends Ctrl-]
and requires `stop=user-quit`, accepted Set-1 make/break codes, a clean exit,
and restored canonical/echo terminal attributes. It must bound output,
instruction count, wall time and process group, and retain the first failure.
Queued host bytes or a source-only test cannot substitute for guest pixels.

The [actual run 37641845715, attempt 2](https://github.com/CrispStrobe/bw-board/actions/runs/37641845715/attempts/2)
passed at tested source `f03b51bf2475bc77a50af8c43c87512c0317c6fb`.
Two independent stdlib readers audited the original artifact without importing
the producer parser or replaying the guest: five terminal frames, READY in
frame 3, guest DONE in frame 4, redraw in frame 5, six accepted Set-1 events,
2,450,000 steps, user quit and restored terminal attributes. Attempt 1 failed
runner acquisition before execution and remains preserved. The
[public result documentation](https://github.com/CrispStrobe/bw-board/pull/436)
records the artifact identity and limits. This README update changes no
executable source; the actual result qualifies this owned BIOS keyboard/text
fixture, not general DOS, mouse, extender or performance behavior.

The existing 386 CLI takes a raw HDD and BIOS/VGA files; it has no floppy
attachment option. The prior browser FreeDOS floppy plus marker HDD is not
the same media route. The separate DOSBox importer admits only one raw HDD
with CHS geometry. ZIP admission, ISO/CD-ROM, VHD decoding and disk export
remain separate work.
