# Portable digital GPIO profiles

## PyBadge header correction (2026-11-28)

The CPU-backed LabWired header map previously assigned RX to PA17 and TX to
PA16. That made RX collide with SCK and TX with D5. The corrected GPIO
mapping uses **PB17 for RX and PB16 for TX**, leaving the independent PA17
and PA16 pins unchanged. This is a GPIO routing correction, not qualification
of native BASIC or every SAMD51 UART peripheral mode.

Primary pin-table evidence retrieved on 2026-11-28:

- [Adafruit CircuitPython PyBadge pins.c](https://github.com/adafruit/circuitpython/blob/main/ports/atmel-samd/boards/pybadge/pins.c),
  source blob `6c81b537c956e3a5081b4609f1ef26adedfe32b1`.
- [Adafruit ArduinoCore-samd PyBadge variant.cpp](https://github.com/adafruit/ArduinoCore-samd/blob/master/variants/pybadge_m4/variant.cpp),
  source blob `ebc2c7f48b86a559df69907d564bb7b6da1aa862`.

Both independent vendor tables identify the two UART pins on port B and the
SPI clock/D5 on port A. `test/labwired-chips.test.mjs` retains these separate
hardware anchors so a port-name transcription cannot silently join them again.

## Feature branch ownership

Owner: ChatGPT, continuing CrispStrobe's branch-only CrispBASIC work.
Base: `cc18f3c8d84d68e008450e65ddf838b8ec03c7f7`, the consumer's exact pin.
Feature branch: `feature/crispbasic-machine-profiles-20261128`.
Scope: new `src/portable-gpio.js`, `test/portable-gpio.test.mjs` and this guide.

Reuse the existing registered board models and Boundary A electrical solver.
Add explicit, immutable logical-pin profiles for host-driven digital simulation,
preserving existing Arduino, Pico and generic STC numbering. Validate actual
terminals, unique mappings, single-controller ownership and model logic voltage
before admitting a host. Qualify each admitted family with solved output/input
voltages and state release. Unknown models and ambiguous aliases remain
unavailable.

These profiles do not install an interpreter on a CPU, claim firmware or physical
hardware execution, or enable analog/PWM/interrupt operations. The user requested
incremental remote feature-branch preservation. This claim and candidate stay on
that branch; no default branch is merged. Consumers adopt the exact producer SHA.

## API

```js
import {
  PORTABLE_GPIO_PROFILES, getPortableGpioProfile, logicalPinForTerminal,
  resolvePortableGpioController,
} from 'bw-board/portable-gpio.js';

const { controller, profile, pins, pinMap } = resolvePortableGpioController(board);
console.log(profile.label, profile.nominalVoltage, profile.numbering);
// pinMap: [{pin: 0, terminal: 'p0'}, ...] for the actual circuit terminals.
```

`PORTABLE_GPIO_PROFILES` is a frozen inventory for user interfaces and capability
discovery. Each entry includes `kind`, `label`, `nominalVoltage`, `numbering`,
`help`, and a frozen list of `{pin, terminal}` entries. `nominalVoltage: null`
means the generic `mcu` surface uses the bench supply. The execution metadata
is always `host-driven-circuit`, `hardware: false`, `nativeInterpreter: false`.
`getPortableGpioProfile(kind)` returns an entry or `null`.

`logicalPinForTerminal(kind, terminal)` matches a complete canonical pad name
case-insensitively and returns an integer or `null`. It does not trim names,
guess aliases, translate header positions or add missing pads. The resolver
retains the circuit's actual terminal spelling and returns only its available
subset. It validates the registered model's GPIO contract, nominal voltage
and named pads before allowing a non-generic controller. It returns a frozen
mapping and changes no board state.

## Admitted electrical surfaces

| Model kind | Logical digital IDs | Model logic voltage |
| --- | --- | --- |
| `mcu` | P0.0–P7.7: `8 * port + bit`, limited to authored terminals | Bench supply |
| `arduino_uno`, `arduino_nano` | D0–D13: 0–13; A0–A5: 14–19 | 5 V |
| `arduino_mega` | D0–D53: 0–53; A0–A15: 54–69 | 5 V |
| `pi_pico` | GP0–GP22, GP25–GP28: GPIO number | 3.3 V |
| `microbit` | P0–P2: pad number | 3.3 V |
| `microbit_breakout` | P0, P1, P2, P8, P12, P16: pad number | 3.3 V |
| `calliopemini` | P0–P3: pad number | 3.3 V |
| `circuit_playground_express` | A0–A7: 0–7, used digitally | 3.3 V |
| `esp8266` | GPIO0–GPIO5, GPIO12–GPIO15: GPIO number | 3.3 V |
| `esp32_4848s040` | H1 GPIO1, GPIO2, GPIO40, GPIO43, GPIO44: GPIO number | 3.3 V |
| `attiny85` | PB0–PB5: 8–13 | 5 V |
| `attiny88` | PB0–PB7: 8–15; PC0–PC7: 16–23; PD0–PD7: 24–31 | 5 V |
| `attiny88_qfn32` | PA0–PA3: 0–3, plus the same PB/PC/PD IDs | 5 V |
| `stm32f030` | PA0–PA7, PA9/PA10: bit number; PB1: 17 | 3.3 V |
| `eater6502` | VIA1.PA0–PA7: 0–7; VIA1.PB0–PB7: 8–15 | 5 V |

These 16 model kinds represent a bounded interface to the existing circuit
solver. The ATtiny and STM32 IDs are explicit logical port encodings; they are
not Arduino board numbers. GPIO shares the existing model behavior, including
the engine's common digital threshold and output impedance. The bare-chip
profiles do not add supply sensing, reset/fuse/alternate-function behavior or
silicon timing. An electrical circuit host must still acquire the board clock,
retain output latches, enforce budgets and release drives on termination.

Pico GP25 retains the engine's onboard LED circuit and its loading. Nano A6/A7,
Pico's unexposed pads, ESP flash/display/memory pins, STM32 boot/reset/crystal/SWD
pads, and board supply terminals never become writable logical pins.

## Deliberate refusal boundaries

Exactly one controller is required because Boundary A's unqualified pin
namespace is shared. More than one recognized GPIO controller is rejected,
including an unqualified model that advertises `gpioFollowsPinStates`. Repeated
physical or case-aliased GPIO names reject the entire mapping. A circuit may
contain only a subset of a supported model, but must expose at least one
admitted digital pad.

PyBadge's serial/analog aliases and the case-duplicated `stc15_mcu` package
surface have no profile in this revision. The existing generic `mcu` STC port
surface remains available. Autonomous CP1/Microtronic machines and unqualified
retro DIP chip surfaces are not admitted merely because they expose GPIO.
Their execution/ownership or alias behavior needs separate qualification.

## Qualification

Run the new admission/electrical tests and the adjacent model regressions:

```sh
node --test test/portable-gpio.test.mjs test/makecode-boards.test.mjs \
  test/device-sources-once.test.mjs test/pico-onboard-led.test.mjs
```

The feature candidate passes 94 tests with no failures or skips. The 36 new
tests cover all 16 full registered terminal maps and partial authored maps,
fixed numbering anchors and package gaps, immutable capabilities, invalid
controller/alias/model refusal, and solved HIGH/LOW/released/input behavior on
every admitted pad. All 3.3 V models run on a 5 V bench in the electrical
checks; measured voltages must follow the model rather than the bench. Pico
GP25's current calculation includes the retained onboard LED load. This is
local electrical-model evidence, not native interpreter, physical-board or
complete firmware/peripheral qualification.
