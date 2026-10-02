# ADP7118 internal startup envelope

Status: **replacement candidate, hosted qualification pending**. The initial
candidate was held after actual CLI capture reported
`minimum-step-accuracy-unmet` near 70.011 µs despite plausible endpoints.
Mandatory `transientAnalysisStatus().accuracyMet === true` checks are retained.
The replacement evaluates its reference at the actual MNA time, explicitly
schedules the interpolation corner, and distinguishes continuous source changes
from discrete behavioral events. Solver tolerances and budgets are unchanged.
Reactive current-limit transitions remain explicitly refused, not certified.
No installed-package adoption or physical accuracy certificate is implied.

The default ADP7118 model remains its existing DC regulation contract. Select
the following explicit model on a fixed-output part to capture internal startup:

```js
{kind: 'adp7118', params: {vOut: 5, startupModel: 'datasheet-envelope'}}
```

Use a 1.2–5 V fixed output, an open SS terminal, and the existing EN/VIN/GND
and direct SENSE connections. An explicitly netted SS terminal is conservatively
refused, including a singleton SS net: this slice cannot qualify an external
SS network. Adjustable mode, authored external soft-start capacitance and
startup into a prebiased output also refuse by name. They are not simulated
as if the pin or stored charge were absent.
Missing or externally divided SENSE also refuses: this startup slice admits
only direct output sensing, unlike the unchanged legacy adjustable/DC model.

## Timing authority and interpolation

[ADI ADP7118 Rev.H, Table 1 and Soft Start](https://www.analog.com/media/en/technical-documentation/data-sheets/adp7118.pdf)
give typical EN-to-10% timing of 80 µs and EN-to-90% timing of 380 µs, with
the latter defined relative to the nominal output. These are typical timing
anchors, not minimum/maximum guarantees or a complete transient macromodel.

This model **chooses**, rather than claims ADI specified, a delayed exponential
envelope through those two points:

```text
tau   = (380 us - 80 us) / ln(9)
delay = 80 us + tau * ln(0.9)
f(t)  = 0                         when t <= delay
f(t)  = 1 - exp(-(t-delay)/tau)    otherwise
```

The direct-sense reference becomes `vOut * f(t)` from the qualified enable
transition and is evaluated at every actual MNA solve time, not held between
device callbacks. The corner is rounded to the engine's nanosecond clock and
posted as the first deadline. Subsequent 10 µs wakes use the existing device
mechanism; the whole envelope fits its unchanged 200-deadline budget even in
one long advance. Reactive solves evaluate the reference continuously rather
than as a 10 µs staircase. The real external output capacitor and authored
output resistance determine the resulting RC response.

The opt-in non-reactive current-limited branch stamps a Norton current directly
instead of repeatedly moving a voltage source. Reactive overload/high-inrush
transitions require a within-solve nonlinear limiter, which this device-only
slice does not supply: it throws a named refusal when that regime is encountered.
A 10 Ω load with output capacitance and a 22 µF charging fixture explicitly
exercise this boundary. Neither is counted as simulated successfully.
Dropout/headroom, enable/UVLO and input/quiescent-current bookkeeping remain
bounded behavioral approximations. The legacy DC controller is unchanged.

EN/UVLO hysteresis does not restart an already enabled device. A real disable
clears startup progress. In this opt-in mode the disabled output is high
impedance, allowing its actual external RC network to discharge; the legacy
DC path is unchanged. A subsequent start with residual positive output charge
refuses instead of inventing active discharge or prebias recovery behavior.

`getDeviceState()` exposes `startupModel` and `startupFraction`. These identify
the interpolation being executed, not an independent accuracy certificate.

## Proof and limits

Focused tests use the real Board, a 2.2 µF output capacitor and 500 Ω load,
the two datasheet timing anchors, voltage scaling, charging current and complete
device KCL. Scope history must contain the finite monotonic ramp. Restart,
hysteresis, UVLO, shutdown RC decay, current limit, invalid parameters and
unsupported SS/prebias configurations have explicit controls. Existing DC
ADP7118/LT1763 cases remain unchanged.
Charging-current observations are explicitly caller-sampled at real 10 µs
instants; engine-clock voltage scope capture is checked separately. They are
not claimed to be an automatically clocked current-channel waveform.
Seven in-memory executable production mutants bypass the ramp, retain a stale
restart clock, drop the SS refusal, bypass the non-reactive current ceiling,
post a late rather than exact corner wake, remove the reactive-limit refusal,
or omit the opt-in callback context. Each must
fail its actual Board caller consequence; the registry is restored in `finally`
and the source file remains byte-unchanged.

Stamps do not mutate device state. Accepted transient-step provenance is passed
through `read.transient` only for models declaring `transientUpdateContext`;
ordinary models keep their original read shape and four-argument callback.
An observational bias-query regression checks cloned-state nonmutation and
the unchanged next real trajectory. A separate executable Board-dispatch
mutant omits the actual context delivery and reds the real callback assertion.
The combined focused startup, adjacent regulator, scope and baseline-profile
surface passes 42/42 with no skips; all eight isolated mutants red and restore
the registry or dispatcher.

An independent closed-form solution of the authored delayed exponential driving
the actual 0.05 Ω / 500 Ω / 2.2 µF RC circuit checks 120 instantaneous scope
observations and the capture-window meter integral. Native low/high sample pairs
are checked as paired storage of one observation, not double-counted. The actual
CUI CLI diagnostic run also passes both scope and voltage-meter capture with
`accuracyMet:true`: maximum waveform error 0.051 µV and mean error 13.3 µV on
this fixture. The meter mean is about 4.157 V, not the roughly 4.996 V final
endpoint. These are analytic model/circuit checks, not vendor-SPICE agreement;
the CLI used a checkout override, not an installed/downstream adoption.

Next separate model task: a within-MNA nonlinear current-limited regulator stamp
with actual-capacitor transition, accepted-step ceiling, KCL, recovery and oracle
proofs. Measure solver ownership and scope first; do not replace this named
refusal with a post-step clamp or tolerance relaxation.

The interpolated waveform is not vendor transistor-model agreement. External
CSS, adjustable-mode noise-reduction networks, overshoot, load-step feedback,
capacitive-load stability, noise/PSRR, temperature and thermal shutdown remain
outside its qualification. LT1763 startup behavior is unchanged. No GUI,
importer or downstream package adoption is implied by the upstream model.
