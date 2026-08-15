# bw-board handoff — 2026-08-15

**1784 tests, 0 failures (12 skips).** All pushed to master and main.

## Completed this session (session 8)

- **TWI/SPI transaction bridge** (`src/twi-bridge.js`, `src/spi-bridge.js`, `src/avr8js-adapter.js`): AVRTWI + AVRSPI instantiated for ATmega328P/ATmega2560. TWI bridge routes hardware Wire transactions to the same I2C handler objects the bit-bang engine uses — one behavior, two transports. AT24C02/DS3231/MPU6050/SSD1306 refactored to expose `state.i2cHandlers`. `BoardImpl.getI2CHandlers()` discovers them. Validated with compiled Arduino sketches: RTClib (hour=12/min=30/sec=0), i2cdevlib MPU6050 (az=16384 for flat), Adafruit SSD1306 (64 lit pixels). 11 tests.
- **ILI9341 v2** (`src/devices/ili9341.js`): display inversion (0x20/0x21), vertical scroll (VSCRDEF+VSCRSADD), MADCTL BGR bit in ili9341Rgba, RAMRD 0x2E with dummy-byte rule, 17 power/gamma vendor opcodes as named no-ops clearing unknown[]. 5 new oracle tests, Adafruit fixture stays green.
- **ILI9341 8080-parallel mode** (`ili9341_par`): 8-bit data bus D0-D7 with WR/RD/RS/CS strobes. Shared command/pixel logic refactored into helpers. RD strobe drives bus for RAMRD readback. 8 parallel-path oracle tests mirror the SPI ones. 19 ILI9341 tests total.
- **DFPlayer Mini + ZE08-CH2O** (`src/devices/uart-frame.js`): UART frame-protocol devices on the edge engine. DFPlayer: 9600 8N1, 10-byte frames with two's complement checksum, play/pause/next/prev/volume/playTrack/reset, query replies, busy pin active-low. ZE08: periodic 9-byte frames at ~1 Hz, params.ch2o_ppb stimulus. 16 golden tests.
- **vcc params.volts** (`src/board.js`, `src/mna.js`): per-part rail voltage override in all 3 solve paths (closed-form, MNA stamp, pre-solve). 2 oracle tests.
- **henrys fix regression** (`src/mna.js`): MNA inductor stamp reads henrys (canonical) with henries fallback. Flyback regression test: 1mH vs 100mH produce measurably different peaks (6.286 vs 6.596 V).
- **dc_motor R alias + windingH** (`src/devices/dc-motor.js`): params.R accepted as alias for windingR (3 gallery circuits used R). params.windingH adds series winding inductance (default 5 mH). 4 oracle tests.
- **MC6845 CRTC** (`src/mc6845.js`): Z80 tier video chip, clean-room from Motorola datasheet. R0-R17 via address/data port pair, start address (R12/R13), cursor (R10/R11/R14/R15), text rendering via charset param, videoFrame() contract matching TMS9918/SimpleVGA. 16 golden tests.

## Completed previously (session 5-7)

- ATmega2560/ATtiny85/ATtiny88 adapter variants, Eater 6502 wiring, input-pulldown PinMode
- AVR PWM observation, rp2040js feasibility, board-kind power pins
- parseIntelHex, AVR cross-check, debug-target-factory, scope channels
- 111+ part kinds, LED brightness, CC mode, DRC, twin-implementation docs

## In flight

| File | Intent | Next step |
|------|--------|-----------|
| Ledger (`stc/docs/VERIFICATION-LEDGER.md`) | AVR row now cat 1. | Update ledger row. |
| `spec-updates/rst-polarity.md` | RST active HIGH on STC12. | Per-family polarity table needed. |
| `spec-updates/rp2040js-feasibility.md` | Adapter + debug target landed. | rp2040js PWM oracle tests. |

## Standing rules

- Push at every checkpoint. Notify blocked agents by name when you clear their blocker.
- No positioning in committed content. Licence audit names are kept.
- `free -m` before anything heavy. Check `~/.cache/ms-playwright` before installing.
- Assert the property, not the symptom. A check that has never failed has not been shown to work.
- Nothing has run on real silicon. Categories 1/2/3 per `stc/docs/EVIDENCE-CATEGORIES.md`.
