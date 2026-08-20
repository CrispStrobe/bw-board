# bw-board

Circuit simulation engine for a learning-oriented breadboard designer.
Resolves pin drive states into node voltages, LED brightness, buzzer tones,
servo angles, motor speeds, and relay states — from pin-level physics, not
shortcuts.

Zero runtime dependencies. Runs in a browser or Node.js. MIT licensed.
1357 tests, 0 failures. 129+ part kinds. Two vector-verified CPU cores.

## What is in this repo

**Core engine** (`src/board.js`, `src/mna.js`): closed-form solver for
resistive networks + MNA with Newton–Raphson for nonlinear elements (diodes,
transistors, op-amps, zener). Gaussian elimination with partial pivoting.
CV→CC power supply mode (vsource with `iLimit`). Scope channels with fixed
sim-time cadence and min/max decimation. `advanceTo` sub-steps through device
deadlines so timed transitions (relay switching, motor spin-up, servo travel)
fire at the correct simulated time, not just at the destination.

**111 part kinds** across built-in models (31) and a device registry (80):
- Passives: resistor, capacitor, inductor, diode, zener, LED, potentiometer,
  button, switch, buzzer, LDR, NTC, fuse
- Semiconductors: NPN, PNP, NMOS, PMOS, op-amp, TIP120
- 18 DIP logic ICs via chip-composer (74HC00/02/04/08/10/11/14/20/21/27/32/
  73/74/86/93/95/132, CD4511) — one table-driven helper, not 18 hand-written models
- Digital ICs: CD4017 decade counter, D/JK flip-flops, 74HC283 adder,
  74HC75 latch, PCF8574 I2C expander, Darlington driver
- Analog ICs: 555 timer, 556 dual, LM393/LM339 comparators
- Power: battery variants (9V/AA/coin), LM7805, LD1117V33, solar cell, USB-A
- Actuators: DC motor (back-EMF), motor with encoder (quadrature), servo
  (pulse-width decode from pin edges), stepper, solenoid, vibration motor,
  relay SPDT/DPDT, H-bridge (L293D)
- Sensors: TMP36, ultrasonic, PIR, tilt, flex, force, gas, phototransistor,
  photodiode, soil moisture, ambient light
- Display: NeoPixel (WS2812B NRZ decode from 800 kHz pin edges), bargraph,
  clock display, I2C LCD backpack
- Connectors: header, USB-A

**DebugTarget implementations** — emu8051 (with `emu_disasm`, verified
237/0 against an independent table), avr8js (ATmega328P/2560, ATtiny85
via chip param), rp2040js, eater6502, serial (real firmware over UART).
Factory at `src/debug-target-factory.js`. Disassembly panes for the
non-8051 targets are planned (live table disasm for owned cores,
service-side objdump listings for toolchain targets).

## The retro tier (2026-08)

**Two CPU cores, ours, verified end to end against ground truth:**
- `src/w65c02.js` — W65C02, 2,540,000/2,540,000 SingleStepTests vectors,
  both Klaus Dormann suites (52M instructions), 52.6M instructions in
  lockstep with vrEmu6502 (three documented, vector-adjudicated
  divergences). Grinder: `scripts/grind-w65c02.mjs`.
- `src/z80.js` — Z80, 1,604/1,604 vector files (1.6M vectors) including
  the undocumented machinery: X/Y flags, the Q latch, MEMPTR, R per M1,
  interrupted-repeat block-op rules derived from the vectors themselves.
  Grinder: `scripts/grind-z80.mjs`.

**Composable machines** — a machine is a CONFIG (preset, declared
MAP/CHIP pseudocode, or a hand-wired breadboard solved by the bus
extractors):
- `src/m6502-machine.js` — regions + memory-mapped chips (`src/w65c22.js`
  VIA, `src/w65c51.js` ACIA, both datasheet clean-room). Presets:
  EATER6502, HB6502 (mike42, CC-BY facts). Extractor:
  `src/m6502-extract.js` (contention/open-vector refusals with
  addresses named).
- `src/z80-machine.js` — regions + PORT-mapped chips (`src/mc6850.js`),
  IM 1 delivery in the machine layer. Presets: SEARLE, CPM64K.
  Extractor: `src/z80-extract.js` (MREQ/IORQ-aware, per-space
  contention).
- `src/vdu-decoder.js` — the BBC VDU byte protocol as typed events
  (graphics without video hardware); `src/devices/hd44780.js` — the
  parallel character LCD as a board part.

**Whole-system smokes** (each skips loudly without its local artifact):
BBC BASIC 4 boots interactively on the 6502 machine with LCD state
asserted (`scripts/beebeater-smoke.mjs`); R.T. Russell's BBC BASIC
(Z80) boots over a CP/M shim (`scripts/bbcz80-smoke.mjs`); CP/M 2.2
with our own BIOS boots to A> and runs BBCBASIC.COM
(`scripts/cpm-smoke.mjs`); Microsoft BASIC 1.1 boots via the
basic-m6502-bw port. Twin-run CPU differential:
`scripts/twinrun-6502.mjs`.

