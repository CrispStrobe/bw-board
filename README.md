# bw-board

The circuit simulation and emulated-board engine for Brickwright. It connects
firmware pin activity to a netlist, solves electrical behavior, updates device
models and exposes readings for a circuit editor or command-line instruments.

Runs in browsers and Node.js as an ES-module package. The UI lives in
[bw-circuit-ui](https://github.com/CrispStrobe/bw-circuit-ui); this repository
owns shared engine behavior, component models and emulator/debugger integration.

## Install and use

Use Node.js 20 or newer. Consumers install the package at an exact Git revision:

```json
{
  "dependencies": {
    "bw-board": "github:CrispStrobe/bw-board#<full-commit-sha>"
  }
}
```

Replace the placeholder with a full commit SHA and commit your npm lockfile.
The package has no JavaScript build step. Its runtime dependencies are
`avr8js` and `rp2040js`; some backends require separately supplied artifacts.

```js
import { BoardImpl, inferNetlist } from 'bw-board';

const { parts, nets } = inferNetlist({
  pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
  ],
});

const board = new BoardImpl(5.0);
board.setNetlist(parts, nets);
board.setPin('P1.0', 'quasi', false);
board.advanceTo(25_000_000n); // Simulation time in nanoseconds, not wall time.

console.log(board.getRenderState().leds);
```

The inferred circuit is a starting point; applications can instead supply an
explicit netlist. Register optional device models with `registerAllDevices()`
or the individual registration functions before using those kinds.

See [public exports](src/index.js), [netlist types](src/types.js),
[netlist builder](src/builder.js) and [Board API](src/board.js).
Documented package subpaths provide access to adapters and other modules;
Node-only tooling is separate from the browser entry.

## Circuit capabilities

- Modified nodal analysis and specialized solution paths for supported circuits.
- Resistors, capacitors, inductors, independent and controlled sources,
  supported semiconductor models, op-amps and regulator models.
- Registered logic, displays, sensors, controls, motors and other device models.
- MCU pin drive/pull-up behavior, wiring checks and current-budget diagnostics.
- Simulation-clock advancement, oscilloscope sampling, signed terminal currents
  and meter histories, plus supported DC operating-point and AC/sweep APIs.

Model capabilities are not uniform. A display's protocol model, an op-amp's
electrical model and a controller's instruction core have different contracts.
Consult the [device census](DEVICE-CENSUS.md), [parts notes](PARTS-TARGET.md)
and the relevant [device implementation](src/devices).

For graphical instruments, import/export and CLI measurement/reference
comparison, use [bw-circuit-ui](https://github.com/CrispStrobe/bw-circuit-ui).
The engine itself does not provide that application's file-format or UI layer.

## Firmware and debugging

Adapters and composable machines cover 8051, AVR, RP2040, Z80, 6502, RISC-V,
8086/8088 and 80286 use cases. The 80386 AT path is experimental.
Additional ARM/other targets depend on the selected backend and available
artifacts; they are not all included by installing this package.

Debugger integrations provide target-specific execution control, breakpoints,
inspection and, where supported, recording/replay. Features and peripheral
coverage vary by target. See the [target factory](src/debug-target-factory.js),
[debug session](src/debug-session.js) and
[replay surface](docs/DEBUG-TARGET-REPLAY-SURFACE.md).
The [experimental 80386 guide](docs/I80386-EXPERIMENTAL.md) documents that
target's boundaries.

## LabWired WASM performance (2026-10-01)

These results use the selected 64 MHz micro:bit motion guest in Node.js, not
browser/UI qualification or a universal chip-speed claim. The guarded cached
T16 scalar optimization landed on core `main` as `c05e8de3` after all 19 enabled
final-head checks passed. Three independent exact-artifact A/B/B/A runs measured
**+6.94%, +1.23% and +4.85%** median gains, with matching cycle-indexed guest
observations. One repeat's candidate minimum worsened, so this is not an
every-window improvement.

The exact final-head fresh qualification still failed every 1× window:
**0.704710× median / 0.690863× minimum**, EPYC 7763. Determinism and all 101
actual WASM integration tests passed with zero skips; publication stayed blocked.
App engine pins remain unchanged and CP13 remains open. Hardware content
acknowledgements were explicitly approved with their existing expiry and
capture evidence preserved; live re-capture remains owed.

Interpreter outlining was rejected after two negative paired runs (−7.68% and
−4.37%). See the [scalar results and raw receipts](docs/receipts/2026-10-01-wasm-cached-scalar/README.md),
[rejected outlining evidence](docs/receipts/2026-10-01-wasm-outline/README.md) and
[profiling/tier-validation guide](docs/LABWIRED-WASM-PROFILING.md).

The next, still-experimental bounded cached-run candidate (core PR 146) measured
**+8.24% and +7.15%** in two exact-artifact paired comparisons against the landed
scalar baseline, with identical cycle-indexed guest observations. Its fresh
qualification was **0.979751× median / 0.951531× minimum**: still below the
unchanged every-window 1× floor. Both builds, determinism and 101 actual WASM
integration tests passed; the fixed-head local core suite passed 4,234 tests
with three existing ignored tests. Host rates are not interchangeable. App pins
remain unchanged. See [bounded-run results and raw receipts](docs/receipts/2026-10-01-wasm-cached-runs/README.md)
for exact source references, pending checks and hardware-drift approval status.

## Limits

This is not a universal SPICE replacement or a calibrated model of every
physical component. Supported parameters, nonlinear convergence, timing,
parasitics and thermal behavior depend on the selected model and analysis.
Strict operating-point APIs refuse unsupported domains or conflicting
constraints; inspect their result rather than treating diagnostics as a valid solve.

Instruction and machine tests do not establish universal peripheral coverage,
silicon-exact timing or compatibility with every program. Simulation throughput
also depends on the circuit, observers, backend and host machine.

## Develop and verify

```sh
npm ci
npm test
node scripts/oracle-census.mjs
```

The oracle census reports available independent tools and the gates that
require them. Some tests need external tools or backend artifacts: an explicit
skip is not a successful oracle comparison. Heavy suites can run in
[GitHub Actions](https://github.com/CrispStrobe/bw-board/actions).

[VERIFICATION.md](VERIFICATION.md) explains evidence and its limits.
[ROADMAP.md](ROADMAP.md) tracks development; [LANES.md](LANES.md) records
contributor ownership and the upstream-first package regime.
Detailed benchmark and campaign receipts remain in their own documents;
historical totals are not a statement of current coverage.

## License

MIT. See [LICENSE](LICENSE) and [third-party notices](THIRD-PARTY.md).
