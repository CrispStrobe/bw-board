# bw-board — plan

## What this is

The board layer between an emulated 8051 MCU and a TinkerCAD-style circuit designer.
It resolves pin drive states into node voltages, LED brightness, and buzzer tones
using closed-form models for the fast path, with an MNA solver behind
the interface for branchCurrent and resistance measurement.

## Architecture

```
MCU (scripted fixture or real emulator)
  ↕  boundary A — setPin / readPin / readAnalog / advanceTo
Board
  ↕  boundary B — setNetlist / nodeVoltage / ledBrightness / buzzerTone / …
UI (not in scope here)
```

The board never calls the MCU. One direction of control, no re-entrancy.

## The electrically load-bearing part

Each of the four STC12 port modes is a different Thévenin source:

| mode             | drive=0                | drive=1                       |
|------------------|------------------------|-------------------------------|
| quasi-bidir      | Vth≈0, Rth≈25Ω (20mA) | Vth≈VCC, Rth≈21.7kΩ (~230µA) |
| push-pull        | Vth≈0, Rth≈25Ω        | Vth≈VCC, Rth≈25Ω             |
| input-only       | high-Z                 | high-Z                        |
| open-drain       | Vth≈0, Rth≈25Ω        | high-Z                        |

The quasi-bidir asymmetry is the whole reason LEDs are wired active-low.
The simulator must *demonstrate* this, not assert it.

## Phases (in order — do not skip ahead)

### Phase 1 — interfaces and shape (no implementation)

Files: `src/types.ts`

- Boundary A types: `McuToBoard`, `BoardToMcu`, `PinId`, `PinMode`
- Boundary B types: `Board`, `Part`, `Net`, `PartKind`
- Thévenin model type: `{ vTh: number; rTh: number } | 'high-z'`
- Commit for review before writing any logic.

### Phase 2 — closed-form solver + pin model

Files: `src/pin-model.ts`, `src/board.ts`

- `pinThevenin(mode, driveHigh, vcc)` → Thévenin equivalent per the table above
- Netlist storage: parts and nets, adjacency from net→terminals
- Closed-form node resolution for the starter-kit set:
  - Resistor: voltage divider between two Thévenin sources
  - LED: piecewise Vf≈2V threshold, then linear (Rd≈10Ω above threshold)
  - Potentiometer: voltage divider, wiper output
  - Button: short or open
  - Capacitor: `V += (Vt − V)·(1 − e^(−dt/RC))`
  - Buzzer: driven from a digital output, measures toggle period

### Phase 3 — scripted-MCU harness + first test

Files: `src/scripted-mcu.ts`, `test/led-active-low.test.ts`

- The scripted MCU is a list of timestamped events that calls setPin/advanceTo
  and asserts readPin/readAnalog/ledBrightness against hand-computed values.
- First test: push-pull pin driving 0 through `VCC → 1kΩ → LED → pin`.
  Hand computation:
  - Pin drives low: Vth=0, Rth=25Ω. VCC=5V, R=1kΩ, LED Vf=2V.
  - Loop: 5V → 1kΩ → LED(2V drop) → 25Ω → GND.
  - I = (5 − 2) / (1000 + 25) = 3/1025 ≈ 2.93 mA.
  - LED is on, brightness ∝ current (normalized to ~20mA rated → ~0.146).
- Second test: same circuit but quasi-bidir driving 1 (sourcing).
  - Vth=VCC, Rth≈21.7kΩ. Current tries to flow VCC→pin, but LED is reverse-biased
    in this direction. LED off, brightness ≈ 0.
  - Or if wired the naive way (pin → 1kΩ → LED → GND), quasi-bidir driving 1:
    I = (5 − 2) / (21700 + 1000) ≈ 0.132 mA. Barely visible.
    Push-pull driving 1: I = (5 − 2) / (25 + 1000) ≈ 2.93 mA. Bright.
    That is the lesson.

### Phase 4 — pot → ADC path

- Potentiometer model: `V_wiper = VCC * position` (position 0…1).
- `readAnalog` returns the wiper voltage.
- Test: pot at midpoint → readAnalog returns 2.5V (±0.01).

### Phase 5 — transducers

- `ledBrightness`: integrate current × PWM duty over ~20ms window.
- `buzzerTone`: measure toggle period, report frequency.

### Phase 6 — MNA solver (later, behind the interface)

- Only needed for `branchCurrent` and `resistance`.
- `resistance` returns `'requires-power-off'` when board is powered.

## Status

| Phase | Status | Tests |
|-------|--------|-------|
| 1 — Interfaces (boundary A + B) | Done | — |
| 2 — Closed-form solver + pin model | Done | 8 LED, 6 pot, 3 buzzer, 3 button, 5 cap |
| 3 — Scripted-MCU harness + tests | Done | 2 trace tests |
| 4 — Pot → ADC path | Done | 6 tests |
| 5 — Transducers (PWM brightness, buzzer tone) | Done | 4 PWM tests |
| 6 — MNA solver (branchCurrent, resistance) | Done | 8 MNA tests |
| 7 — inferNetlist (boundary C) | Done | 9 tests |
| 8 — All four port modes | Done | 10 tests |

Total: 56 tests, all hand-computed oracles.

## Non-goals for now

- No UI, no builder, no drag-and-wire.
- No runtime dependencies. No build tools. `node --test`.
- No UART, SPI, EEPROM, watchdog.

## File layout

```
bw-board/
  PLAN.md
  CLAUDE.md
  THIRD-PARTY.md
  LICENSE
  package.json
  src/
    index.js          — module entry point
    types.js          — boundary A + B type definitions (JSDoc)
    pin-model.js      — Thévenin equivalents for the four port modes
    board.js          — Board implementation (closed-form solver)
    mna.js            — MNA solver (branchCurrent, resistance)
    infer-netlist.js  — boundary C: infer netlist from project.stc.pins
    scripted-mcu.js   — test harness: timestamped pin events
  test/
    led-active-low.test.js
    pot-adc.test.js
    buzzer.test.js
    button-resistance.test.js
    capacitor.test.js
    pwm-brightness.test.js
    mna-solver.test.js
    infer-netlist.test.js
    port-modes.test.js
```
