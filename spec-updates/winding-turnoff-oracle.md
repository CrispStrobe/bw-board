# Winding turn-off oracle boundary

Status: reactive live-span repair candidate, requiring exact hosted CI/Harris
qualification before landing. The original red checkpoint remains preserved
at `56c32063`: one sampled-reference pass and one direct live-request failure.

This evidence lane compares an explicitly authored exponential NPN circuit
against an independently authored ngspice deck. It is not the GPIO motor lesson
and does not replace that lesson's device model. Both circuits contain a 5 V
supply, a 22.7 kohm base resistor, a 5 mH winding with 10 ohm series resistance,
and a flyback diode. Both explicitly include the same 12 pF / 10 Mohm collector
probe load. That load changes the circuit; it is not a solver repair.

The drive rises in 1 us, stays high for 1 ms, falls in 1 us, and repeats at
3 ms. Turn-off therefore begins at 1.001 ms, not at 1 ms. The model cards and
thermal constants are authored independently of the circuit exporter.

## Bounded positive regression

`test/winding-turnoff-oracle.test.mjs` checks settled, clamp-conduction and
restart samples using the ordinary public `interactive-v2` live API. It first
checks independent reference refinement from 100 ns to 50 ns maximum step,
then compares seven exact-time current/voltage pairs. The reference bounds are
25 nA / 25 uV, including printed measurement rounding; the engine agreement
bounds are 1 uA / 100 uV. This passing case inserts intermediate observation
endpoints at 1.2, 1.5 and 2 ms, matching the measured diagnostic trace. These
bounds apply only to the named samples and this partition, not the whole
waveform. Doubling winding inductance or removing the intended turn-off
edge exercises real electrical callers against the unchanged reference.

## Remaining failures and uncertainty

Local diagnosis used ngspice 42. Removing the modeled probe makes that oracle
fail during initial switching; the engine also fails later in turn-off with
`transient-solve-not-converged`. Neither is agreement evidence or a completed
unloaded-waveform simulation.

With the probe load and sampled partition, the pre-repair default live engine
completes. However, late ringing
is **not qualified**, and completion depends on the advance partition. At
1.2 ms, the pre-span-repair engine (`09c0f027`) collector voltage was
4.8739996135 V. The independent Gear reference changed from 4.883100 V at
12.5 ns maximum step to 4.889203 V at 6.25 ns, 4.894728 V at 3.125 ns and
4.896551 V at 1.5625 ns. The changing reference prevents assigning the entire
difference to the engine. Trapezoidal ngspice at 12.5 ns gave 4.891393 V;
changing methods alone is not a convergence proof. No gate was widened to
count these samples as agreement.

The second test is a genuine desired-behavior regression, not an expected
failure pass: requesting restart at 3.1 ms directly after 1.1 ms exhausts the
20,000-attempt per-integration backstop at approximately 2.0821217125 ms.
The fixed 1 ms live scheduling span requests the endpoint at 2.1 ms, leaving
about 17.878 us unresolved before the failure fallback. Adding the observation
endpoints above completes instead. This is a workload/scheduling failure, not
a reproduced Newton-convergence failure in this probe-loaded case. The
existing backstop is doing its stated job; raising it or clearing the history
latch is not an acceptable repair. Original local suite: 1 pass, 1 fail, 0 skips.

## Narrow live scheduling repair

For reactive MNA circuits with a finite public transient step bound,
`advanceToLive` now tightens each scheduling span from 1 ms to that bound
(never larger than 1 ms and at least one clock nanosecond). For this circuit
the span becomes 100 us. Explicit authored maxima and sample grids may tighten
it further. Static/unbounded or nonreactive circuits keep their previous span.
Exact device/PWM deadlines still tighten the endpoint independently.

This is a **temporal** scheduling bound, not an actual CPU-work guarantee or
full integrator continuation protocol. It uses ordinary committed advances;
callers resume at the actual receipt time. No equation, error tolerance,
precision profile, attempt ceiling or finite whole-capture authority changes.
Genuine failure still refuses later live work. The direct restart regression
now passes without caller-inserted ringing checkpoints. Existing sampled-scope
coverage resumes through receipts while retaining all 100 samples and its
original waveform/meter assertions. No late-ring agreement claim follows.

Restoring the old 1 ms live span fails both the actual restart and reactive
clock callers; ignoring an authored 20 us maximum fails its actual receipt
assertion. Both isolated source mutations are restored before qualification.

A separate public finite `precision-v1` capture did not complete: its existing
1 ps minimum step failed local accuracy at the end of the falling edge, then
the capture exhausted its unchanged 20,000-attempt whole-capture limit. Its
provisional observations do not qualify a turn-off waveform. Live accuracy
status is a local integration estimate, not a global SPICE-fidelity certificate.

## Next work

1. The temporal scheduling repair does not make CPU work independently bounded.
   If further evidence warrants it, investigate
   actual-work-bounded yielding with committed accepted state, independent of
   caller-inserted measurement endpoints. Preserve finite whole-capture limits,
   genuine failure latches, exact event barriers and observable timestamps.
   Any production repair requires a separately expanded canonical claim.
2. Establish a converged late-ring reference with an independent passive RLC
   closed-form control, finer matched SPICE integration, and explicit model,
   initialization, sample-time and loading checks.
3. Measure engine phase, damping, winding energy and partition sensitivity
   against that reference. Diagnose rather than tune device parameters or
   loosen error/work ceilings to fit a trace.
4. Separately diagnose the finite precision falling-edge refusal; preserve its
   failure latch and whole-capture budget until an independently proved repair.
5. Only then qualify actual scope sampling, probe loading/bandwidth, meter
   windows and the original motor's complete off/restart waveform against
   independent references. No physical instrument or hardware claim follows
   from this bounded synthetic-circuit regression.
