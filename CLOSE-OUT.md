# bw-board close-out — 2026-08-10

## What was built

111 part kinds in `getPartKinds()`, 1206 tests, zero dependencies. The engine
models passives, semiconductors, 18 DIP logic ICs (chip-composer), 555/556
timers, motors, servos, relays, sensors, H-bridge, NeoPixel (NRZ decode from
pin edges), I2C devices, voltage regulators, batteries, and a CC-mode power
supply (MNA solver, CV→CC transition). Scope channels with fixed-cadence
min/max decimation. advanceTo sub-steps through device deadlines. Two-budget
current DRC (chip 120 mA + supply 500 mA USB).

## What was verified, with numbers and categories

All categories per `stc/docs/EVIDENCE-CATEGORIES.md`. Full ledger at
`stc/docs/VERIFICATION-LEDGER.md`.

**Category 1 (independent source):**
- 347-image corpus: 0 genuine disagreements, emu8051 vs ucsim (different upstreams)
- 70 ngspice golden circuits (independent reference solver)

**Category 2b (same-source agreement):**
- Servo: 1500.0 µs at 90° (emu8051), 1499.6 µs (ucsim), 0.4 µs spread. Derived anchor: 1500 µs from FOSC/12 arithmetic.
- Motor PWM: 84/128/192 of 256 counts (register), 32.83% pin duty (ucsim). Period 277561 ns.
- LED brightness: 0.07248 (emu8051 → adapter → board), 0.07246 analytic (0.03%). Found the adapter time-zero bug.
- Relay: P2.0=0.6V → energised=true. No spurious INT0 enable.
- Button: open=5.0V/1, pressed=0.0V/0. INT0 NOT enabled.
- ADC register sequence: ADC_CONTR=0xE0, P1ASF=0x02, P1M1 high-Z. **Analog path open (BENCH-ADC).**
- NeoPixel: T0H=362ns, T1H=814ns, T0L=814ns, T1L=452ns — all four WS2812B windows pass. No strip has lit.
- UART TX: 86.8 µs at 115200 (ucsim). emu8051 untimed. Idle-timeout resync unreachable in emulation.
- Cube: 124.3 Hz refresh, invariant-based oracle (not golden-file). Polarity and voxel map open (BENCH-CUBE).
- RC: within 5% of analytic. 555 astable: 214 ms vs 207.9 ms (3%).

**Nothing has run on real silicon.** The bench predictions (BENCH-ADC/CUBE/UART/PWM) are pre-registered in `stc/docs/BENCH-SESSION.md` with tolerances. A category 2b measurement cannot discharge them.

## What was found and fixed

Each produced a plausible wrong answer that would have shipped.

| Defect | How it presented | What found it |
|--------|-----------------|---------------|
| `IE = 0x00` — PCA ISR never fires | Servo compiles, flashes, does nothing | bw-board e2e test |
| `IE.6` is ELVD, not EC | Bogus `EC=1` enables LVD, not PCA | SDCC's `stc12.h` (category 1 source) |
| PCA enable is ECCF in CCAPMn, not in IE | Both emulators checked IE | Contract correction |
| EA after CR — init race | First CCF0 lost, ISR never enters | Analysis of match-at-zero |
| `advanceTo` never called `_updateDevices` | Relay never energised without pin activity | bw-cfront assertion |
| Adapter push-mode: no `advanceTo` before `setPin` | All 214 PWM edges at time zero, brightness=0 | Cross-model brightness check |
| NeoPixel all-zeros (`A` vs `DPL`) | Bits sent but all zero | ucsim bit-stream measurement |
| NeoPixel 1-of-9 bytes (`djnz r7` clobber) | Invisible while all bytes were zeros | ucsim re-measurement |
| NeoPixel R6 assumed free | First fix trusted allocator, not `.asm` | Checking the listing |
| L293D right-side pins scrambled | Part art teaches wrong wiring | bw-parts vs datasheet |
| MCU sidecar: PSEN/ALE/EA instead of P4.x | Cross-check passed by excluding MCU | bw-parts vs PINOUT.md |
| `§4.6` citation fabricated | Four docs cited wrong section | Reading the actual PDF |
| `aggregateCurrent()` in test only, not src | DRC warning existed as a test, not code | Grepping for the function |
| Rating schema change — stale vendored copy | `0 + 'circuit'` = `'0circuit'` | Coordinator grep |
| `CL`-wrap bug in ucsim 16-bit compare | PCA match at wrong count | ucsim measurement |
| ROADMAP claimed "ADC proven on hardware" | Introduced in a doc-levelling pass | Coordinator reading |

## What is open, by bench ID

| Bench ID | What it settles | Status |
|----------|----------------|--------|
| **BENCH-ADC** | ADC analog path (real pot → real ADC code) | Pre-registered prediction: ratio ~20:1 across pot travel |
| **BENCH-CUBE** | Polarity (active-high?), voxel map (64 rows empty) | Pre-registered: one LED at (FE,01) |
| **BENCH-UART** | Monitor over real UART, halt skew, ISP contention | Pre-registered: 500 ±50 ms halt |
| **BENCH-PWM** | LED current, servo pulse, motor duty on silicon | Pre-registered: 1.46 mA at 50% duty |

## Serial DebugTarget e2e — DONE

`serial-debug.js` driven against emu8051's real UART running `10-live-firmware`
with no mock in the path. HELLO, REGS (8 fields), READ (iram[0]) all
round-tripped successfully. Two independent implementations (host JS codec +
firmware C codec) agree over a transport neither owns. Category 2b.

Idle-timeout resync: unreachable under emu8051 (instant bytes). ucsim
`stc12_trace -inject` (a81091e) CAN reach it — Timer 1 wall clock runs, 5ms
timeout fires. Test framework written: sends a torn frame, waits 10ms for
idle timeout, sends valid HELLO. **Loudly skips** when `stc12_trace` binary is
absent (needs rebuild). When the binary is available, the test runs the
resync path end-to-end.

## What is open, not bench-blocked

| Item | Owner | Status |
|------|-------|--------|
| Cube oracle path (`test/golden/`) contradicts "not golden-file" | bw-board | Noted, not moved |
| bw-parts / bw-board rating table convergence | Both | Vendored copy in bw-board; bw-parts owns canonical |
| Idle-timeout resync execution | ucsim-stc | `stc12_trace` needs rebuild with `-inject` (link error). Test framework ready, skips loudly. |

## Principles this campaign produced

1. **Assert the property, not the symptom.** Testing for absence catches one thing; asserting what IS catches the class.
2. **A category 2b measurement cannot discharge a prediction.** Re-deriving the number checks transcription, not the chip.
3. **Every exclusion in a cross-check is an unchecked claim.** The MCU sidecar error survived because the MCU was excluded.
4. **A check that has never failed has not been shown to work.** Four guards were correct and inert; three tests examined nothing.
5. **The pass that audits claims is itself where claims get made.** Nobody re-checks the auditor.
6. **Silicon remains the only source independent of every document.**
