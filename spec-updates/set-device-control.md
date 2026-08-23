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
| servo | angle | number | targetAngle (0–180); slew stays the model's |
| relay | state | 0/1 | force energized (user intent; pending timer cleared) |
| neopixel | neopixel | [i, r, g, b] | pixels[i] ← RGB |
| | clearNeopixels | any | all pixels off |

Deliberately NOT implemented: `speed`/`direction` on `dc_motor` — the
motor is voltage-driven through its terminals and a direct speed override
would fake the physics the model exists to teach. Those verbs refuse with
the warning until a motor-driver-level story exists.

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
