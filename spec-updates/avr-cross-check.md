# Spec-update: AVR cross-check — avr8js vs simavr (category 3 → 1)

**From:** bw-board
**To:** verification ledger (`stc/docs/VERIFICATION-LEDGER.md`)
**Re:** AVR pin-trace agreement between two independent simulators

## Claim

The AVR LED-brightness result (0.5882, derived from VCC 5V, R 220Ω,
LED Vf 2V / Rd 10Ω, pin Rth 25Ω → I = 11.76 mA) was category 3:
single implementation (avr8js), no cross-check, no silicon.

Two cross-checks now run, both using **simavr** (independent lineage —
different upstream, different authors, different validation history):

1. A tight PB5 toggle loop (21 transitions) — confirms pin-level
   edge agreement.
2. The **actual brightness firmware** (`_delay_ms(500)` blink, 2 cycles)
   — confirms duty-cycle agreement on the same program shape that
   produced the 0.5882 result.

## Evidence

**Test:** `test/avr-cross-check.test.js` (two test cases)

### Test 1: tight toggle (pin-level edge agreement)

**Firmware:** tight PB5 toggle loop (10 ON/OFF cycles, `SLEEP_MODE_PWR_DOWN`
to halt cleanly). Compiled once by avr-gcc 7.3.0 at `-Os`.
`.text` sections verified identical between plain and VCD-instrumented builds.

| Metric | avr8js | simavr |
|--------|--------|--------|
| PB5 transitions | 21 | 21 |
| Value sequence | all agree | all agree |
| First edge (DDR write) | 813 ns | 810 ns |
| First set-HIGH | 1000 ns | 1000 ns |
| First clear-LOW | 1125 ns | 1120 ns |
| Later timing drift | — | ≤ 3 cycles (~185 ns) |

### Test 2: brightness firmware (duty-cycle agreement)

**Firmware:** `_delay_ms(500)` toggling PB5, 2 full ON/OFF cycles, then
`SLEEP_MODE_PWR_DOWN`. This is the same program shape as the avr-e2e
test that produced the 0.5882 brightness (the only difference: 2 cycles
+ sleep instead of infinite loop, so simavr exits cleanly).

| Metric | avr8js | simavr |
|--------|--------|--------|
| PB5 transitions | 5 | 5 |
| Value sequence | all agree | all agree |
| ON period | 500,000,125 ns | 500,000,130 ns |
| ON-period difference | — | **5 ns** (< 1 cycle) |
| Expected ON period | 500,000,000 ns | 500,000,000 ns |

The 5 ns inter-simulator difference is less than a single clock cycle
(62.5 ns at 16 MHz). Both simulators produce a 50% duty cycle to
within 130 ns of the theoretical 500 ms.

**Why this closes the gap:** Brightness 0.5882 is a function of pin
duty and the circuit model. The circuit model (VCC, R, LED Vf/Rd,
pin Rth → 11.76 mA) is bw-board's own analytic derivation, never
simulator-dependent. The simulator-dependent half is the pin duty
cycle — and that is what this cross-check tests on the actual
brightness firmware, not a different program.

### Positive control (both tests)

Both VCD files are asserted non-empty before any comparison. An empty
VCD (the trap that turned a resync PASS into INCONCLUSIVE) would
produce false agreement.

## Timing note

The two simulators agree on the first few transitions within 1 cycle
(62.5 ns at 16 MHz). The tight-toggle test drifts by up to ~3 cycles
on later iterations — expected, since branch/pipeline modeling differs.
The brightness firmware shows sub-cycle agreement on the timing that
matters: the 500 ms delay period.

The cross-check asserts **value agreement** (same transitions in the
same order) and **duty-cycle agreement** (ON periods match), not
sub-cycle identity on every edge.

## Category assignment

| Row | Old | New | Reason |
|-----|-----|-----|--------|
| AVR LED brightness 0.5882 | 3 | 1 | Two independent simulators (avr8js, simavr) agree on pin trace AND duty cycle of the brightness firmware. No shared lineage. |

## Dependencies

- `simavr` (Debian package, v1.6) + `libsimavr-dev` (for VCD trace headers)
- `avr-gcc` 7.3.0 (matches contract)
- `avr8js` (npm, MIT)

Test skips loudly when any dependency is absent — the cross-check is
additive evidence, not a gate.
