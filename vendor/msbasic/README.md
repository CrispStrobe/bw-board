# Microsoft BASIC V1.1 ROM (vendored)

`basic.rom` — Microsoft's 1976-78 BASIC for the 6502 (the MIT archival
release of BASIC-M6502), ported to ca65 with an own W65C51 ACIA I/O
shim, built for the EATER6502 preset (32 KB ROM at $8000).

- Port source: `basic-m6502-bw` (VPS: /mnt/volume1/code/basic-m6502-bw;
  KIM-1 REALIO base, own serial routines).
- Upstream: <https://github.com/microsoft/BASIC-M6502> (MIT,
  Copyright Microsoft Corporation).
- License: MIT throughout (see LICENSE beside this file) — vendorable
  and shippable; this fills the shippable-BASIC slot on the 6502 the
  roadmap adjudicated 2026-08-14.
