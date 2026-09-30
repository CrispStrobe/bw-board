# Meter waveform integration

`meterVoltage` and signed-OUT `meterCurrent` are DC means, not instantaneous
scope readings, true RMS, or a model of a particular meter's bandwidth/noise.
The first read starts observing at that instant and returns its instantaneous
value. Later reads average observed history over at most 100 ms. There is no
invented history before the first read. Unread watches expire after 2 s.

## Reproduced failure and repair

On Board `f10f96fd`, a self-authored 7 ms capture of
`PULSE(0 5 1m 1m 1m 2m 10m)` across 1 kOhm read **0 V** when advanced once,
but **2.142857 V** when advanced in 10 us chunks. The expected integral is
`5*(0.5+2+0.5)/7 = 15/7 V`. A 250 Hz sine with 2 V offset likewise depended
on caller scheduling. DC controls stayed exact. Local transient qualification
was true even when the meter mean was wrong: it did not qualify the integral.

Three causes are addressed together:

- Active meters make a source/resistor circuit's intermediate waveform
  observable, so it no longer takes the endpoint-only algebraic shortcut.
  Unwatched algebraic boards retain the existing one-solve endpoint path.
- Accepted transient publication records the actual solve timestamp **and
  the matching solution's voltage/current maps**. Rejected trial solves do
  not contribute. Reading old branch-current cache would give a different
  physical history from the corresponding voltages.
- Continuous segments use piecewise-linear quadrature. Discrete changes
  retain left/right values, including multiple changes at the same instant.
  The 100 ms boundary clips the interpolated segment rather than discarding
  a partial interval. Integer-clock window arithmetic and flat-segment return
  preserve exact DC readings. Discrete MNA adoption also records source-knob
  changes without requiring a later advance to discover them.

No solver equations, LTE tolerances, source amplitudes, scope/LED integration,
or transient work limits change. The fixed existing attempt limit applies;
attempt/accuracy failure makes the meter refuse a qualified mean. A later
successful short advance cannot certify the failed watch's earlier history.
Failed watches must be recreated by idle expiry, reset or netlist replacement.
Each watch retains at most 100,000 points. Reaching that limit refuses by name,
not by dropping unintegrated data or allocating unbounded memory. The capacity
regressions seed strictly ordered, physically consistent boundary samples
without doing 100,000 MNA solves. Expired points are retired before capacity
is judged, retaining the one support point needed for a clipped segment.
Floating-point boundary ties use only two machine-epsilon units of clock
roundoff; waveform tolerances and work limits are unchanged.

The exact source-constrained-inductor analytic shortcut stays untouched. Its
first instantaneous meter read remains available, but later averaging refuses
with `source-constrained-inductor-meter-integral-unqualified`, because that
path supplies endpoint values, not the needed time integral. A separate exact
analytic integral can close that refusal without degrading its fast solver.

## Verification and limits

Self-authored DC/SINE/PULSE cases compare three caller schedules with independent
closed-form integrals. Sine and pulse also compare live ngspice on 7,001 points
each; the oracle's own trapezoidal integral is checked against the closed form.
The engine mean must agree within 50 uV voltage / 50 nA signed resistor current.
These are explicit tolerances for these fixtures, not a universal error bound
or a claim about every waveform, circuit or multimeter model.

RC storage tests separately use the closed-form output integral and capacitor
charge change; other controls cover clipped windows, first read, PWM/DC steps,
same-time source controls, power-off, idle expiry, reset, netlist replacement,
actual budget exhaustion, history capacity and the analytic-inductor refusal.
Mutation checks exercise endpoint-only routing, outer-clock publication, stale
branch currents, lost discrete left limits and overwritten same-time edges.

## Follow-up roadmap

- Qualify exact analytic integrals for the source-constrained-inductor shortcut.
- Adopt the repaired engine in CUI/Lite with provenance and focused regressions.
  In CLI batch measurement, begin requested voltage/current watches before the
  advance if the intended result is a capture mean; the existing first read
  at the end is an instantaneous reading, not a reconstructed capture integral.
- Add an explicit independent integral/error qualification and bounded history
  strategy for arbitrary high-frequency, long-running/nonlinear device graphs.
  A scalar DC mean alone is not a global error certificate.
- Treat RMS, AC coupling, meter input impedance/bandwidth, filtering/noise and
  display cadence as separate physical models with separate oracle fixtures.
