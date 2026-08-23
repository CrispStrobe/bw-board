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