**DRC warnings** (`getWarnings()`): overcurrent, missing resistor, aggregate
chip budget (120 mA, §4.1) + supply budget (500 mA USB), non-convergence,
device sub-step overflow. Two-budget current ratings vendored from
`bw-parts/current-ratings.json`.

**Five port modes**: quasi-bidirectional (25 Ω sink / 21.7 kΩ source),
push-pull, input-only, open-drain, input-pullup (35 kΩ, AVR). Source:
STC12 datasheet §4.1 for the first four; AVR datasheet for input-pullup.

## What is verified

Evidence categories per `stc/docs/EVIDENCE-CATEGORIES.md`. Full ledger at
`stc/docs/VERIFICATION-LEDGER.md`.

**Nothing in this repo has been validated against real silicon.**

Key results (all category 2b unless noted):
- Servo: 1500.0 µs at 90° (emu8051), 1499.6 µs (ucsim), 0.4 µs spread
- Motor: 84/128/192 of 256 counts, period 277561 ns
- LED brightness: 0.07248 end-to-end (found the adapter time-zero bug)
- 70 ngspice golden circuits (category 1 — independent solver)
- 347-image corpus: 0 disagreements across two emulators (category 1 — different upstreams)
- Serial DebugTarget: HELLO/REGS/READ round-tripped against real firmware
  UART with no mock. Baud accuracy not modelled (emu8051 §9 trap).
- NeoPixel: all four WS2812B timing windows pass (T0H=362 ns, T1H=814 ns)

16 defects found and fixed during verification. See `CLOSE-OUT.md`.

## What is NOT done

- **Bench session** (BENCH-ADC/CUBE/UART/PWM): four pre-registered predictions
  in `stc/docs/BENCH-SESSION.md`, all hardware-blocked
- **Idle-timeout resync**: test framework written, blocked on `stc12_trace`
  rebuild with `-inject` (ucsim-stc ccc3e9d)
- **Headless live E2E** (Playwright): blocked on memory constraints
- **Mutual inductance / transformers**: not modelled
- **Propagation delay in logic gates**: gates respond in zero time
- **Temperature, tolerance, parasitics**: not modelled. See `VERIFICATION.md` §4

## How to run

```bash
npm test                    # node --test (1357 tests)
node bench/perf.js          # performance benchmark
```

Requires Node 20+. No build step, no dependencies.

## Quick start

```js
import { BoardImpl, inferNetlist } from './src/index.js';

const { parts, nets } = inferNetlist({
  pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    { name: 'pot',  port: 1, bit: 3, direction: 'analog', activeLow: false },
  ],
});

const board = new BoardImpl(5.0);
board.setNetlist(parts, nets);
board.setPin('P1.0', 'quasi', false);  // LED on (active-low)
board.setControl('POT_pot', 0.5);
board.advanceTo(25_000_000n);

const state = board.getRenderState();
// state.leds[0].brightness ≈ 0.145
```

## Vendoring

Copy `src/` into the consuming project. `src/index.js` is the single entry
point. All imports are relative within `src/`. No build step, no dependencies.

## Performance

Measured on a single core (Node 20, Linux), 11-part netlist:

| Operation | Throughput |
|-----------|-----------|
| advanceTo (steady state) | ~233 K ops/sec |
| setPin (closed-form) | ~184 K ops/sec |
| branchCurrent (MNA cached) | ~7.6 M ops/sec |
| branchCurrent (MNA solve) | ~12 K ops/sec |

Meter cliff: 8.0 K edges/sec full per-edge path = 1.1× real time.
Display-rate sampling is load-bearing.

## Key documents

- `VERIFICATION.md` — what is verified, to what standard, and what is not
- `CLOSE-OUT.md` — campaign results: numbers, categories, defects, open items
- `DEVICE-CENSUS.md` — which device models respond to pin voltages vs block calls
- `PARTS-TARGET.md` — engine-specific notes on the parts catalogue
- `BLOCKED.md` — items waiting on external work

## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).


## Working in a git worktree

`node_modules` is no longer tracked (it used to be committed as a symlink
pointing at its own path, which dead-ended module resolution in a fresh
clone). A new worktree therefore starts with no dependencies, and the symptom
is specific and misleading: **every test that spawns a subprocess dies on
import**, because `avr8js` cannot be resolved. It looks like nineteen
unrelated failures, not one missing install.

Either install normally:

```sh
npm ci
```

or, to avoid a second copy on disk, borrow the main checkout's:

```sh
ln -s /path/to/bw-board/node_modules node_modules
```

## The lcapy oracle

`test/lcapy-oracle.test.mjs` checks the MNA solver against **lcapy**, an
independent symbolic circuit solver, rather than against hand-computed values
or our own recorded output. It skips — loudly, naming what it looked for — if
no Python with lcapy is available:

```sh
pipx install lcapy          # or set LCAPY_PYTHON to an interpreter that has it
```
