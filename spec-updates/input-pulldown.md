# PinMode extension: `input-pulldown`

**Filed:** 2026-08-13
**Gate:** MNA-affecting change — this document + hand-computed oracle tests
required in the same commit.

## Motivation

The RP2040's GPIO pads have internal pull-down resistors. rp2040js reports
`GPIOPinState.InputPullDown` when firmware enables them. Before this change,
the adapter mapped `InputPullDown` to plain `'input'` (high-Z) with the pull
**lost** — a floating-node read through a pull-down returned wrong results.

The pull-down is the mirror image of `input-pullup`: a weak resistor to
ground instead of VCC.

## Thévenin model

| PinMode | vTh | rTh | Source |
|---------|-----|-----|--------|
| `input-pullup` | VCC | 35 kΩ | AVR datasheet 20–50 kΩ, midpoint |
| **`input-pulldown`** | **0 V** | **50 kΩ** | RP2040 Datasheet §2.19.6.3, Table 628: typ 50 kΩ (range 40–80 kΩ) |

The pull-down is to GND (vTh = 0), not to VCC. The resistance value (50 kΩ)
is the RP2040 datasheet's typical; the range 40–80 kΩ spans parts and
temperature. We use the typical, consistent with input-pullup using the AVR
midpoint.

## Oracle arithmetic

### Test 1: standalone pull-down (no external connection)

Pin in `input-pulldown` mode, MCU only, VCC+GND present.
The pull-down pulls the node to 0 V through 50 kΩ.

- **V_node = 0 V** (only source is the pull-down to ground)
- **readPin = 0** (0 V < 1.5 V threshold)

### Test 2: pull-down with 100 kΩ to VCC (voltage divider)

Pin in `input-pulldown` (vTh=0 V, rTh=50 kΩ), external 100 kΩ to VCC (5 V).

Divider: V_node = 5 × 50k / (50k + 100k) = 5 × 1/3 = **1.6667 V**

readPin: 1.6667 V > 1.5 V → **readPin = 1** (barely above threshold)

### Test 3: pull-down with 10 kΩ to VCC (strong external drive)

Pin in `input-pulldown` (vTh=0, rTh=50 kΩ), 10 kΩ to VCC.

Divider: V_node = 5 × 50k / (50k + 10k) = 5 × 50/60 = **4.1667 V**

readPin = 1 (well above threshold)

### Test 4: pull-down with button to VCC

Button open: V_node = 0 V (pull-down wins). readPin = 0.
Button pressed: V_node = 5 V (shorted to VCC). readPin = 1.

This is the pull-down counterpart to the INPUT_PULLUP-with-button-to-GND
idiom. On the RP2040, buttons can wire to VCC with an internal pull-down,
instead of wiring to GND with a pull-up.

### Test 5: Thévenin values directly

`pinThevenin('input-pulldown', false, 5.0)` → `{ vTh: 0, rTh: 50000 }`
`pinThevenin('input-pulldown', true, 5.0)` → same (driveHigh irrelevant)

## BusKeeper adjudication

`GPIOPinState.InputBusKeeper` is the RP2040's bus-keeper mode: the pad holds
its last driven level through a weak latch. Modeling this requires per-pin
state tracking (was the pin last driven high or low?), which has no precedent
in the current PinMode vocabulary.

**Decision:** `InputBusKeeper` maps to `'input'` (high-Z) with the bus-keeper
behavior **lost**. This is documented in `rp2040js-adapter.js` with a comment.

**Rationale:**
1. Bus-keeper is rarely used in educational contexts (the RP2040 uses it for
   boot strap pins, not user GPIO).
2. The correct model is a latch, not a Thévenin resistor — it tracks previous
   state, which is a fundamentally different kind of source.
3. If needed later, it should be a new PinMode (`'buskeeper'`) with stateful
   behavior in the solver, not a hack on top of pull-up/pull-down.

## Files changed

- `src/types.js` — PinMode union gains `'input-pulldown'`
- `src/pin-model.js` — new `R_INPUT_PULLDOWN = 50000`, case in `pinThevenin()`
- `src/rp2040js-adapter.js` — `InputPullDown` → `'input-pulldown'`, comment update
- `test/port-modes.test.js` — oracle tests (this document's arithmetic)
