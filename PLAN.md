# bw-board — handover

## Status

**Complete for the circuit-parity campaign.** 98 part kinds, 1159 tests, 0 dependencies.
Vendored into brickwright-lite. All items from the target inventory implemented except
power supply CC mode (blocked on mna.js, spec filed).

**Next campaign is scoped: see `ROADMAP.md` (2026-08-23)** — engine correctness fixes,
sparse solver with factorization reuse, adaptive transient, true small-signal AC, model
depth, scheduled device events. The mna.js items have their spec-updates filed
(`referenced-device-drives`, `sparse-lu-factor-reuse`, `adaptive-transient`,
`shockley-junction-limiting`, `ac-small-signal`). Licence rulings for solver work are
in `ROADMAP.md` §"Backends and licence policy" — read them before importing anything.

## What is done

- **Core engine**: closed-form solver + MNA with Newton-Raphson. 70 ngspice oracles +
  55 Python oracles + RC/555 cross-validation (within 3-5% of analytic).
- **98 part kinds** across 12 device modules:
  - Built-in (31): passives, semiconductors, MCU, displays
  - Logic ICs (20): full 74HC family via chip-composer + CD4017/CD4511
  - Sensors (8): ultrasonic, PIR, tilt, flex, force, gas, ambient light, phototransistor
  - Power (8): batteries (9V/AA/coin), LM7805, LD1117V33, vreg, fuse
  - Actuators (7): DC motor (+encoder), servo, stepper, solenoid, vibration, relay
  - Analog ICs (5): 555, 556, LM393, LM339, TIP120
  - Other (19): H-bridge, gates, FFs, Darlington, optocoupler, light bulb, etc.
- **Scope channels**: fixed sim-time cadence, (min,max) decimation, NaN for unwritten,
  current channels at display rate. Adopted into boundary-B v2.
- **Device state readout**: `getDeviceState(partId)` for bw-cfront assertions.
- **74HC595 FSM**: shift/latch/OE, tested with 0xA5 oracle.
- **advanceTo runs device updates**: timed transitions (relay, motor, echo) fire correctly.
- **Non-convergence reporting**: `getWarnings()` surfaces MNA divergence as danger.
- **input-pullup PinMode**: 35kΩ, adopted into boundary A.
- **Serial debug target**: UART baud-not-modelled stated in capability matrix.
- **Engineering bar** (3/4 classes): property/fuzz, determinism, perf budgets.
- **Conformance**: 10/10 against real emu8051-stc WASM.
- **Performance**: advanceTo 233K/s, setPin 184K/s, branchCurrent cached 7.6M/s.
  Meter cliff: 8.0K edges/sec = 1.1× real time. Display-rate sampling is load-bearing.

## What is blocked

See `BLOCKED.md`:
- vsource current-limit (mna.js, coordinator)
- Headless live E2E (Playwright, memory constraint)

## What is NOT ours

- mna.js internals (coordinator)
- Cube name mismatch (bw-circuit-ui: rename `ledcube` → `led_cube`, remove filter)
- Rung 8 ladder (ucsim-stc)
- Gallery example assertions (bw-cfront — our capabilities are now unblocked for them)

## Standing rules

- **Push at every checkpoint.** Work in a process is one OOM away from never having happened.
- **No heavy native builds while the fleet runs.** Check `free -m` first.
- **No competitor names in committed content** including commit messages.
- **Diff files you didn't edit before committing.** `git add <specific files>`, never `-A`.
- **Never return a plausible 0 when the answer is "not available".** Refuse with a reason.
- **Non-convergence must be reported, never returned as a plausible answer.**
- **A fallback silently worse than the real thing is a bug, not resilience.**
