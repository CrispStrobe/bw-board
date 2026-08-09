# Parts target — canonical kind list

Derived from the 114-entry target catalogue. 88 distinct kinds mapped, 25 not yet in
the engine. This file is the authoritative source for kind slugs and coverage state.

## Reconciliation notes

- `keypad_4x4` covers the catalogue's "keypad" entry (parameter sets size)
- `dc_motor_encoder` covers "motor with encoder" (quadrature output)
- `dip_switch` covers DIP switch variants (parameter sets position count)
- `battery` / `battery_9v` / `battery_aa` / `battery_coin` cover all battery sizes
- Neopixel Ring/Jewel/Strip = `neopixel` with `pixels` param
- Breadboard sizes = geometry (bw-circuit-ui), not an engine kind

## Tier 1 — real parts to model (priority order)

| Slug | Status | Catalogue entries |
|------|--------|-------------------|
| `photodiode` | **TODO** | Photodiode |
| `soil_moisture` | **TODO** | Soil moisture sensor |
| `l293d` | DONE as `h_bridge` | L293D motor driver (with flyback diodes) |
| `relay_dpdt` | **TODO** | Relay DPDT (double-pole) |
| `solar_cell` | **TODO** | Solar panel / photovoltaic cell |
| `gearmotor` | **TODO** | Hobby gearmotor (DC motor with gear ratio param) |
| `74hc75` | **TODO** | 4-bit level-triggered latch |
| `74hc283` | **TODO** | 4-bit binary full adder |
| `pcf8574` | **TODO** | 8-bit I2C I/O expander |
| `char_lcd_i2c` | **TODO** | I2C LCD backpack (PCF8574 + HD44780 4-bit) |
| `clock_display` | **TODO** | 4-digit 7-segment clock display (TM1637 style) |
| `ir_remote` | **TODO** | IR remote transmitter |
| `header` | **TODO** | Pin header (passive connector, wire-only) |
| `usb_a` | **TODO** | USB-A connector (5V power + data pins) |

## Tier 2 — instruments (decision: NOT part kinds)

| Item | Decision | Reason |
|------|----------|--------|
| `multimeter` | **UI panel** | Already `Multimeter.jsx` — reads board.branchCurrent/nodeVoltage |
| `oscilloscope` | **UI panel** | Already `ScopePanel.jsx` — reads scope channel data |
| `function_generator` | **UI panel** | Already `vsource` with wave param — UI controls params |
| `power_supply` | **UI panel + vsource iLimit** | Spec filed, mna.js unblocked for CC mode |

Instruments are NOT added to getPartKinds(). They are UI panels that consume boundary-B
methods. Adding them as parts would create "two models of one thing" — a part in the netlist
AND a panel reading the same data.

## Tier 3 — boards and targets (NOT part kinds)

| Item | Owner | Reason |
|------|-------|--------|
| `arduino_uno` | emu8051-stc AVR work | Emulation target, not a component |
| `attiny` | emu8051-stc AVR work | Emulation target |
| `microbit` | Future | Emulation target |
| `breadboard` | bw-circuit-ui | Geometry/layout, not electrical |

## Coverage summary

- Catalogue entries: 114
- Distinct kinds: 88
- Engine has: 98 (includes device-registry kinds when all modules registered)
- Engine lacks (Tier 1): 14 (of which `l293d` is covered by `h_bridge`)
- Decided not-a-kind: 8 (Tier 2 instruments + Tier 3 boards)
