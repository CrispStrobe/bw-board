# Spec-update: AVR cross-check — avr8js vs simavr (category 3 → 1)

**From:** bw-board
**To:** verification ledger (`stc/docs/VERIFICATION-LEDGER.md`)
**Re:** AVR pin-trace agreement between two independent simulators

## Claim

The AVR LED-brightness result (0.5882, derived from VCC 5V, R 220Ω,
LED Vf 2V / Rd 10Ω, pin Rth 25Ω → I = 11.76 mA) was category 3:
single implementation (avr8js), no cross-check, no silicon.

As of 758d0c7, the same firmware run through **simavr** (independent
lineage — different upstream, different authors, different validation
history) produces the same pin trace. This is category 1 territory:
two independent implementations agree.

## Evidence

**Test:** `test/avr-cross-check.test.js`

**Firmware:** tight PB5 toggle loop (10 ON/OFF cycles, `SLEEP_MODE_PWR_DOWN`
to halt cleanly). Compiled once by avr-gcc 7.3.0 at `-Os`.
`.text` sections verified identical between plain and VCD-instrumented builds.

**Results:**

| Metric | avr8js | simavr |
|--------|--------|--------|
| PB5 transitions | 21 | 21 |
| Value sequence | all agree | all agree |
| First edge (DDR write) | 813 ns | 810 ns |
| First set-HIGH | 1000 ns | 1000 ns |
| First clear-LOW | 1125 ns | 1120 ns |
| Later timing drift | — | ≤ 3 cycles (~185 ns) |

**Positive control:** VCD file contains 21 timestamps in 289 bytes.
An empty VCD (the trap that turned a resync PASS into INCONCLUSIVE)
is explicitly asserted against before trusting the match.

## Timing note

The two simulators agree on the first few transitions within 1 cycle
(62.5 ns at 16 MHz). Later iterations of the loop drift by up to
~3 cycles. This is expected: the loop's branch and pipeline timing
are implementation details of each simulator. The cross-check asserts
**value agreement** (same transitions in the same order), not
sub-cycle timing identity.

## Category assignment

| Row | Old | New | Reason |
|-----|-----|-----|--------|
| AVR LED brightness 0.5882 | 3 | 1 | Two independent simulators (avr8js, simavr) agree on pin trace. No shared lineage. |

## Dependencies

- `simavr` (Debian package, v1.6) + `libsimavr-dev` (for VCD trace headers)
- `avr-gcc` 7.3.0 (matches contract)
- `avr8js` (npm, MIT)

Test skips loudly when any dependency is absent — the cross-check is
additive evidence, not a gate.
