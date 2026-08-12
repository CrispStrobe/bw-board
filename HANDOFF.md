# bw-board handoff — 2026-08-12

**1280 tests, 0 failures.** All pushed to master.

## Completed this session (sessions 2–3)

- **`parseIntelHex`** (`src/intel-hex.js`): canonical Intel HEX → Uint16Array loader for AVR flash. Little-endian byte pairs, checksum validation, extended address records (types 02/04). 17 oracle tests. `avr-e2e.test.js` now uses the shared parser.
- **Board-kind power pins** (`src/devices/board-kinds.js`): `arduino_nano`, `arduino_uno`, `pi_pico` device models that stamp power terminals (5V, 3V3, GND, VIN, VBUS, VSYS) as Thévenin sources. GPIO terminals left for the boundary-A adapter. 13 oracle tests.
- **Twin-implementation documentation**: `pin-functions.js` cross-references `bw-circuit-ui/src/model/pin-functions.js`; `spec-updates/pin-alternates-schema.md` §Two implementations records both accessor call sites.
- **AVR cross-check** (`test/avr-cross-check.test.js`): two tests, both against **simavr** (independent lineage). (a) Tight toggle: 21 PB5 transitions agree. (b) **Brightness firmware** (`_delay_ms(500)` blink, the actual program behind 0.5882): ON period avr8js=500000125ns, simavr=500000130ns — **5 ns difference** (< 1 cycle). Positive control asserts VCD non-empty. **AVR row: category 3 → category 1.** Recorded as `spec-updates/avr-cross-check.md`.
- **debug-target-factory 'avr8js' routing** (`src/debug-target-factory.js`): factory routes 'emulator', 'avr8js', 'serial'. The avr8js path creates adapter, attaches board, parses hex via `parseIntelHex`, dynamically imports `avr8js-debug.js` (coordinator writing `createAvr8jsDebugTarget`). Returns `{ adapter }` without target until that module exists. 3 factory tests.
- **Uno sidecar now fully audited**: bw-parts populated all 28 Uno pins (was all-null). pin-functions tests updated accordingly.

## Completed previously (session 1 and before)

- **111 part kinds**, servo/motor/relay/button/ADC end-to-end through emu8051 + board.
- **Servo pulse**: 1499.6 µs (emu8051) = 1499.6 µs (ucsim) after SETB/CLR cycle fix.
- **LED brightness**: 0.07248 end-to-end, 0.5882 for AVR blink (both derived, exact).
- **Idle-timeout resync**: all 4 pre-registered predictions confirmed via stc12_trace -inject.
- **Serial DebugTarget e2e**: HELLO/REGS/READ against real firmware, no mock.
- **AVR first program**: blink.c → avr-gcc → avr8js → adapter → board → LED.
- **getPinFunctions()**: reads bw-parts sidecars, preserves null vs [] distinction.
- **Two-budget DRC**: chip 120 mA + supply 500 mA USB, vendored from bw-parts.
- **Scope channels**, advanceTo sub-stepping, CC mode in MNA, input-pullup PinMode.
- **avr8js adapter USART0 + full ADC** (efa7ac9): USART0 peripheral, ADC channels 0–7, onSerial callback.

## In flight

| File | Intent | Next step |
|------|--------|-----------|
| Ledger (`stc/docs/VERIFICATION-LEDGER.md`) | AVR row now cat 1 (avr8js + simavr cross-check). | Update ledger row to reflect cat 1 with the evidence from `spec-updates/avr-cross-check.md`. |
| `spec-updates/rst-polarity.md` | RST active HIGH on STC12. Engine hard-codes per kind. | Not yet implemented in board.js — a per-family polarity table is needed. |
| `debug-target-factory.js` | Routes 'emulator', 'avr8js', 'serial'. | Coordinator writing `createAvr8jsDebugTarget` in `avr8js-debug.js` — dynamic import slot ready. rp2040 deferred until it lands on a default branch and is announced. |
| `spec-updates/pin-alternates-schema.md` | Schema settled, twin implementations documented. | All boards now fully audited (zero nulls). Schema stable. |

## Learned (not yet in a spec-update)

- **simavr VCD trace requires `AVR_MCU_VCD_PORT_PIN` macro** (not the raw struct form — fields differ between simavr versions). Needs `-I/usr/include/simavr` and `libsimavr-dev` packages.
- **simavr `--list-cores` returns exit code 1** — `which simavr` is the reliable probe in tests.
- **simavr buffers VCD, flushes only on clean exit** — infinite-loop firmware produces 0-byte VCD. Use finite firmware with `SLEEP_MODE_PWR_DOWN` so simavr stops cleanly.
- **The rp2040js adapter commits (bc6476d etc.) exist in lite** but on a branch not merged to its default branch. They touch debug-target-factory.js and infer-netlist.js. Coordinator says: treat as exploratory until merged and announced. Do not build against it.
- **avr8js and simavr agree on transition values but diverge ~3 cycles on timing** for later tight-loop iterations. For the brightness firmware (500ms delay), agreement is < 1 cycle (5 ns). The cross-check asserts values and duty, not sub-cycle identity.
- **`execFileSync` with piped stdio blocks on large trace output** — use `spawnSync` with `stdio: 'ignore'` and read results from files.

## Blocked

| Item | Blocked on | Owner |
|------|-----------|-------|
| NeoPixel cat 1 cross-check | Re-measure on fixed emu8051 WASM | bw-board (emu8051 build available) |
| Headless live E2E (Playwright) | Memory constraint on shared VPS | Deferred |

## Standing rules

- Push at every checkpoint. Notify blocked agents by name when you clear their blocker.
- No positioning in committed content. Licence audit names are kept.
- `free -m` before anything heavy. Check `~/.cache/ms-playwright` before installing.
- Scan other repos' `spec-updates/` at session start.
- Assert the property, not the symptom. A check that has never failed has not been shown to work.
- VERIFICATION-LEDGER.md is the authority for categories. Prose matches the ledger, never the reverse.
- Nothing has run on real silicon. Categories 1/2/3 per `stc/docs/EVIDENCE-CATEGORIES.md`.
