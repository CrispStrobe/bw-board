# Spec-update: true small-signal AC analysis (complex MNA)

## Problem

The current "Bode" sweep (`sweep.js` `runAcSweep`) is time-domain: set the source
frequency, run 6 settle cycles + 4 measure cycles at 32 samples/cycle, correlate
against sin/cos. That is ~10 full transient integrations *per frequency point*, and
for circuits containing behavioral devices it measures the device model's settle
dynamics, not physics (the damped-integrator op-amp is the documented case). There
is no true frequency response, no input/output impedance, and active-filter lessons
cannot be honest.

## Proposal

1. **Linearize at the DC operating point**: solve the OP as today, then extract each
   nonlinear device's small-signal conductances there (diode gd from the Shockley
   companion; BJT gm, gpi, go once Early lands; MOSFET gm, gds; opamp per its
   macromodel once `opamp-macromodel.md` lands — until then the ideal VCVS row).
2. **Complex stamps**: C → jωC, L → 1/(jωL), sources → magnitude/phase phasors
   (the `vsource` `amplitude`/`phase` params reused; dc offset sets the OP).
3. **Solve** the complex sparse system per frequency point, reusing the symbolic
   pattern across the whole sweep (values change with ω, pattern does not). Complex
   arithmetic as split re/im arrays over the same kernel (no new dependency).
4. **API** (boundary-B addition): `runAc({sourceId, from, to, pointsPerDecade,
   probes:[netId…]}) → [{hz, [netId]: {mag, phaseDeg}}]`. Log spacing. Runs on an
   offline board like the existing sweep-runner pattern; the live board's time is
   untouched.
5. The time-domain sweep **remains** as a cross-check oracle: for linear circuits
   the two must agree, and the test suite asserts it.

## MNA impact

New analysis entry point beside the DC/transient paths; stamps gain a complex
variant; depends on `sparse-lu-factor-reuse.md` (kernel) and pairs with
`shockley-junction-limiting.md` (honest gd at the OP). No change to any existing
solve path.

## Acceptance

1. RC low-pass (1 kΩ, 1 µF): −3.01 dB and −45.0° at 159.15 Hz (hand-computed).
2. RLC series resonance: peak at 1/(2π√LC), Q within 1 % of R√(L/C) analytic.
3. Voltage divider: 0 dB ± 1e-9, phase 0° at every frequency (pure-real sanity).
4. Time-domain correlation sweep agrees with the AC answer within 2 % / 3° on
   oracles 1–3 (the cross-check that retires nothing silently).
5. Perf: 200-point sweep of a 50-net circuit completes in < 100 ms (vs seconds for
   the time-domain path) — asserted as an engineering-bar budget.
6. A circuit whose OP fails to converge reports the failure and returns no AC data
   (never a plausible flat trace) — the standing honesty rule.
