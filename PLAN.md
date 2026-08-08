# bw-board — shipped

**Status: shipped.** Vendored into brickwright-lite (commit d7edfaa, 44KB chunk).
The circuit designer UI (bw-circuit-ui) consumes boundary B. The emu8051-stc
emulator passes the conformance suite 10/10. LED brightness = 0.1449 through
three independent paths: hand-computed, tier-1 simulator driver, tier-2 WASM.

## Architecture

```
MCU (scripted fixture or real emulator)
  ↕  boundary A — setPin / readPin / readAnalog / advanceTo
Board (this module, 44KB bundled)
  ↕  boundary B — setNetlist / nodeVoltage / ledBrightness / buzzerTone / …
UI (bw-circuit-ui, separate agent)
  ↑  boundary C — inferNetlist from project.stc.pins
```

The board never calls the MCU. One direction of control, no re-entrancy.
A halted MCU just stops calling advanceTo — no pause() interface needed.

## Components (18 types)

| Type | Closed-form | MNA | Params |
|------|------------|-----|--------|
| vcc | ✓ | voltage source | — |
| gnd | ✓ | reference | — |
| resistor | ✓ | ✓ | ohms |
| capacitor | ✓ (RC step) | — | farads |
| inductor | ✓ (DC wire) | ✓ (DC wire) | henrys |
| diode | — | ✓ (NR) | vf |
| led | ✓ | ✓ (NR) | vf, color |
| zener | — | ✓ (3-region) | vf, vz, rz |
| potentiometer | ✓ | ✓ | ohms |
| button | ✓ | ✓ | — |
| switch | ✓ | ✓ | — |
| buzzer | ✓ | ✓ | — |
| ldr | ✓ | ✓ | rDark, rLight |
| ntc | ✓ | ✓ | rCold, rHot |
| npn | — | ✓ (Ebers-Moll) | beta, vbe |
| pnp | — | ✓ | beta, vbe |
| seven_segment | composite | composite | 8 LED sub-parts |
| rgb_led | composite | composite | 3 LED sub-parts |

## Public API (34+ methods)

**Boundary A:** setPin, advanceTo, readPin, readAnalog
**Boundary B:** setNetlist, nodeVoltage, branchCurrent, resistance, ledBrightness,
  sevenSegmentBrightness, rgbLedBrightness, buzzerTone, setControl, setPower
**State getters:** getTime, isPowered, getVcc, getPinState, getControl,
  getCapVoltage, getInductorCurrent
**Part queries:** getParts, getNets, getLeds, getBuzzers, getControls, getPinStates
**UI support:** getRenderState, onChange/offChange, getWarnings
**Lifecycle:** reset, snapshot, restore
**Validation:** validateNetlist, assertValidNetlist (called by setNetlist)
**Inference:** inferNetlist, checkWiring
**Conformance:** runConformance, formatReport
**Adapter:** createEmu8051Adapter, formatPollingLossReport

## Key properties

- Zero runtime dependencies, ESM, runs in browser or Node
- setNetlist validates and throws on malformed input
- resistance() returns 'requires-power-off' when powered
- Buzzer detects stale edges (>100ms) → reports off, not 0 Hz
- NaN guards on all output methods — never returns NaN to the UI
- onChange callbacks for reactive UI updates
- Halt is a no-op: RC integrator is exact for any dt
- 563 tests, all hand-computed oracles
