# Boundary A spec-update: add `input-pullup` PinMode

## Problem

`input` mode returns high-Z regardless of `driveHigh`. When an MCU adapter maps
`INPUT_PULLUP` as `input + driveHigh=true`, the internal pull-up resistor vanishes.
A button-to-ground — the standard Arduino input idiom — floats instead of reading HIGH.

## Why not reuse `quasi`?

`quasi` driving LOW is a strong 25 Ohm sink. An AVR input never sinks at all.
Reusing the mode would import sinking behaviour the real part does not have.

## Proposal

Add `'input-pullup'` to the `PinMode` union:

```
PinMode = 'quasi' | 'pushpull' | 'input' | 'opendrain' | 'input-pullup'
```

Thevenin equivalent:
- `{ vTh: vcc, rTh: R_INPUT_PULLUP }` — always, `driveHigh` is irrelevant
  (the pull-up is on by definition)
- `R_INPUT_PULLUP = 35000` (35 kOhm, midpoint of AVR datasheet 20-50 kOhm range)

`input` mode continues to return high-Z and ignore `driveHigh`.

## Affected repos

- **bw-board**: `pin-model.js` (add the mode), `types.js` (extend PinMode typedef)
- **emu8051-stc**: MCU adapter maps `INPUT_PULLUP` to `('input-pullup', true)`
- **simulation-contract.md**: add `input-pullup` to PinMode table

## Test oracle

Button to ground through 35 kOhm pull-up, open: node voltage = VCC = 5.0 V.
Button pressed (0 Ohm to GND): node voltage = 0 V.
Button pressed through 10 kOhm (external): voltage divider 35k/(35k+10k) * 5 =
limited by the button being a short to GND — voltage = 0 V.

With 10 kOhm resistor to GND (not a button): divider = 10k/(10k+35k) * 5 = 1.111 V.
readAnalog at that node: 1.111 / 5.0 * 1024 ≈ 227.
