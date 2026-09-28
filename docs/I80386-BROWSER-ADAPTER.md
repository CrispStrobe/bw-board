# Experimental 80386 browser adapter

`createDebugTarget('i80386', opts)` is the browser-facing entry point for the
opt-in AT machine. It returns the same `{ target, adapter }` shape as the other
debug targets. The target exposes `video()` and `keyIn()` so the existing
`VdpScreen` in the circuits/widgets/code surface can render the guest VGA frame
and route IBM PC set-1 keyboard events through `target.keyIn()` (or the adapter's
`sendScancode()`). `MediaPanel` receives its slots from
`describeMedia('i80386')` and can load BIOS, VGA ROM, ATA/floppy bytes, and a
DOSBox config.

The original Doom/FreeDOS board is an explicit `createDebugTarget('i80386',
{profile: 'freedos-vga'})` preset. The browser media slots load the AT BIOS at
both F0000h and the high reset alias, the VGA option ROM in C0000h–C9FFFh
(40KiB, including the 38,400-byte Bochs ROM), a type-1 306×4×17 HDD, and an
80×2×15 1.2MB FreeDOS floppy. The floppy loader also accepts 360KB 40×2×9
images and copies input bytes before the guest can write them. Apply all four
media slots, reset the machine, then run it through the target. The preset is
opt-in; the generic 386 target still uses the smaller CGA board.
The named browser preset also enables the 8042 PS/2 auxiliary mouse and
advertises it in CMOS equipment byte 14h; `adapter.mouseIn({dx, dy, buttons})`
delivers a packet only after guest software enables mouse reporting. The
exported AT/VGA machine profile used by CLI probes, and smaller defaults,
remain mouse-disabled.
The browser preset sets Bochs-compatible CMOS boot order A: then C: while
retaining the IBM type-1 fixed-disk geometry; this boot-order byte is outside
the CMOS checksum range.

The adapter's synthetic all-media test establishes ROM placement, FDC/HDD
attachment, reset, keyboard delivery, and the VGA frame surface. The
[headless browser-target FreeDOS receipt](receipts/2026-09-28-i80386-browser-target-freedos.json)
then boots the pinned external FreeDOS floppy with vendored LGPL firmware via
`createDebugTarget`, `applyMedia`, `target.runFor`, `target.keyIn`, and
`target.video`. Its 45.8-million-step settled A: prompt and C: directory
screen exactly match the ordinary CLI receipt. The Lite Machine Manager now
exposes the named `freedos-vga` profile and accepts its floppy, hard disk,
BIOS, and VGA ROM slots. A real Chromium run with the pinned FreeDOS 1.4 floppy
and type-1 FAT16 hard disk reached the installer question, accepted physical
keyboard input through the Widgets canvas, returned to `A:\>`, and displayed
`dir c:` with the hard-disk marker. This proves the GUI media, video, and
keyboard path for that bounded run. The optional real-media acceptance script
is in the Lite repository; the media and screenshots remain external.

A [strict Lite Chromium replay](https://github.com/CrispStrobe/brickwright-lite/blob/main/docs/receipts/2026-09-28-i80386-doom-widgets-browser.json)
has now attached the pinned private Doom inputs through Machine Manager,
entered the owned short-demo command through the Widgets keyboard, observed
the completion line and returned DOS prompt, and matched the guest 320×200
frame to the visible Widgets canvas. See [I80386-DOOM.md](I80386-DOOM.md).
No original Doom file is bundled here; this is one bounded GUI run.
Generic DOSBox `imgmount -size` CHS is handled by the CLI AT parser but is not
yet honored by the browser adapter,
which infers 4 heads and 17 sectors; the pinned short-demo HDD has that CHS.

The profile remains explicitly experimental. No production machine default is
changed, and checkpoint support is still refused by the 386 machine until its
architectural state is covered.

DOSBox configs are handled declaratively by `parseDosboxConfig()` and
`resolveDosboxMedia()`. `mount` of a host directory is reported as a refusal;
`imgmount` and `boot` names resolve only against files the host supplied. The
browser never executes `autoexec` commands. Primary HDD `imgmount 2` is
resolved as drive C; `boot -l c` selects that drive rather than naming another
image. Conflicting mounts for the same drive are refused.
