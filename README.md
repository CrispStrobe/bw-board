# bw-board

Board layer between an emulated 8051 MCU and a TinkerCAD-style circuit designer.
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
| advanceTo + setPin (1 kHz PWM, 2 LEDs) | ~25 K cycles/sec (~150 K calls/sec) | The main simulation loop |
| setPin (closed-form solve) | ~160 K ops/sec | Re-solves on every pin change |
| setControl (pot, re-solve) | ~200 K ops/sec | |
| branchCurrent (MNA solve) | ~15 K ops/sec | Full matrix solve per call |
| readAnalog (no re-solve) | ~1.6 M ops/sec | Pure lookup |
| ledBrightness (integration) | ~330 K ops/sec | Time-weighted average |

The closed-form path runs at 150 K+ calls/sec. At a 1 kHz simulated PWM with 6 calls per
cycle, that is 25 K simulated cycles per wall-clock second — enough to run a 1 MHz MCU at
~40× slower than real time. The MNA solver is only invoked on demand (branchCurrent /
resistance), not per cycle.

The buzzer audio path needs ~48 kHz sampling. At 150 K setPin calls/sec, that is ~3 K
simulated MCU cycles per audio sample — adequate for the starter-kit frequencies (100 Hz–5 kHz).

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
  *.test.js             — 156 tests
```

## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).
