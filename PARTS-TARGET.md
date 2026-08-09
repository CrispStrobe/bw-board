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

## Tier 2 — instruments (revised ruling: HYBRID)

In standalone circuits (no MCU), instruments ARE the primary interaction. A learner places
a power supply, turns it up, and watches an LED light. The ruling:

| Item | Kind slug | Role |
|------|-----------|------|
| `power_supply` | `vsource` with `iLimit` param | **Part in netlist** — it IS a voltage source. UI shows CV/CC mode and lets user adjust voltage/limit via setControl. Already implemented (CC mode in mna.js). |
| `function_generator` | `vsource` with `wave` param | **Part in netlist** — it IS a vsource with sine/square/triangle. UI provides waveform controls. Already implemented. |
| `multimeter` | NOT a part kind | **UI panel + probe placement** — reads boundary-B methods (nodeVoltage, branchCurrent, resistance). Probes are placed on nets, not stamped in MNA. |
| `oscilloscope` | NOT a part kind | **UI panel + scope channels** — reads getScopeData(). Channels attached to nets via addScopeChannel(), not as netlist parts. |

The distinction: power supply and function generator ARE sources in the circuit (they supply
energy). Multimeter and oscilloscope are OBSERVERS (they measure without affecting the circuit,
ideally). Making an observer a netlist part would load the circuit it's measuring.

This means `power_supply` and `function_generator` need no new kinds — they are `vsource`
with specific params. The UI provides knobs that call `setControl()` or update params.

## Tier 3 — boards and targets (NOT part kinds)

| Item | Owner | Reason |
|------|-------|--------|
| `arduino_uno` | emu8051-stc AVR work | Emulation target, not a component |
| `attiny` | emu8051-stc AVR work | Emulation target |
| `microbit` | Future | Emulation target |
| `breadboard` | bw-circuit-ui | Geometry/layout, not electrical |

## Coverage summary

- Catalogue entries: 114
- Distinct kinds needed: 88
- Engine has: 111 (includes all device-registry kinds when modules registered)
- Tier 1: 14/14 DONE (l293d covered by h_bridge)
- Tier 2: power_supply + function_generator = existing vsource (no new kind needed);
  multimeter + oscilloscope = UI panels consuming boundary-B (no part kind)
- Tier 3: not part kinds (emulation targets / geometry)
- **All catalogue kinds that should be engine kinds: COMPLETE**
