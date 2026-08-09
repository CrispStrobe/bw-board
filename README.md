# bw-board

Board layer between an emulated 8051 MCU and a bench-style circuit designer.
Resolves pin drive states into node voltages, LED brightness, and buzzer tones.

Zero runtime dependencies. Runs in a browser or Node.js. MIT licensed.

## What it does

- **Netlist + pin resolution**: parts (VCC, GND, resistor, LED, pot, button, switch,
  buzzer, capacitor, diode) connected by nets, resolved against MCU pin Thévenin equivalents.
- **Four STC12 port modes** as different Thévenin sources: quasi-bidirectional (sink 20 mA /
  source ~230 µA), push-pull, input-only, open-drain.
- **Closed-form fast path**: voltage dividers, LED threshold + dynamic R, RC exponential,
  pot divider, button. No matrix solver needed for the starter-kit component set.
- **MNA solver** (behind the interface): for `branchCurrent` and `resistance`. Linear MNA
  with Newton–Raphson for diodes. Gaussian elimination with partial pivoting.
- **Instruments**: `nodeVoltage`, `branchCurrent`, `resistance` (returns `'requires-power-off'`
  when the board is live — because a real DMM measures ohms with the power off).
- **Transducers**: `ledBrightness` (current × PWM duty integrated over 20 ms),
  `buzzerTone` (toggle period → frequency for Web Audio).
- **`inferNetlist`** (boundary C): generates a default circuit from `project.stc.pins`.
- **Boundary-A conformance kit**: `runConformance(mcuAdapter)` — executable test suite
  that any MCU implementation runs to verify it satisfies the contract.
- **emu8051-stc adapter**: bridges the WASM emulator API to boundary A via polling.

## Performance budget

Measured on a single core (Node 20, Linux), 11-part netlist (2 LEDs, pot, button, buzzer):

| Operation | Throughput | Notes |
|-----------|-----------|-------|
| advanceTo (steady state) | ~233 K ops/sec | Skips recording when nothing changed |
| advanceTo + setPin (PWM loop) | ~194 K calls/sec | The main simulation loop |
| setPin (closed-form solve) | ~184 K ops/sec | Re-solves on every pin change |
| setControl (pot, re-solve) | ~109 K ops/sec | |
| branchCurrent (MNA solve) | ~12 K ops/sec | Full matrix solve per call |
| branchCurrent (MNA cached) | ~7.6 M ops/sec | Cache hit — no state change between reads |
| readAnalog (no re-solve) | ~824 K ops/sec | Pure lookup |
| 595 shift register burst | ~253 K edges/sec | 24 edges per write |

**PCA PWM performance:** 1 second of 8-bit PWM at FOSC/12 simulated in 75ms
= **13.4× real time**. 7200 edges/sec against 194K capacity = 27× headroom.

**Meter block cliff (measured, commit `c4d8031`, method below):** the full
per-edge path — one `advanceTo` + one `setPin` + one `branchCurrent` per
edge — sustains **8.0K edges/sec** against a PCA rate of 7.2K edges/sec
= **1.1× real time**. The MNA cache (`44fc538`) has zero hit rate here
because each `setPin` invalidates it. The cache helps the *recommended*
pattern instead: at display rate (~60 Hz), multiple meter blocks in one
frame share a single MNA solve. Meter blocks MUST sample at display rate,
not per edge — the cliff makes it necessary, and a real multimeter does
the same thing.

Measurement method: 3000 PCA 8-bit PWM cycles (50% duty, FOSC/12),
one `branchCurrent('LED_lamp', 'anode')` per edge, 50-cycle warmup,
Node 20, single core.

## Integration path

This module has zero runtime dependencies and is designed to be vendored into
`brickwright-lite` (a fully-permissive BSD-3/Apache-2.0/MIT bundle). Options:

1. **Vendor via sync script** (like `sb3-creator`): publish to npm, then a sync script
   copies the built module into the bundle.
2. **Fold directly**: copy `src/` into the consuming project. No build step needed.

Either way, keep the zero-dependency rule — it is what lets this ship inside a permissive bundle.

### Vendoring: which files to copy

A vendoring script should copy exactly these files:

```
src/index.js
src/types.js
src/pin-model.js
src/board.js
src/mna.js
src/validate.js
src/infer-netlist.js
src/scripted-mcu.js
src/conformance.js
src/emu8051-adapter.js
src/emu8051-debug.js
src/debug-session.js
src/serial-debug.js
src/debug-target-factory.js
src/builder.js
```

`src/index.js` is the single entry point. All imports are relative within `src/`.
No build step, no dependencies, no generated files. Copy the directory and import.

### Netlist validation

`setNetlist` validates the netlist and **throws on errors** — wrong terminal names
(e.g. `{a,b}` instead of `{anode,cathode}` for an LED), unknown part kinds, missing
ground reference, NaN parameters. This prevents the solver from silently producing
plausible wrong answers.

```js
import { BoardImpl } from 'bw-board';

try {
  board.setNetlist(parts, nets);
} catch (e) {
  // e.message lists the specific errors
  console.error(e.message);
}
```

For pre-flight checking without throwing, use `validateNetlist` directly:

```js
import { validateNetlist } from 'bw-board';

const errors = validateNetlist(parts, nets);
// errors: [{severity: 'error'|'warning', message, partId?, netId?}]
```

## Quick start

```js
import { BoardImpl, inferNetlist } from './lib/bw-board/index.js';

// 1. Infer a circuit from pin declarations
const { parts, nets } = inferNetlist({
  pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    { name: 'pot',  port: 1, bit: 3, direction: 'analog', activeLow: false },
  ],
});

// 2. Create the board (setNetlist validates and throws on errors)
const board = new BoardImpl(5.0);
board.setNetlist(parts, nets);

// 3. Drive pins as the MCU would
board.setPin('P1.0', 'quasi', false);  // LED on (active-low)
board.setPin('P1.3', 'input', false);  // ADC input
board.setControl('POT_pot', 0.5);      // user turns the knob
board.advanceTo(25_000_000n);          // 25 ms of simulation

// 4. Read the state for the UI
const state = board.getRenderState();
// state.leds[0].brightness ≈ 0.145
// state.controls[0].value === 0.5
// state.warnings.length === 0
```

## Testing

```bash
npm test                    # node --test
node bench/perf.js          # performance benchmark
```

## Files

```
src/
  index.js              — module entry point (single import)
  types.js              — boundary A + B type definitions (JSDoc)
  pin-model.js          — Thévenin equivalents for the four port modes
  board.js              — Board implementation (closed-form + RC)
  mna.js                — MNA solver (branchCurrent, resistance)
  validate.js           — netlist validation (catch misuse before solve)
  infer-netlist.js      — boundary C: infer netlist from project.stc.pins
  scripted-mcu.js       — test harness: timestamped pin events
  conformance.js        — boundary-A conformance kit
  emu8051-adapter.js    — adapter for the emu8051-stc WASM emulator
bench/
  perf.js               — performance benchmark
test/
  *.test.js             — ~995 tests
```

## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).
