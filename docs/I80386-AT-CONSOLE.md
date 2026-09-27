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
three-byte PS/2 device to the 8042 auxiliary port. Its bytes set status bit 5
and raise IRQ12 when enabled by the controller command byte. The host
`machine.mouseIn({dx,dy,buttons})` API returns `false` until the guest enables
the aux port and mouse reporting, or if its output queue lacks space. Mouse
reset, identify, enable/disable, sample rate, resolution, stream/remote mode,
status, and read-data commands are modeled. Defaults remain keyboard-only;
existing BIOS profiles and checkpoint shape retain the absent-mouse behavior.

The event receipt records whether the device accepted each event. Its source
and external media hashes make the run reproducible. This is an input/control
path, not a Windows 3.1 enhanced-mode acceptance claim.
