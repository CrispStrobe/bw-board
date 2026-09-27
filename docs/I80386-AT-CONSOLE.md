# Experimental 386 AT command-line console

`scripts/run-i80386-at-console.mjs` runs the opt-in 386 AT with externally
supplied BIOS, VGA ROM, and hard-disk bytes. It reports serial output, the
current 25-row VGA text RAM, CPU state, and hashes of all four VGA planes. An
optional full VGA snapshot records the registers and plane bytes for a separate
renderer. Text RAM is a diagnostic view; in graphics modes it is not the
visible screen. The runner keeps the HDD in memory and does not write it back.

Set `AT_BIOS_ROM`, `VGA_BIOS_ROM`, and `AT_HDD_IMAGE` to local files, with their
respective `AT_BIOS_SHA256`, `VGA_BIOS_SHA256`, and `AT_HDD_SHA256` values. Set
`AT_HDD_GEOMETRY` to `cylinders,heads,sectors` matching the image length.
`AT_HDD_CMOS_TYPE` may be `2` for the IBM 615,4,17 geometry or `47` for the
user geometry. The default follows the geometry. For example:

```sh
AT_BIOS_ROM=/path/to/at-bios.bin AT_BIOS_SHA256=<sha256> \
VGA_BIOS_ROM=/path/to/vga.rom VGA_BIOS_SHA256=<sha256> \
AT_HDD_IMAGE=/path/to/disk.img AT_HDD_SHA256=<sha256> \
AT_HDD_GEOMETRY=615,4,17 AT_POST_STEPS=1000000 \
AT_CONSOLE_EVENTS=/path/to/events.json \
AT_CONSOLE_REPORT=/path/to/report.json \
AT_CONSOLE_VGA_OUTPUT=/path/to/vga.json \
node scripts/run-i80386-at-console.mjs
```

The optional events file is an ordered JSON array. Same-step events retain
array order. Keyboard `code` is a Set-1 scan byte, serial `code` is one byte,
and mouse movement uses screen coordinates (positive `dy` moves down). Mouse
`buttons` is a bit mask: left 1, right 2, middle 4.

```json
[
  {"step": 12000000, "type": "key", "code": 28},
  {"step": 12000001, "type": "key", "code": 156},
  {"step": 15000000, "type": "mouse", "dx": 6, "dy": 3, "buttons": 1},
  {"step": 15000001, "type": "mouse", "dx": 0, "dy": 0, "buttons": 0}
]
```

The mouse is opt-in: a mouse event, or `AT_ENABLE_MOUSE=1`, adds a standard
three-byte PS/2 device to the 8042 auxiliary port and advertises its presence
through CMOS equipment byte 14h bit 2. Its bytes set status bit 5
and raise IRQ12 when enabled by the controller command byte. The host
`machine.mouseIn({dx,dy,buttons})` API returns `false` until the guest enables
the aux port and mouse reporting, or if its output queue lacks space. Mouse
reset, identify, enable/disable, sample rate, resolution, stream/remote mode,
status, and read-data commands are modeled. Defaults remain keyboard-only;
existing BIOS profiles and checkpoint shape retain the absent-mouse behavior.

The event receipt records whether the device accepted each event. Its source
and external media hashes make the run reproducible. This is an input/control
path, not a Windows 3.1 enhanced-mode acceptance claim.

## Live terminal

Add `--live` (or `AT_CONSOLE_LIVE=1`) to draw the guest continuously in an
alternate terminal screen. The runner yields between 50,000-instruction
chunks so terminal input reaches the guest while it runs. Typing sends Set-1
make/break pairs; Enter, Backspace, Tab, Escape, arrows, shifted letters and
symbols, Ctrl+letter, and terminal Alt+printable chords are mapped. Ctrl+] quits
cleanly; Ctrl+L redraws.
An xterm-compatible terminal with SGR mouse reporting can send pointer clicks
and motion; live mode attaches the opt-in mouse. The live view tries the validated VGA renderers (Windows
640×350 and 640×480 planar, and Doom 320×200 unchained), then shows text RAM if the mode is
not recognized. A full VGA snapshot remains available in every mode. Live
mode requires a TTY. The report includes live input attempts and a `user-quit`
stop reason when applicable.

```sh
# With the same BIOS/VGA/HDD environment shown above:
node scripts/run-i80386-at-console.mjs --live --steps 500000000
```

## DOSBox image configurations

The CLI accepts a raw HDD directly with `--hdd-image FILE --geometry C,H,S`,
or reads one `imgmount` from a DOSBox config with `--dosbox-conf FILE`.
Relative image paths resolve beside the config. The accepted form follows the
[DOSBox manual's IMGMOUNT geometry](https://www.dosbox.com/DOSBoxManual.html):

```ini
[autoexec]
imgmount 2 "Windows 3.1.img" -t hdd -fs none -size 512,17,4,615
boot -l c
```

The `-size` tuple is bytes per sector, sectors per track, heads, cylinders;
the CLI converts it to its internal cylinder/head/sector order and checks the
image byte length. Only one primary HDD image is attached. Folder mounts and
other autoexec lines are recorded as ignored; no host commands are executed.
BIOS and VGA ROM inputs are still required. `AT_HDD_SHA256` remains required
for the selected image. This runner boots the image through its own AT BIOS,
even when a DOSBox config would instead start at DOSBox's built-in shell.
