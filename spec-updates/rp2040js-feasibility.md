# rp2040js as the Pico emulator — feasibility assessment

**Filed:** 2026-08-12
**Status:** Adapter and debug target landed (commits 58227a6, 75a2246, 255dd78).
This note records the API surface assessment, what maps cleanly, and what
gaps remain for the engine owners.

## rp2040js API surface

[rp2040js](https://github.com/nicklausw/rp2040js) (MIT) is a pure-TypeScript
RP2040 emulator. The package exports:

- **`RP2040`** — the SoC: `core` (Cortex-M0+), `gpio[0..29]`, `adc`, `uart[0..1]`,
  `sram`, `clock` (SimulationClock), `writeUint16/32`, `readUint16/32`.
- **`GPIOPinState`** — enum: `Low`, `High`, `Input`, `InputPullUp`,
  `InputPullDown`, `InputBusKeeper`.
- **`ConsoleLogger` / `LogLevel`** — logger attached to `rp2040.logger`.

### GPIO model

Each `rp2040.gpio[i]` is a `RPGPIOPin` with:
- `.addListener((state: GPIOPinState) => void)` — fires on every output change.
- `.value` — current pin state (GPIOPinState enum).
- `.setInputValue(high: boolean)` — inject external input from the board.

**Push-pull, input, and pull-up map directly to boundary A's PinMode.**
`InputPullDown` has no PinMode equivalent (the 8051/AVR never needed one).
The adapter maps it to plain `'input'`, pull lost. Extending PinMode to
support pull-down requires an MNA change (spec-update + hand-computed oracle).

### Timer / PWM model

rp2040js models the RP2040's hardware PWM block:
- 8 PWM slices, 2 channels each (A/B), accessible via memory-mapped registers.
- PWM output drives the GPIO pin state through the function-select mux, and
  the GPIO listener fires on each edge — the same pattern avr8js uses via
  `timerOverridePin`.
- No special adapter work needed: GPIO listeners already catch PWM edges.

### Clock / time model

`rp2040.clock` is a `SimulationClock`:
- `.nanos` — current simulated time in nanoseconds (floating-point).
- `.tick(dt)` — advance by `dt` nanoseconds.
- `.nanosToNextAlarm` — time until the next scheduled alarm (0 if none).
- Alarms schedule peripheral events (UART timing, timer interrupts, etc.).

**Boundary A's `advanceTo(tNs)` maps directly** — no cycle-to-ns conversion
needed (unlike avr8js where `tNs = cycles × 1e9 / clockHz`).

### ADC model

- `rp2040.adc.onADCRead` — callback when firmware starts an ADC conversion.
- `rp2040.adc.channelValues[ch]` — raw ADC value injected by the adapter.
- 12-bit resolution (0–4095), 3.3V reference.
- Channels 0–2 on GP26–GP28 reach the header; channel 3 (VSYS/3) and
  channel 4 (temperature sensor) are internal.

### UART model

- `rp2040.uart[0].onByte` — callback per transmitted byte.
- Used for `print()` output, same as avr8js USART0.

## Boundary-A adapter pattern fit

| Contract element | avr8js | rp2040js | Notes |
|-----------------|--------|----------|-------|
| `setPin(name, mode, high)` | GPIO listener → publishPin | GPIO listener → publishPin | Identical pattern |
| `advanceTo(tNs)` | Derived from `cpu.cycles` | Direct from `clock.nanos` | Simpler on rp2040js |
| `advanceNs(deltaNs)` | Instruction loop + cpu.tick() | Instruction loop + clock.tick() | rp2040js adds WFI/WFE sleep handling |
| ADC | AVRADC.onADCRead → completeADCRead | adc.onADCRead → channelValues[] | Different completion mechanism |
| Serial | AVRUSART.onByteTransmit | uart[0].onByte | Same pattern |
| Program loading | Flash words (Uint16Array) | SRAM halfwords + set PC/SP | No bootrom; flash/UF2 is a roadmap question |

**Verdict: the adapter pattern maps cleanly.** The adapter (src/rp2040js-adapter.js)
is 211 lines, structurally parallel to the avr8js adapter.

## What landed

1. **`src/rp2040js-adapter.js`** — full boundary-A adapter: GPIO listeners,
   ADC, UART0, WFI/WFE sleep acceleration, program loading to SRAM.
2. **`src/rp2040js-debug.js`** — boundary-D debug target: breakpoints (code,
   yield), single-step, memory read/write, SRAM+Flash spaces.
3. **`src/debug-target-factory.js`** — routes `'rp2040js'` to the adapter.
4. **Tests** — adapter (174 lines) and debug target (226 lines) with
   hand-assembled Thumb programs.

## Open gaps

| Gap | Severity | Who |
|-----|----------|-----|
| **Pull-down PinMode** — RP2040 supports internal pull-down; boundary A has no mode for it. Currently mapped to plain `'input'`, pull lost. | Medium — affects circuits relying on pull-down (buttons to GND without external resistor). | Engine owners (MNA change + spec-update) |
| **PWM brightness** — GPIO listeners fire on PWM edges (same as avr8js), so LED brightness should work. Not yet oracle-tested for rp2040js. | Low — proven on avr8js, same mechanism. | bw-board (add rp2040js PWM oracle tests) |
| **Flash/UF2 boot** — program loading uses SRAM shortcut. Real boot requires bootrom. | Low — MicroPython route may not need it. | Roadmap question |
| **Pico W (CYW43)** — WiFi/BLE chip not modeled. | N/A for circuit sim. | Out of scope |
| **PIO** — RP2040's Programmable I/O not modeled by rp2040js. | Low — affects NeoPixels on Pico but not basic GPIO/PWM. | Upstream rp2040js |

## Recommendation

rp2040js is a clean fit for boundary A. The adapter and debug target are
already functional. The main action item is the pull-down PinMode extension,
which is an engine-level change shared with any future platform that has
pull-downs (STM32, ESP32).
