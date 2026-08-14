# Third-party code and references

## Shipped third-party code

| project | licence | relationship |
|---|---|---|
| janroesner/sixty5o2 | MIT | Bootloader + hello_world ROM for EATER6502 preset, ported to ca65. Source and binaries in `rom/sixty5o2/` |
| mike42/6502-computer | CC-BY-4.0 | HB6502 machine preset derived from hardware design (address decode, clock, chip selection). No code copied; wiring facts only |
| treideme/stc89c52-demos | Apache-2.0 | 16 SDCC demos for HC6800-ES learning board, compiled to IHX in `rom/stc89c52-demos/`. Cross-check corpus for 8051 device models |

## Runtime dependencies

| project | licence | relationship |
|---|---|---|
| wokwi/avr8js | MIT | AVR MCU emulator (npm dependency) |

## Test-time references (not shipped)

| project | licence | relationship |
|---|---|---|
| blinkenrocket-firmware | LGPL-3 OR BSD-3 per file | Built (avr-gcc) for ATtiny88 smoke tests; BSD-3 licence elected; binary loaded at test time only, not shipped |
| mike42/6502-computer ehBASIC | NC (Lee Davidson) | Boot script in test/hb6502-ehbasic-boot.mjs; ROM never committed or shipped |

## References studied (not copied)

| project | licence | relationship |
|---|---|---|
| wokwi/avr8js | MIT | Reference architecture for MCU ⇄ board coupling |
| wokwi/wokwi-elements | MIT | Potential source of part visuals (future) |
| pfalstad/circuitjs1 | GPL-2.0 | Studied interaction design only; no code taken |
| jarikomppa/emu8051 | MIT | logicboard.c studied for board-view concept |

## Licence constraint

Everything in this repository is MIT-licensed. No GPL/LGPL/copyleft code
may be incorporated. See `CLAUDE.md` for the full policy.
