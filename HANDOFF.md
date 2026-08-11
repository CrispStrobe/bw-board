# bw-board handoff — 2026-08-11

## Completed since brief

- **111 part kinds**, 1231 tests, all green. Full target inventory.
- **Servo/motor/relay/button/ADC** verified end-to-end through emu8051 + board.
- **Servo pulse**: 1499.6 µs (emu8051) = 1499.6 µs (ucsim) after SETB/CLR cycle fix.
- **LED brightness**: 0.07248 end-to-end, 0.5882 for AVR blink (both derived, exact).
- **Idle-timeout resync**: all 4 pre-registered predictions confirmed via stc12_trace -inject.
- **Serial DebugTarget e2e**: HELLO/REGS/READ against real firmware, no mock.
- **AVR first program**: blink.c → avr-gcc → avr8js → adapter → board → LED.
- **getPinFunctions()**: reads bw-parts sidecars, preserves null vs [] distinction.
- **Two-budget DRC**: chip 120 mA + supply 500 mA USB, vendored from bw-parts.
- **Scope channels**, advanceTo sub-stepping, CC mode in MNA, input-pullup PinMode.
- **Path sweep**: 0 absolute paths in tracked files.
- **README, CLOSE-OUT, VERIFICATION.md, DEVICE-CENSUS.md** all current.

## In flight

| File | Intent | Next step |
|------|--------|-----------|
| Ledger (`stc/docs/VERIFICATION-LEDGER.md`) | Coordinator recategorised rows in `844966a` — retired "2b", applied defined categories 1/2/3. | Read `844966a`, verify bw-board's rows match. NeoPixel row is now eligible for cat 1 cross-check (cycle fix landed). |
| `spec-updates/pin-alternates-schema.md` | Schema settled: `"functions"`, `null` vs `[]`, `"analog_only"` as list value. | bw-parts generates JSON, bw-board vendors it. `getPinFunctions()` already reads sidecars. Waiting on bw-parts to populate remaining nulls. |
| `spec-updates/rst-polarity.md` | RST active HIGH on STC12. Engine hard-codes per kind. | Not yet implemented in board.js — a per-family polarity table is needed. |
| `spec-updates/i2c-ack-policy.md` | Observe-only is the contract. Drivers must not check ACK. | Recorded. No code change needed unless ACK driving is built later. |

## Learned, not yet in a spec-update

- **`execFileSync` with piped stdio blocks on large trace output** — use `spawnSync` with `stdio: 'ignore'` and read results from files. Cost two days of "INCONCLUSIVE" on the resync test.
- **`-inject` only fires in stc12_trace's `-until-ns` loop, not `-e run`** — two mutually exclusive execution loops. Any test combining `-e` with `-inject` silently does nothing.
- **Inject timing must be derived, not guessed** — the firmware configures UART at ~21ms; injecting before that delivers bytes to an unconfigured UART. Use a generous margin (50ms) with a named constant and a diagnostic assertion.
- **The Uno sidecar is entirely unaudited (28 null pins)** — do not alias it to the Nano. The null-vs-[] distinction is the Uno's main contribution to testing.

## Blocked

| Item | Blocked on | Owner |
|------|-----------|-------|
| NeoPixel cat 1 cross-check | Re-measure on fixed emu8051 WASM | bw-board (emu8051 build available) |
| Pi Pico adapter | No RP2040 emulator exists | Nobody — out of scope this campaign |
| Headless live E2E (Playwright) | Memory constraint on shared VPS | Deferred |

## Standing rules

- Push at every checkpoint. Notify blocked agents by name when you clear their blocker.
- No positioning in committed content. Licence audit names are kept.
- `free -m` before anything heavy. Check `~/.cache/ms-playwright` before installing.
- Scan other repos' `spec-updates/` at session start.
- Assert the property, not the symptom. A check that has never failed has not been shown to work.
- VERIFICATION-LEDGER.md is the authority for categories. Prose matches the ledger, never the reverse.
- Nothing has run on real silicon. Categories 1/2/3 per `stc/docs/EVIDENCE-CATEGORIES.md`.
