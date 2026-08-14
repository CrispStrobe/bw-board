# Third-party code and references

This project contains no third-party code at present.

## Runtime dependencies

| project | licence | relationship |
|---|---|---|
| wokwi/avr8js | MIT | AVR MCU emulator (npm dependency) |

## Test-time references (not shipped)

| project | licence | relationship |
|---|---|---|
| blinkenrocket-firmware | LGPL-3 OR BSD-3 per file | Built (avr-gcc) for ATtiny88 smoke tests; BSD-3 licence elected; binary loaded at test time only, not shipped |

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
