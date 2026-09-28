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

The adapter's synthetic all-media test establishes ROM placement, FDC/HDD
attachment, reset, keyboard delivery, and the VGA frame surface. A GUI Doom
acceptance still requires the actual circuits/widgets/code host to select this
preset, attach the pinned private inputs, enter the short-demo command via
set-1 make/break events, and observe the completion line, DOS prompt, and
audited 320×200 frame specified in [I80386-DOOM.md](I80386-DOOM.md). The
browser must supply the media bytes; no original Doom file is bundled here.
The Lite host still needs to expose/select `freedos-vga` and supply all four
media slots; no actual GUI Doom keyboard/run/render replay has been accepted.
The widget has no mouse forwarding. Generic DOSBox `imgmount -size` CHS is
handled by the CLI AT parser but is not yet honored by the browser adapter,
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
