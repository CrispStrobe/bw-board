# Free (LGPL) AT/386 firmware — redistributable

This directory vendors the free, redistributable firmware that lets the
experimental 80386 AT machine POST, boot, and run an operating system with
**no proprietary ROM**. Both binaries are licensed under the GNU LGPL and are
shipped here unmodified so the free-BIOS 386 qualification
(`scripts/run-i80386-free-bios-freedos.mjs`) is reproducible by anyone, with no
secret input.

These replace the copyrighted IBM 5170 (AT) system ROM and the proprietary VGA
option ROM, which remain an **optional** maintainer-only fidelity oracle
(`AT_BIOS_ROM` / `VGA_BIOS_ROM`, never committed).

## Contents

| File | Bytes | SHA-256 | What it is |
| --- | --- | --- | --- |
| `BIOS-bochs-legacy` | 65536 | `6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac` | Bochs 2.7 legacy system BIOS (`(c) 2001-2021 The Bochs Project`). Loaded at `0xF0000` (and the 386 high alias `0xFF0000`). |
| `vgabios-lgpl.bin` | 38400 | `76af53f14955df3edd6365daa64393e91fafe55241c2c00384ff05b740431da1` | LGPL VGABios (`Bochs VGABios (PCI)`, `$Id: vgabios.c 288 2021-05-28`). Loaded at `0xC0000` as the video option ROM. |

Version strings, verbatim from the binaries:

- `Bochs 2.7 BIOS - build:` / `(c) 2001-2021  The Bochs Project`
- `Bochs VGABios (PCI)` / `(C) 2002-2021 the LGPL VGABios developers Team` /
  `This VGA/VBE Bios is released under the GNU LGPL` /
  `VGABios $Id: vgabios.c 288 2021-05-28 19:05:28Z vruppert $`

## Upstream / provenance

- Bochs legacy BIOS — part of the Bochs x86 emulator (LGPL).
  <https://bochs.sourceforge.io/> · source `bios/rombios.c`. This is the
  prebuilt `BIOS-bochs-legacy` distributed with Bochs 2.7.
- LGPL VGABios — the VGABios project (LGPL).
  <https://savannah.nongnu.org/projects/vgabios/> ·
  <http://www.nongnu.org/vgabios/>. Revision `288` (2021-05-28).

## Licence

GNU Lesser General Public License. See `LICENSE` in this directory for the LGPL
v2.1 text, which covers both binaries. Redistribution of these unmodified
binaries alongside their licence is permitted by the LGPL; that is why they ship
in this repository (unlike the IBM ROMs, which are copyrighted and are never
committed).
