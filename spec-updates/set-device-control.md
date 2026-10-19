# Spec-update: setDeviceControl — the write counterpart of getDeviceState

## Problem

The devices extension's entire actuator surface calls
`board.setDeviceControl(partId, verb, value)` behind a truthiness guard —
and **no board ever defined that method**. lcdprint, lcdcursor, lcdclear,
setservo, setmotor, setdirection, setrelay, activate, deactivate,
setneopixel, clearneopixels: every one is a silent no-op in the simulator
path (found 2026-08-23 while scoping the missing OLED/TFT opcodes; the
read path, `getDeviceState`, is implemented everywhere). Eleven planned
`devices_oled*`/`devices_tft*` opcodes are blocked on the same gap.

## Adopted API (boundary B)

```ts
setDeviceControl(partId: string, verb: string, value: number|string|Array): boolean
```

- Routes to an optional device-model hook
  `control(part, state, verb, value) → boolean` — true means handled; the
  board then re-solves and fires `_notifyChange('deviceControl', …)`.
- Fallback when no hook handles it: `verb === 'state'` with a numeric value
  maps to `setControl(partId, value)` — the existing user-intent channel
  (activate/deactivate on buzzers, switches).
- **Refusals are visible.** An unknown part, unregistered kind, or
  unhandled verb returns false AND records a warning surfaced by
  `getWarnings()` (bounded, counted). A command that looks accepted and
  does nothing is the exact defect class this repairs — silence is not an
  option twice.
- `setControl` semantics are unchanged; this is the verb-shaped channel
  beside it, exactly as `getDeviceState` sits beside `nodeVoltage`.

## Verb vocabulary (initial, per device model)

| kind | verb | value | effect |
|---|---|---|---|
| hd44780 (char_lcd) | print | string | chars into DDRAM at AC, AC advances |
| | cursor | [row, col] | AC = line base + col (2/4-line bases) |
| | clear | any | DDRAM ← spaces, AC 0, display on |
| ssd1306 | print | string | 8×8 funscii glyphs at text cursor (16×8 cells), wraps |
| | cursor | [row, col] | text cell cursor |
| | clear | any | fb ← 0, cursor home, display on |
| | pixel | [x, y, on?] | set/clear one pixel |
| | hline | [x0, x1, y] | horizontal line |
| | show | any | display on |
| ili9341 | print | string | glyphs in white at text cursor (W/8 × H/8 cells) |
| | cursor | [row, col] | text cell cursor |
| | clear | [r,g,b] or 0 | gram ← colour |
| | pixel | [x, y, r, g, b] | one pixel RGB565 |
| | fill | [x0,y0,x1,y1,r,g,b] | filled rectangle |
| servo | angle | number | targetAngle (0–180); slew stays the model's. On a servo an MCU pin drives, ALSO the 50 Hz pulse this servo decodes to that angle, on that pin (setPwm) — so the horn moves by the same decode as an emulated timer's pulses (2026-09-29, Lite B5) |
| dc_motor | speed | 0–100 | N % duty (clamped) on the MCU pin that drives the motor, via setPwm (2026-09-29, Lite B5); across an H-bridge channel, on the active IN pin with EN held high (2026-10-05, Lite B7) |
| | direction | forward / reverse / brake / coast | the L293D truth table on the H-bridge channel across the motor's leads (2026-10-05, Lite B7; see below) |
| relay | state | 0/1 | force energized (user intent; pending timer cleared) |
| neopixel | neopixel | [i, r, g, b] | pixels[i] ← RGB |
| | clearNeopixels | any | all pixels off |

`speed` on `dc_motor` is not a speed override — that would fake the physics
the model exists to teach — but the drive story that was missing: the board
walks the drawn netlist from the motor's terminals (through a base resistor,
a driver transistor, an H-bridge; at most three parts deep, stopping at supply
and ground rails and MCU power pins) to the MCU pin that drives it, and runs
the duty there with `setPwm`. The motor then integrates its torque over the
real on/off intervals, exactly as under `analogWrite`. Several candidate pins
narrow to the one on an enable (EN/ENA/PWM) net; still several, or none, is
refused by name ("driven by several MCU pins (...)", "no MCU pin drives it").

`direction` on `dc_motor` (2026-10-05, Lite B7; spec-updates/set-pwm.md,
"Motor direction through an H-bridge"): the board finds the `h_bridge`
channel whose two outputs carry the motor's two leads and the MCU pins on its
IN pins and EN, and sets forward / reverse / brake / coast by the L293D truth
table, oriented by the motor's own `a` lead. A motor on one MCU pin turns one
way (forward accepted, reverse and brake refused by name); a bridge whose
inputs are not both MCU pins cannot be steered; coast needs an MCU pin on EN.

Drawing verbs set the display on: a learner who prints wants to see it;
the register-level I2C/SPI paths are untouched and remain authoritative
for MCU-driven benches.

## Acceptance (hand oracles, same commit)

1. hd44780: print "Hi" at home → DDRAM[0]=0x48, DDRAM[1]=0x69; cursor
   [1,2] then print "X" → DDRAM index 42 = 0x58.
2. ssd1306: pixel [3,5] → ssd1306Pixel(state,3,5)=1; clear zeroes fb;
   print sets ≥1 pixel in the first glyph cell; hline spans exactly x0..x1.
3. servo: angle 90 → state.targetAngle 90.
4. relay: state 1 → energized, com↔no closed.
5. neopixel: [2,255,0,0] → pixels[2]=0xff0000; clearNeopixels zeroes.
6. Refusal: unknown verb returns false and getWarnings() names part+verb;
   'state' on an unregistered kind falls back to setControl.
