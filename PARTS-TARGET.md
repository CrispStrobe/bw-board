# Parts target — engine-specific notes

**The canonical parts list lives in `bw-parts/PARTS-CATALOG.md`.**
This file does NOT duplicate it. It records only:

1. Engine-specific rulings (what is a part kind vs what is not)
2. Implementation status per kind
3. The instrument decision

Do not add catalogue entries here. If a slug is wrong for the engine,
raise it with bw-parts — they own the canonical name.

## Instrument ruling (2db84b2)

| Instrument | Engine role |
|------------|------------|
| Power supply | `vsource` with `iLimit` param. Controllable via `setControl()`. CV→CC in MNA. |
| Function generator | `vsource` with `wave`/`freq`/`amplitude` params. Controllable. |
| Multimeter | NOT a part kind. UI panel consuming `nodeVoltage`/`branchCurrent`/`resistance`. |
| Oscilloscope | NOT a part kind. UI panel consuming `addScopeChannel`/`getScopeData`. |

Power supply and function generator are sources (they supply energy to the circuit).
Multimeter and oscilloscope are observers (they measure without affecting it).

## What is NOT a part kind

- **Emulation targets** (arduino_uno, attiny, microbit) — these are MCU boards, not components
- **Geometry** (breadboard) — layout owned by bw-circuit-ui
- **Observers** (multimeter, oscilloscope) — UI panels consuming boundary-B methods

## Engine implementation status

All kinds from the catalogue that should be engine kinds are implemented (111 in
`getPartKinds()`). Registered device modules add more at runtime. To see the full
list: `BoardImpl.getPartKinds()` after registering all device modules.

Kinds that need I2C bus modeling (`pcf8574`, `char_lcd_i2c`) have behavioral decoders
that watch SCL/SDA edges directly — no shared bus abstraction needed.

vsource CC mode: implemented in mna.js (`06935ad`). `setControl()` adjusts voltage
in real time for the bench-supply knob experience.
