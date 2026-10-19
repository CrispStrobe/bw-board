# G-Pascal ROM (vendored)

`gpascal.bin` — Nick Gammon's G-Pascal v4.07: an on-board Pascal
compiler, 65C02 assembler and text editor for the Ben Eater 6502 board
with the VIA at $7FF0 and bit-banged 4800-baud serial on PA0/PA1/CB2.

- Source: <https://github.com/nickgammon/G-Pascal> (`bin/gpascal.bin`,
  unmodified).
- License: MIT (see LICENSE beside this file) — vendorable and
  shippable, unlike the Acorn-heritage BBC BASIC ROM which stays
  run-local.
- Machine config: the `GPASCAL` preset in `src/m6502-machine.js`.
