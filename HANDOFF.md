# bw-board handoff — 2026-08-11 (session 2)

## Completed this session

- **`parseIntelHex`** (`src/intel-hex.js`): canonical Intel HEX → Uint16Array loader for AVR flash. Little-endian byte pairs, checksum validation, extended address records (types 02/04). 17 oracle tests. `avr-e2e.test.js` now uses the shared parser.
- **Board-kind power pins** (`src/devices/board-kinds.js`): `arduino_nano`, `arduino_uno`, `pi_pico` device models that stamp power terminals (5V, 3V3, GND, VIN, VBUS, VSYS) as Thévenin sources. GPIO terminals left for the boundary-A adapter. 13 oracle tests.
- **Twin-implementation documentation**: `pin-functions.js` cross-references `bw-circuit-ui/src/model/pin-functions.js`; `spec-updates/pin-alternates-schema.md` §Two implementations records both accessor call sites.
- **AVR cross-check** (`test/avr-cross-check.test.js`): avr8js vs simavr on the same firmware. 21 PB5 transitions, values agree perfectly. Positive control confirms VCD has real transitions. **AVR row: category 3 → category 1** (two-implementation agreement, independent lineage). Recorded as `spec-updates/avr-cross-check.md`.
- **debug-target-factory 'avr8js' routing** (`src/debug-target-factory.js`): factory now routes 'emulator', 'avr8js', and 'serial'. The avr8js path creates an adapter, attaches board, parses hex, and dynamically imports `avr8js-debug.js` (coordinator writing `createAvr8jsDebugTarget` against this seam). Returns `{ adapter }` without target until that module exists.

## Completed previously

- **111 part kinds**, now 1264 tests, all green.
- **Servo/motor/relay/button/ADC** verified end-to-end through emu8051 + board.
- **Servo pulse**: 1499.6 µs (emu8051) = 1499.6 µs (ucsim) after SETB/CLR cycle fix.
- **LED brightness**: 0.07248 end-to-end, 0.5882 for AVR blink (both derived, exact).
- **Idle-timeout resync**: all 4 pre-registered predictions confirmed via stc12_trace -inject.
- **Serial DebugTarget e2e**: HELLO/REGS/READ against real firmware, no mock.
- **AVR first program**: blink.c → avr-gcc → avr8js → adapter → board → LED.
- **getPinFunctions()**: reads bw-parts sidecars, preserves null vs [] distinction.
- **Two-budget DRC**: chip 120 mA + supply 500 mA USB, vendored from bw-parts.
- **Scope channels**, advanceTo sub-stepping, CC mode in MNA, input-pullup PinMode.

## In flight

| File | Intent | Next step |
|------|--------|-----------|
| Ledger (`stc/docs/VERIFICATION-LEDGER.md`) | Coordinator recategorised rows in `844966a` — retired "2b", applied defined categories 1/2/3. | AVR row now cat 1 (avr8js + simavr). Update ledger to reflect. |
| `spec-updates/pin-alternates-schema.md` | Schema settled, twin implementations documented. | Waiting on bw-parts to populate remaining null pins. |
| `spec-updates/rst-polarity.md` | RST active HIGH on STC12. Engine hard-codes per kind. | Not yet implemented in board.js — a per-family polarity table is needed. |
| `debug-target-factory.js` | Routes 'emulator', 'avr8js', 'serial'. | Coordinator writing `createAvr8jsDebugTarget` in `avr8js-debug.js` — dynamic import slot ready. rp2040 deferred until it lands on a default branch. |

## Learned this session

- **simavr VCD trace requires `AVR_MCU_VCD_PORT_PIN` macro** (not the raw struct form — fields differ between simavr versions). Needs `-I/usr/include/simavr` and `libsimavr-dev`.
- **simavr `--list-cores` returns exit code 1** — `which simavr` is the reliable probe.
- **The rp2040js adapter commits (bc6476d etc.) exist in lite** but on a branch not merged to its default branch. They touch debug-target-factory.js and infer-netlist.js (bw-board's files, vendored into lite).
- **avr8js and simavr agree on transition values but diverge ~3 cycles on timing** for later loop iterations. This is expected — pipeline/interrupt modeling differs. The cross-check asserts values, not sub-cycle timing.

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
