# bw-board — handover

## Status

**Shipped.** Vendored into brickwright-lite as 44KB lazy chunk. 850+ tests, 31 part kinds, 11 source files, 0 dependencies.

## What is done

- **Core engine**: closed-form solver + MNA with Newton-Raphson. 70 ngspice oracles + 55 Python oracles verified.
- **Conformance**: 10/10 against real emu8051-stc WASM. LED brightness = 0.1449 through 3 independent paths.
- **Components**: 31 part kinds including MOSFET, op-amp, V/I sources, LDR, NTC, zener, inductor, LED cube, shift register, char LCD, IR receiver, temp sensor, EEPROM. Drawable parts have electrical models (supply current + input impedance), not just symbols.
- **inferNetlist**: 7+ rows — output, analog, input, tone, pwm, PORT, PART (74HC595). Handles `direction: "pwm"` and `direction: "tone"`. Ports array and parts array in pins.json.
- **Validation**: `setNetlist` throws on malformed input. NetlistBuilder prevents misuse at wire() time.
- **Performance**: advanceTo 233K/s steady (68× optimization in `_recordLedSamples`). MNA cache for branchCurrent. PWM at PCA rate: 13.4× real time without meter.
- **Meter cliff**: 8.0K edges/sec full per-edge path = 1.1× real time. Display-rate sampling is load-bearing. MNA cache helps the recommended pattern (multiple reads share one solve), not the cliff.
- **LED cube**: 8 scan lines × 8 data bits, 12.5% duty per voxel. Polarity is a parameter. Golden trace in `test/golden/cube-trace.js` for cross-checking with bw-circuit-ui.
- **Circuit extension design**: `CIRCUIT-EXTENSION.md`. 7 blocks, injection pattern, display-rate sampling, refusal idiom.
- **Halt behavior**: no pause() needed, RC integrator exact for any dt, setControl live while halted.
- **Buzzer**: staleness detection (>100ms → off), direction "tone" → buzzer part.

## What is next

1. **Golden cube trace cross-check**: sent to bw-circuit-ui. They should replay `cube-trace.js` through their accumulator and assert same 64 values. If 25% → 2× error. If 12.5% → pin it. Already sent via screen message.
2. **Cube voxel map**: stays a parameter with a provisional default until probe.c is run on real hardware.

## Key measurements (with commits)

| Metric | Value | Commit |
|--------|-------|--------|
| Per-edge cliff (advanceTo+setPin+branchCurrent) | 8.0K edges/sec, 1.1× | `c4d8031` |
| advanceTo steady state | 233K/s | `d99d264` |
| PWM loop (no meter) | 13.4× real time | `d99d264` |
| MNA cache: branchCurrent cached reads | 7.6M/s | `44fc538` |
| cubeBrightness 64 voxels | 817 fps | `90d44d2` |
| Cube scan 8 lines | 2.3K changes/s | `90d44d2` |

## Blocked on

Nothing. Boundary B is stable. The circuit extension lives in `extensions/CrispStrobe/circuit.js` (read-only reference for bw-board).

## Standing rules

- **Diff files you didn't edit before committing.** Three fixes were reverted by integration commits carrying stale copies. `git add <specific files>`, never `-A`.
- **Pull and rebase before starting work.**
- **Boundary B is stable.** Flag the user before changing it.
- **Never return a plausible 0 when the answer is "not available".** Refuse with a reason string.
