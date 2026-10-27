# LM741 opt-in nominal 25 C bias/supply domain

Opt-in only, on the explicit `linear-pole` LM741:

```json
{"transientModel":"linear-pole","inputOffsetV":0,"supplyPositiveV":15,"supplyNegativeV":-15,
 "biasSupplyDomain":"ti-snosc25d-typical-25c","inputOffsetCurrentSign":1}
```

Values are **typical** entries of the TI LM741 data sheet (SNOSC25D),
LM741 grade, TA = 25 C, VS = ±15 V: input bias current 80 nA (max 500 nA),
input offset current 20 nA (max 200 nA), supply current 1.7 mA (max 2.8 mA).
Typical values are not guaranteed limits. The 2.8 mA entry in
`current-ratings.js` stays a warning budget and is not used as this law.

Laws (currents out of the package are positive in `branchCurrent`):

- `Ib+ = Ib + s·Ios/2`, `Ib- = Ib - s·Ios/2`, `s = inputOffsetCurrentSign`
  (the data sheet gives only the magnitude, so the sign is a required choice).
  Both flow into the inputs and return through V-.
- Quiescent current `Is` flows V+ → V-.
- Sourced output current is drawn from V+; sunk output current returns to V-.
  A solver-only `lm741_rail_return` element moves the hidden buffer's return
  from the reference net to the correct rail, so the external rail sources
  carry exactly the package rail currents and package KCL holds.

Refused (unavailable, not approximated): other domain names, missing or
non-±1 sign, rails other than exactly ±15 V, bench temperature other than
25 C, the keys without `transientModel: "linear-pole"`. Without the keys,
expansion, solve and reported currents are unchanged (supply pins remain
unrepresented and refuse in current meters).

Not claimed: guaranteed limits, temperature/supply dependence, offset
voltage from bias, noise, dynamic supply current or physical accuracy.
Tests: `test/lm741-bias-supply.test.mjs`.
