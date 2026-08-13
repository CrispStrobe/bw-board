# bw-board handoff — 2026-08-13

**1324 tests, 0 failures.** All pushed to master and main.

## Completed this session (session 5)

- **`input-pulldown` PinMode** (MNA-gated): the RP2040's internal pull-down is now a real Thévenin source (vTh=0 V, rTh=50 kΩ, RP2040 Datasheet §2.19.6.3 Table 628). `rp2040js-adapter.js` maps `GPIOPinState.InputPullDown` → `'input-pulldown'` instead of the previous `'input'` lie. `InputBusKeeper` stays as `'input'` (adjudicated in `spec-updates/input-pulldown.md` — the bus-keeper is a latch, not a resistor). 8 hand-computed oracle tests: standalone pull-down, divider with 100kΩ and 10kΩ, button-to-VCC open/pressed, Thévenin values, driveHigh invariance.

## Completed previously (session 4)

- **AVR PWM observation** (`src/avr8js-adapter.js`): `publishPin` now uses `AVRIOPort.pinState()` instead of raw PORT register reads. Timer overrides (OC0A/OC0B on Timer0, OC2A/OC2B on Timer2) propagate to the board as real edges, so `ledBrightness` reflects hardware-PWM duty cycle. Without this fix, `analogWrite()` on an AVR had no effect on the board — the timer modified `overrideMask`/`overrideValue` but `publishPin` read the raw PORT register.
- **8 PWM oracle tests** (`test/avr8js-pwm.test.js`): Timer0 fast PWM on D5/D6 at 25/50/75% duty, Timer2 on D3/D11, edge-level transition counting, duty monotonicity, and simultaneous OC0A+OC0B with independent duties. All oracles are arithmetic: f_PWM = 16MHz/(64×256) = 976.5625 Hz; brightness = 0.15 × OCR/256. Each test runs 25 ms of simulated time (fills the 20 ms persistence window).
- **rp2040js feasibility note** (`spec-updates/rp2040js-feasibility.md`): API surface, GPIO/timer model, boundary-A adapter pattern fit, and open gaps (pull-down PinMode, PWM oracle tests). Updated to reflect that the adapter and debug target already landed (coordinator commits 58227a6, 75a2246, 255dd78).

## Completed previously (sessions 1–3)

- **`parseIntelHex`** (`src/intel-hex.js`): canonical Intel HEX → Uint16Array loader for AVR flash. Little-endian byte pairs, checksum validation, extended address records (types 02/04). 17 oracle tests.
- **Board-kind power pins** (`src/devices/board-kinds.js`): `arduino_nano`, `arduino_uno`, `pi_pico` device models that stamp power terminals (5V, 3V3, GND, VIN, VBUS, VSYS) as Thévenin sources. 13 oracle tests.
- **AVR cross-check** (`test/avr-cross-check.test.js`): avr8js vs simavr, 5 ns agreement on 500ms blink. **AVR row: category 1.**
- **debug-target-factory** routes 'emulator', 'avr8js', 'rp2040js', 'serial'.
- **rp2040js adapter + debug target** (coordinator): GPIO listeners, ADC, UART0, WFI/WFE, program loading to SRAM, boundary-D breakpoints/step/memory.
- **avr8js adapter USART0 + full ADC** (efa7ac9): USART0 peripheral, ADC channels 0–7, onSerial callback.
- **111 part kinds**, servo/motor/relay/button/ADC end-to-end through emu8051 + board.
- **LED brightness**: 0.07248 end-to-end (8051), 0.5882 for AVR blink (both derived, exact).
- **Scope channels**, advanceTo sub-stepping, CC mode in MNA, input-pullup PinMode.
- **Two-budget DRC**: chip 120 mA + supply 500 mA USB.
- **getPinFunctions()**, twin-implementation docs, Uno sidecar fully audited.

## In flight

| File | Intent | Next step |
|------|--------|-----------|
| Ledger (`stc/docs/VERIFICATION-LEDGER.md`) | AVR row now cat 1. | Update ledger row with evidence from `spec-updates/avr-cross-check.md`. |
| `spec-updates/rst-polarity.md` | RST active HIGH on STC12. | Not yet implemented — per-family polarity table needed in board.js. |
| `spec-updates/rp2040js-feasibility.md` | Adapter + debug target landed. Pull-down PinMode done. | rp2040js PWM oracle tests. |

## Learned (not yet in a spec-update)

- **avr8js timer override path**: `AVRTimer.updateCompA/B()` → `timerOverridePin()` → `writeGpio()` → GPIO listener. The override modifies `overrideMask`/`overrideValue`, not the PORT register. `publishPin` must use `pinState()` (which reads `lastValue`, the override-applied output) rather than the raw PORT register. Using the raw register silently drops all hardware-PWM edges.
- **simavr VCD trace requires `AVR_MCU_VCD_PORT_PIN` macro**, buffers, flushes only on clean exit.
- **avr8js and simavr agree on transition values but diverge ~3 cycles on timing** for later tight-loop iterations.
- **`execFileSync` with piped stdio blocks on large trace output** — use `spawnSync` with `stdio: 'ignore'`.
- **rp2040js GPIOPinState.InputPullDown** has no boundary-A PinMode equivalent. Currently mapped to plain `'input'`, pull lost.

## Blocked

| Item | Blocked on | Owner |
|------|-----------|-------|
| NeoPixel cat 1 cross-check | Re-measure on fixed emu8051 WASM | bw-board (emu8051 build available) |
| Headless live E2E (Playwright) | Memory constraint on shared VPS | Deferred |
| ~~Pull-down PinMode~~ | ~~RESOLVED~~ — `input-pulldown` PinMode landed | — |

## Standing rules

- Push at every checkpoint. Notify blocked agents by name when you clear their blocker.
- No positioning in committed content. Licence audit names are kept.
- `free -m` before anything heavy. Check `~/.cache/ms-playwright` before installing.
- Scan other repos' `spec-updates/` at session start.
- Assert the property, not the symptom. A check that has never failed has not been shown to work.
- VERIFICATION-LEDGER.md is the authority for categories. Prose matches the ledger, never the reverse.
- Nothing has run on real silicon. Categories 1/2/3 per `stc/docs/EVIDENCE-CATEGORIES.md`.
