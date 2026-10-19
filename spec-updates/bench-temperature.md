# Bench temperature — boundary B grows one number (E2.2)

## API

`board.setTemperature(celsius)` — one bench-wide ambient, default 25.
Non-finite input is ignored; a change re-solves and notifies
(`'temperature'`). Read back as `board.temperatureC`.

## Who consumes it

1. **Every silicon junction's forward drop, −2 mV/°C**: diode and LED
   vf, the zener's FORWARD vf, and the BJT's Vbe — applied identically
   in the stamp, the NR limiter, and the branch-current read, so the
   three views cannot disagree. The Shockley opt-in inherits it through
   its vf-based calibration.
2. **TMP36**: the bench temperature is its DEFAULT reading
   (0.5 V + 10 mV/°C); an explicit `params.tempC` pins the sensor and
   is never overridden — the general rule: a part whose user-set param
   already fixes the quantity wins over the ambient.
3. Device stamps see `ctx.temperatureC` for models that want it.

## What deliberately does NOT consume it

- **The zener's breakdown vz**: avalanche/zener tempco is a different,
  weaker, sign-varying physics; pretending −2 mV/°C would be invention.
- **The NTC**: its control is a NORMALIZED 0..1 fraction interpolating
  rCold→rHot, not celsius — routing the bench temperature in would
  require a calibration (which resistance at which temperature) the
  part does not declare. Mapping it anyway would be a guess wearing an
  ambient's clothes; the honest route is a future rCold/rHot-at-°C
  param set, noted here rather than half-done.
- Resistor tempco, battery chemistry, crystal drift: out of scope,
  stated.

## Oracles (same commit)

- TMP36 at the default bench reads 0.750 V; setTemperature(85) moves it
  to 1.350 V (0.5 V + 10 mV/°C from 0 °C — the offset is not 25-referenced);
  params.tempC: 25 holds 0.750 V at any bench temperature.
- A 5 V → 330 Ω → red LED chain's current rises by the hand-computed
  ΔI = 0.12 V / 330 Ω ≈ 0.36 mA from 25 °C to 85 °C.

## The chips' own sensors (2026-10-06)

A microcontroller sits on the same bench, so its on-die temperature sensor
reads `board.temperatureC` too (src/chip-temperature.js), with each
datasheet's TYPICAL curve — an uncalibrated part, which is what generated
code assumes when it converts back:

- ATmega328P/168P/88PA: ADC MUX 1000 against the internal 1.1 V —
  242 / 314 / 380 mV at −45 / +25 / +85 °C.
- ATtiny85: ADC4 (MUX 1111) against 1.1 V — 230 / 300 / 370 LSB at
  −40 / +25 / +85 °C.
- ATtiny88: ADC8 (MUX 1000) against 1.1 V (REFS0 = 0 selects it on this
  part) — the same 230 / 300 / 370 LSB table (ATtiny48/88 datasheet
  8008H, Table 17-2; added 2026-10-06).
- RP2040: ADC input 4 — 0.706 V at 27 °C, −1.721 mV/°C.
- STM32F030: ADC channel 16 once ADC_CCR.TSEN is set — 1.43 V at 30 °C,
  falling 4.3 mV/°C; unpowered (TSEN clear) it reads 0.

The ATmega2560 and the STC 8051 parts have no sensor.

Oracles: test/chip-temperature-and-attiny-serial.test.mjs — compiled AVR
programs read 292 / 354 counts (ATmega, 25 / 85 °C) and 300 / 370 LSB
(ATtiny85); the STM32F030 and RP2040 peripherals convert the curve above.
