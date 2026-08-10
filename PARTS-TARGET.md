# Parts target — engine-specific notes

**The canonical parts list lives in `bw-parts/PARTS-CATALOG.md`.**
This file does NOT duplicate it. It records only:

1. Engine-specific rulings (what is a part kind vs what is not)
2. Implementation status per kind
3. The instrument decision

Do not add catalogue entries here. If a slug is wrong for the engine,
raise it with bw-parts — they own the canonical name.

## Instrument ruling (f5250e1)

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

vsource CC mode: implemented in mna.js (`e060978`). `setControl()` adjusts voltage
in real time for the bench-supply knob experience.

## Behaviour-class substitution

The target ecosystem's own guidance is that a missing sensor gets represented
by a similar one, because what matters is the behaviour class. There are only
four that matter for the long tail of sensors:

| Class | Engine model | Substitutes for |
|-------|-------------|-----------------|
| 3-pin analog sensor | `tmp36` (V = f(stimulus)) | Any sensor with VCC/GND/signal that outputs a voltage proportional to a physical quantity |
| 2-pin analog sensor | `ldr` / `ntc` / `flex_sensor` / `force_sensor` (R = f(stimulus)) | Any sensor whose resistance varies with a physical quantity; use as one half of a voltage divider |
| Digital contact closure | `button` / `switch` / `tilt_sensor` (open/closed) | Reed switch, vibration switch, any sensor that reduces to a contact closing |
| I2C device | `pcf8574` / `char_lcd_i2c` (SCL/SDA behavioral decode) | Any I2C peripheral; the protocol is the same, only the register set differs |

A model that covers these four classes honestly covers the long tail by
substitution — which is a much smaller job than 114 individual models.

**Unverified identifications** (from the target catalogue): the clock display
(HT16K33 vs TM1637 — not interchangeable), ATtiny (85 assumed), micro:bit
(v1 vs v2), gas sensor (MQ-series, no specific part). Do not build a model
whose timing or pinout depends on which one it is without stating which was
assumed.
