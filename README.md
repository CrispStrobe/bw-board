# bw-board

The circuit-simulation and emulated-board engine behind Brickwright. It connects
a microcontroller's firmware pin activity to a netlist, solves the electrical
behaviour, updates device models, and exposes readings for a circuit editor or
command-line instruments. It runs in the browser and in Node.js as an ES-module
package.

The [historical x86 checkpoint](docs/I80386-HISTORICAL-SOURCE-CONTEXTS.md)
records qualified historical source isolation, current inventory controls and finite
xv6 filesystem/boot/fork scenarios. Performance adoption remains a separate gate.

The user interface lives in
[bw-circuit-ui](https://github.com/CrispStrobe/bw-circuit-ui); this repository
owns the shared engine behaviour, the component models, and the
emulator/debugger integration.

## Install and use

Use Node.js 20 or newer. Consumers install the package at an exact Git revision:

```json
{
  "dependencies": {
    "bw-board": "github:CrispStrobe/bw-board#<full-commit-sha>"
  }
}
```

Replace the placeholder with a full commit SHA and commit your lockfile. The
package has no JavaScript build step; its runtime dependencies are `avr8js` and
`rp2040js`, and some backends require separately supplied artifacts.

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
board.advanceTo(25_000_000n); // simulation time in nanoseconds, not wall time

console.log(board.getRenderState().leds);
```

The inferred circuit is a starting point; an application can supply an explicit
netlist instead. Register optional device models with `registerAllDevices()` (or
the individual registration functions) before using those kinds. See
[public exports](src/index.js), [netlist types](src/types.js),
[netlist builder](src/builder.js) and the [Board API](src/board.js).

## Circuit capabilities

- Modified nodal analysis, with specialised solution paths for supported circuits.
- Resistors, capacitors, inductors, independent and controlled sources, supported
  semiconductor models, op-amps and regulator models.
- Registered logic, display, sensor, control, motor and other device models.
- MCU pin drive / pull-up behaviour, wiring checks and current-budget diagnostics.
- Simulation-clock advancement, oscilloscope sampling, signed terminal currents
  and meter histories, plus supported DC operating-point and AC/sweep APIs.

Model capabilities are not uniform — a display's protocol model, an op-amp's
electrical model and a controller's instruction core have different contracts.
See the [device census](DEVICE-CENSUS.md), [parts notes](PARTS-TARGET.md) and the
individual [device implementations](src/devices). For graphical instruments,
import/export and CLI measurement, use
[bw-circuit-ui](https://github.com/CrispStrobe/bw-circuit-ui); the engine itself
provides no file-format or UI layer.

For reproducible instrument captures and their model, clock and work limits,
see the [CLI instrument guide](https://github.com/CrispStrobe/bw-circuit-ui/blob/master/docs/CLI-INSTRUMENTS.md).
Qualification applies to the recorded model and source identity, not every
imported circuit or every behaviour of the corresponding physical component.

## Firmware and debugging

Adapters and composable machines cover **8051, AVR, RP2040, Z80, 6502, RISC-V,
8086/8088 and 80286**; the **80386 AT path is experimental**. Additional ARM and
other targets depend on the selected backend and available artifacts — they are
not all included simply by installing this package.

Debugger integrations provide target-specific execution control, breakpoints,
inspection and, where supported, recording and replay; the features and
peripheral coverage vary by target. See the
[target factory](src/debug-target-factory.js), the
[debug session](src/debug-session.js), the
[replay surface](docs/DEBUG-TARGET-REPLAY-SURFACE.md) and — for the experimental
x86 work — the [80386 guide](docs/I80386-EXPERIMENTAL.md), the
[x86 loading guide](docs/X86-LOADING-GUIDE.md) and the
[x86 checkpoint and next lanes](docs/X86-NEXT-LANES.md).

## Performance

The engine and its native-acceleration experiments are measured against a
plain-JavaScript baseline on fixed fixtures, and the baseline is kept unless a
candidate clears an explicit, every-window real-time gate. Those measurements are
host- and workload-specific and change constantly, so the exact numbers, the A/B
candidates, and what was and was not adopted live in their own receipts under
[`docs/receipts/`](docs/receipts) and in
[the target handoff](docs/TARGET-NEXT-LANES.md) — not in this README. No benchmark
in those documents is a universal or current-main speed guarantee.

## Limits

This is not a universal SPICE replacement or a calibrated model of every physical
component. Supported parameters, nonlinear convergence, timing, parasitics and
thermal behaviour depend on the selected model and analysis; strict
operating-point APIs refuse unsupported domains or conflicting constraints, so
inspect their result rather than treating a diagnostic as a valid solve.

Instruction and machine tests do not establish universal peripheral coverage,
silicon-exact timing or compatibility with every program, and simulation
throughput depends on the circuit, observers, backend and host machine.

## Develop and verify

```sh
npm ci
npm test
node scripts/oracle-census.mjs
```

The oracle census reports the independent tools available and the gates that
require them; an explicit skip is not a successful oracle comparison. Some tests
need external tools or backend artifacts, and heavy suites can run in
[GitHub Actions](https://github.com/CrispStrobe/bw-board/actions).
[VERIFICATION.md](VERIFICATION.md) explains the evidence and its limits,
[ROADMAP.md](ROADMAP.md) tracks development, and [LANES.md](LANES.md) records
contributor ownership and the upstream-first package regime.

## License and affiliation

MIT — see [LICENSE](LICENSE) and the [third-party notices](THIRD-PARTY.md).

bw-board is an independent project. It is not affiliated with, authorized by, or
endorsed by any of the companies whose processors, boards or file formats it
models or names for compatibility (among them Arduino, Raspberry Pi and STC, and
the circuit formats supported through bw-circuit-ui). Those names are used only
to identify compatible hardware and formats; all trademarks belong to their
respective owners.
